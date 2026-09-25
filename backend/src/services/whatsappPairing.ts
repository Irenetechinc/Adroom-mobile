import fs from 'fs/promises';
import path from 'path';

interface WhatsAppConnectionUpdate {
  connection?: string;
  qr?: string;
  lastDisconnect?: { error?: { message?: string } };
}

export interface WhatsAppPairingSessionPersistenceOptions {
  authDir: string;
  waitForCredentials?: () => Promise<void>;
  settleDelayMs?: number;
  persist: (bundle: Record<string, string>) => Promise<void>;
}

/**
 * Waits for Baileys' final credential write and copies the complete auth
 * directory before the first-pair socket is allowed to be cleaned up.
 */
export async function persistWhatsAppPairingSession({
  authDir,
  waitForCredentials,
  settleDelayMs = 100,
  persist,
}: WhatsAppPairingSessionPersistenceOptions): Promise<void> {
  await waitForCredentials?.();
  await new Promise((resolve) => setTimeout(resolve, settleDelayMs));

  const bundle: Record<string, string> = {};
  for (const file of await fs.readdir(authDir)) {
    const fullPath = path.join(authDir, file);
    if ((await fs.stat(fullPath)).isFile()) {
      bundle[file] = (await fs.readFile(fullPath)).toString('base64');
    }
  }
  if (!Object.keys(bundle).length) {
    throw new Error('WhatsApp linked the device but did not produce session credentials.');
  }
  await persist(bundle);
}

interface WhatsAppPairingSocket {
  authState: { creds: { registered?: boolean } };
  ev: {
    on(event: 'connection.update', listener: (update: WhatsAppConnectionUpdate) => void): unknown;
    off(event: 'connection.update', listener: (update: WhatsAppConnectionUpdate) => void): unknown;
  };
  requestPairingCode(phoneNumber: string): Promise<string>;
}

export function requestWhatsAppPairingCodeWhenReady(
  sock: WhatsAppPairingSocket,
  phoneNumber: string,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let requested = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      sock.ev.off('connection.update', onConnectionUpdate);
    };
    const resolveOnce = (code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onConnectionUpdate = (update: WhatsAppConnectionUpdate) => {
      if (update.connection === 'close') {
        const closeMessage = String(update.lastDisconnect?.error?.message || '').trim();
        rejectOnce(new Error(
          closeMessage
            ? `WhatsApp closed before pairing code generation: ${closeMessage}`
            : 'WhatsApp closed before pairing code generation.',
        ));
        return;
      }

      // Baileys 7 emits "connecting" before its WebSocket is open. The QR
      // update arrives after the server handshake and is safe for this request.
      if (!requested && update.qr && !sock.authState.creds.registered) {
        requested = true;
        void Promise.resolve()
          .then(() => sock.requestPairingCode(phoneNumber))
          .then(resolveOnce, rejectOnce);
      }
    };

    timer = setTimeout(() => {
      rejectOnce(new Error('WhatsApp did not initialize before the pairing code request timed out.'));
    }, timeoutMs);
    sock.ev.on('connection.update', onConnectionUpdate);
  });
}