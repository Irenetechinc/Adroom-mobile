import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { requestWhatsAppPairingCodeWhenReady } from './whatsappPairing';

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

async function main(): Promise<void> {
  await testPairingWaitsForQrAndRequestsOnce();
  await testSocketCloseRejectsBeforePairingRequest();
  console.log('WhatsApp pairing lifecycle regression checks passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});