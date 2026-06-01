const BASE_URL_KEY = 'apma_base_url';
const API_KEY_KEY  = 'apma_api_key';

function getStore(): { storeGet: (k: string) => Promise<string>; storeSet: (k: string, v: unknown) => Promise<void>; storeDelete: (k: string) => Promise<void> } | null {
  return (window as any).electronAPI ?? null;
}

export async function getStoredCredentials(): Promise<{ baseUrl: string; apiKey: string } | null> {
  const s = getStore();
  if (!s) {
    const baseUrl = localStorage.getItem(BASE_URL_KEY) || '';
    const apiKey  = localStorage.getItem(API_KEY_KEY)  || '';
    return baseUrl && apiKey ? { baseUrl, apiKey } : null;
  }
  const [baseUrl, apiKey] = await Promise.all([s.storeGet(BASE_URL_KEY), s.storeGet(API_KEY_KEY)]);
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export async function saveCredentials(baseUrl: string, apiKey: string): Promise<void> {
  const s = getStore();
  if (!s) {
    localStorage.setItem(BASE_URL_KEY, baseUrl.replace(/\/$/, ''));
    localStorage.setItem(API_KEY_KEY, apiKey);
    return;
  }
  await Promise.all([
    s.storeSet(BASE_URL_KEY, baseUrl.replace(/\/$/, '')),
    s.storeSet(API_KEY_KEY, apiKey),
  ]);
}

export async function clearCredentials(): Promise<void> {
  const s = getStore();
  if (!s) {
    localStorage.removeItem(BASE_URL_KEY);
    localStorage.removeItem(API_KEY_KEY);
    return;
  }
  await Promise.all([s.storeDelete(BASE_URL_KEY), s.storeDelete(API_KEY_KEY)]);
}

async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const creds = await getStoredCredentials();
  if (!creds) throw new Error('Not authenticated');
  const res = await fetch(`${creds.baseUrl}/api/apma/client${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-apma-key': creds.apiKey,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as any).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const apmaApi = {
  dashboard:           ()                   => apiFetch<any>('/dashboard'),
  campaigns:           ()                   => apiFetch<any>('/campaigns'),
  sentimentTrend:      (days = 30)          => apiFetch<any>(`/sentiment-trend?days=${days}`),
  recommendations:     ()                   => apiFetch<any>('/recommendations'),
  actions:             (since?: string)     => apiFetch<any>(`/actions${since ? `?since=${since}` : ''}`),
  blogs:               ()                   => apiFetch<any>('/blogs'),
  vetoRec:             (id: string)         => apiFetch<any>(`/veto/${id}`, { method: 'POST' }),
  events:              (since?: number)     => apiFetch<{ events: any[]; latest_seq: number }>(`/events${since != null ? `?since=${since}` : ''}`),
  predictedEvents:     (horizon: 7|30|90 = 30) => apiFetch<{ events: any[]; campaign_id?: string; horizon: number }>(`/predicted-events?horizon=${horizon}`),
  socialAccounts:      ()                   => apiFetch<{ accounts: any[] }>('/social-accounts'),
  addSocialAccount:    (body: any)          => apiFetch<{ account: any }>('/social-accounts', { method: 'POST', body: JSON.stringify(body) }),
  removeSocialAccount: (id: string)         => apiFetch<{ ok: boolean }>(`/social-accounts/${id}`, { method: 'DELETE' }),
  toggleSocialAccount: (id: string, active: boolean) => apiFetch<{ account: any }>(`/social-accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  clientProfile:       ()                   => apiFetch<{ profile: any }>('/profile'),
  refreshProfile:      ()                   => apiFetch<{ profile: any }>('/profile/refresh', { method: 'POST' }),
  selfImprovementLogs: ()                   => apiFetch<{ logs: any[] }>('/self-improvement'),
  deployImprovement:   (id: string)         => apiFetch<{ ok: boolean }>(`/self-improvement/${id}/deploy`, { method: 'POST' }),
  opposition:          ()                   => apiFetch<any>('/opposition'),
  analytics:           (days = 30)          => apiFetch<any>(`/analytics?days=${days}`),

  oauthStart: (platform: string)  => apiFetch<{ authUrl: string; stateId: string }>(`/oauth/start/${platform}`, { method: 'POST' }),
  oauthPoll:  (stateId: string)   => apiFetch<{ status: 'pending' | 'completed' | 'error' | 'expired'; accounts?: any[]; error?: string }>(`/oauth/poll/${stateId}`),
};
