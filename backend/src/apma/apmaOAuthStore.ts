export interface APMAOAuthState {
  clientId: string;
  platform: string;
  status: 'pending' | 'completed' | 'error';
  accountIds?: string[];
  error?: string;
  codeVerifier?: string;
  expiresAt: number;
}

export const apmaOAuthStates = new Map<string, APMAOAuthState>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of apmaOAuthStates) {
    if (v.expiresAt < now) apmaOAuthStates.delete(k);
  }
}, 5 * 60_000);
