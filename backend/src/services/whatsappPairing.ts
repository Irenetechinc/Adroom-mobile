interface WhatsAppConnectionUpdate {
  connection?: string;
  qr?: string;
  lastDisconnect?: { error?: { message?: string } };
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