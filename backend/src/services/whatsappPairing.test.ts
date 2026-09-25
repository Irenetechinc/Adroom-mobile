import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  persistWhatsAppPairingSession,
  requestWhatsAppPairingCodeWhenReady,
} from './whatsappPairing';

interface FakeWhatsAppSocket {
  authState: { creds: { registered: boolean } };
  ev: EventEmitter;
  requestPairingCode: (phoneNumber: string) => Promise<string>;
}

async function testPairingWaitsForQrAndRequestsOnce(): Promise<void> {
  let serverHandshakeComplete = false;
  let requestCount = 0;
  const socket: FakeWhatsAppSocket = {
    authState: { creds: { registered: false } },
    ev: new EventEmitter(),
    requestPairingCode: async (phoneNumber) => {
      requestCount += 1;
      assert.equal(phoneNumber, '2348012345678');
      assert.equal(serverHandshakeComplete, true, 'pairing request must wait for the server handshake');
      return 'TEST1234';
    },
  };

  const pairingCodePromise = requestWhatsAppPairingCodeWhenReady(socket, '2348012345678');
  socket.ev.emit('connection.update', { connection: 'connecting' });
  assert.equal(requestCount, 0, 'connecting is emitted before the WebSocket is ready');

  serverHandshakeComplete = true;
  socket.ev.emit('connection.update', { qr: 'server-generated-qr' });
  assert.equal(await pairingCodePromise, 'TEST1234');
  socket.ev.emit('connection.update', { qr: 'duplicate-qr-update' });
  assert.equal(requestCount, 1, 'the code must be requested only once');
}

async function testSocketCloseRejectsBeforePairingRequest(): Promise<void> {
  let requestCount = 0;
  const socket: FakeWhatsAppSocket = {
    authState: { creds: { registered: false } },
    ev: new EventEmitter(),
    requestPairingCode: async () => {
      requestCount += 1;
      return 'UNEXPECTED';
    },
  };

  const pairingCodePromise = requestWhatsAppPairingCodeWhenReady(socket, '2348012345678');
  socket.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { message: 'Connection Closed' } },
  });
  await assert.rejects(pairingCodePromise, /Connection Closed/);
  assert.equal(requestCount, 0);
}

async function testBaileysFirstPairPersistsBeforeRestartReconnect(): Promise<void> {
  // This uses Baileys' real auth-state implementation, but never opens a
  // network socket or touches Supabase/production credentials.
  const baileys = require('@whiskeysockets/baileys');
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adroom-wa-pairing-'));
  const restoredDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adroom-wa-restored-'));
  let cleanupStarted = false;
  let persistedBundle: Record<string, string> | undefined;
  let finalizing: Promise<void> | undefined;
  let resolveClose!: () => void;
  let rejectClose!: (error: unknown) => void;
  let reconnectReachedConnected = false;
  const closeHandled = new Promise<void>((resolve, reject) => {
    resolveClose = resolve;
    rejectClose = reject;
  });

  try {
    const { state, saveCreds } = await baileys.useMultiFileAuthState(sourceDir);
    state.creds.registered = true;
    state.creds.me = { id: '2348012345678@s.whatsapp.net', name: '~' };
    const credentialWrite = saveCreds();
    const events = new EventEmitter();

    events.on('connection.update', (update: any) => {
      if (update.isNewLogin) {
        finalizing = persistWhatsAppPairingSession({
          authDir: sourceDir,
          waitForCredentials: () => credentialWrite,
          settleDelayMs: 0,
          persist: async (bundle) => {
            assert.equal(cleanupStarted, false, 'credentials must persist before auth cleanup');
            persistedBundle = bundle;
          },
        });
      }

      if (update.connection === 'close') {
        void (async () => {
          await finalizing;
          cleanupStarted = true;
          await fs.rm(sourceDir, { recursive: true, force: true });

          const statusCode = Number(update.lastDisconnect?.error?.output?.statusCode || 0);
          if (statusCode === baileys.DisconnectReason.restartRequired) {
            assert.ok(persistedBundle?.['creds.json'], 'the first-link creds file must be persisted');
            for (const [file, encoded] of Object.entries(persistedBundle!)) {
              await fs.writeFile(
                path.join(restoredDir, file),
                Buffer.from(encoded, 'base64'),
              );
            }
            const restored = await baileys.useMultiFileAuthState(restoredDir);
            assert.equal(
              restored.state.creds.registered,
              true,
              'the restarted socket must receive registered credentials',
            );
            reconnectReachedConnected = true;
          }
          resolveClose();
        })().catch((error) => {
          rejectClose(error);
        });
      }
    });

    // Baileys emits this after companion pairing and then normally closes with
    // 515 so the caller can create a fresh socket from the saved credentials.
    events.emit('connection.update', { isNewLogin: true, qr: undefined });
    events.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: { output: { statusCode: baileys.DisconnectReason.restartRequired } },
      },
    });
    await closeHandled;
    assert.ok(persistedBundle, 'first-link credentials should be persisted');
    assert.equal(cleanupStarted, true);
    assert.equal(reconnectReachedConnected, true, '515 must lead to a connected restored session');
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(restoredDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await testPairingWaitsForQrAndRequestsOnce();
  await testSocketCloseRejectsBeforePairingRequest();
  await testBaileysFirstPairPersistsBeforeRestartReconnect();
  console.log('WhatsApp pairing lifecycle regression checks passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});