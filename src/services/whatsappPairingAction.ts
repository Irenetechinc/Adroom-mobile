interface ApiResponse {
  error?: string;
  requestId?: string;
  pairingCode?: string;
  connections?: Array<{ provider?: string; status?: string }>;
}

export type WhatsAppPairingActionResult =
  | { kind: 'start'; requestId: string; pairingCode: string }
  | { kind: 'verify'; connected: boolean };

interface WhatsAppPairingActionOptions {
  step: 'start' | 'verify';
  baseUrl: string;
  phone: string;
  accessToken: string;
  fetcher?: typeof fetch;
  pause?: (milliseconds: number) => Promise<void>;
}

const pauseFor = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runWhatsAppPairingAction({
  step,
  baseUrl,
  phone,
  accessToken,
  fetcher = fetch,
  pause = pauseFor,
}: WhatsAppPairingActionOptions): Promise<WhatsAppPairingActionResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  if (step === 'start') {
    const response = await fetcher(`${base}/whatsapp-personal/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone }),
    });
    const result = await response.json().catch(() => ({})) as ApiResponse;
    if (!response.ok) throw new Error(result.error || 'Connection failed.');
    if (!result.requestId || !result.pairingCode) {
      throw new Error('WhatsApp did not return a pairing code.');
    }
    return { kind: 'start', requestId: result.requestId, pairingCode: result.pairingCode };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetcher(base, { method: 'GET', headers });
    const result = await response.json().catch(() => ({})) as ApiResponse;
    if (!response.ok) throw new Error(result.error || 'Could not check WhatsApp connection status.');
    const connected = (result.connections || []).some(
      (connection) => connection.provider === 'whatsapp_personal' && connection.status === 'connected',
    );
    if (connected) return { kind: 'verify', connected: true };
    if (attempt < 4) await pause(1000);
  }

  return { kind: 'verify', connected: false };
}