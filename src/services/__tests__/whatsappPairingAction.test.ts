import { runWhatsAppPairingAction } from '../whatsappPairingAction';

describe('WhatsApp pairing action', () => {
  const baseUrl = 'https://backend.adroomai.com/api/social-connections';

  it('checks persisted status with GET on confirmation and never starts a second socket', async () => {
    const requests: Array<{ url: string; method: string | undefined; authorization: string | undefined }> = [];
    const responses = [
      { connections: [{ provider: 'whatsapp_personal', status: 'pending' }] },
      { connections: [{ provider: 'whatsapp_personal', status: 'connected' }] },
    ];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: headers?.Authorization,
      });
      return {
        ok: true,
        json: async () => responses.shift(),
      } as Response;
    }) as typeof fetch;
    const pause = jest.fn(async () => {});

    const result = await runWhatsAppPairingAction({
      step: 'verify',
      baseUrl,
      phone: '',
      accessToken: 'test-session-token',
      fetcher,
      pause,
    });

    expect(result).toEqual({ kind: 'verify', connected: true });
    expect(requests).toEqual([
      { url: baseUrl, method: 'GET', authorization: 'Bearer test-session-token' },
      { url: baseUrl, method: 'GET', authorization: 'Bearer test-session-token' },
    ]);
    expect(requests.some((request) => request.url.endsWith('/whatsapp-personal/start'))).toBe(false);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('starts pairing with exactly one POST only on the initial step', async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      body?: string | null;
      authorization: string | undefined;
    }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body as string | null,
        authorization: headers?.Authorization,
      });
      return {
        ok: true,
        json: async () => ({ requestId: 'request-1', pairingCode: 'PAIR1234' }),
      } as Response;
    }) as typeof fetch;

    const result = await runWhatsAppPairingAction({
      step: 'start',
      baseUrl,
      phone: '+234 801 234 5678',
      accessToken: 'test-session-token',
      fetcher,
    });

    expect(result).toEqual({ kind: 'start', requestId: 'request-1', pairingCode: 'PAIR1234' });
    expect(requests).toEqual([{
      url: `${baseUrl}/whatsapp-personal/start`,
      method: 'POST',
      body: JSON.stringify({ phone: '+234 801 234 5678' }),
      authorization: 'Bearer test-session-token',
    }]);
  });
});