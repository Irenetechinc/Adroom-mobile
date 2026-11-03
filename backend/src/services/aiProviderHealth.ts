export type AIProviderTask = 'text' | 'image' | 'video';
export type AIProviderId = 'nvidia' | 'huggingface' | 'cloudflare_workers_ai' | 'free_models' | 'openai' | 'gemini' | 'runway';
export type AIProviderHealthStatus = 'not_configured' | 'ready' | 'healthy' | 'busy' | 'exhausted' | 'unhealthy' | 'degraded';

export interface AIProviderHealth {
  provider: AIProviderId;
  task: AIProviderTask;
  configured: boolean;
  healthStatus: AIProviderHealthStatus;
  requestsToday: number;
  successesToday: number;
  lastStatusCode: number | null;
  lastError: string | null;
  updatedAt: string | null;
  nextRetryAt: string | null;
}

interface ProviderState {
  date: string;
  requestsToday: number;
  successesToday: number;
  healthStatus: Exclude<AIProviderHealthStatus, 'not_configured' | 'ready'> | null;
  lastStatusCode: number | null;
  lastError: string | null;
  updatedAt: string | null;
  nextRetryAt: number;
}

const stateByProvider = new Map<string, ProviderState>();
const PROVIDER_COOLDOWN_MS = 30_000;
const BUSY_COOLDOWN_MS = 60_000;
const UNHEALTHY_COOLDOWN_MS = 5 * 60_000;

function dateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function stateKey(provider: AIProviderId, task: AIProviderTask): string {
  return `${provider}:${task}`;
}

function getState(provider: AIProviderId, task: AIProviderTask, now = new Date()): ProviderState {
  const key = stateKey(provider, task);
  const currentDate = dateKey(now);
  let state = stateByProvider.get(key);
  if (!state || state.date !== currentDate) {
    state = {
      date: currentDate,
      requestsToday: 0,
      successesToday: 0,
      healthStatus: null,
      lastStatusCode: null,
      lastError: null,
      updatedAt: null,
      nextRetryAt: 0,
    };
    stateByProvider.set(key, state);
  }
  return state;
}

function extractStatusCode(error: any): number {
  return Number(error?.statusCode || error?.status || error?.response?.status || 0) || 0;
}

function extractMessage(error: any): string {
  const body = error?.error || error?.response?.data?.error || error?.response?.data || {};
  return String(
    error?.message ||
    body?.message ||
    body?.detail ||
    body?.error_description ||
    (typeof body === 'string' ? body : ''),
  ).slice(0, 500);
}

function nextUtcMidnight(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime();
}

function sanitizeMessage(message: string): string {
  let safe = message;
  for (const name of ['NVIDIA_API', 'HF_TOKEN', 'HUGGINGFACE_API_TOKEN', 'FREE_MODELS_API']) {
    const secret = String(process.env[name] || '').trim();
    if (secret) safe = safe.split(secret).join('[redacted]');
  }
  return safe.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function aiProviderIsAvailable(
  provider: AIProviderId,
  task: AIProviderTask,
  now = new Date(),
): boolean {
  const state = getState(provider, task, now);
  return state.nextRetryAt <= now.getTime();
}

export function recordAIProviderSuccess(
  provider: AIProviderId,
  task: AIProviderTask,
  now = new Date(),
): void {
  const state = getState(provider, task, now);
  state.requestsToday += 1;
  state.successesToday += 1;
  state.healthStatus = 'healthy';
  state.lastStatusCode = null;
  state.lastError = null;
  state.updatedAt = now.toISOString();
  state.nextRetryAt = 0;
}

export function recordAIProviderFailure(
  provider: AIProviderId,
  task: AIProviderTask,
  error: unknown,
  now = new Date(),
): void {
  const statusCode = extractStatusCode(error);
  const message = extractMessage(error);
  const lowerMessage = message.toLowerCase();
  const quotaError = (statusCode === 402 || statusCode === 429) &&
    /daily|quota|credit|allocation|exhaust|billing|limit exceeded/.test(lowerMessage);
  const authError = statusCode === 401 || statusCode === 403;
  const rateLimited = statusCode === 429 || statusCode === 503 || statusCode === 502 || statusCode === 504;
  const state = getState(provider, task, now);
  state.requestsToday += 1;
  state.healthStatus = quotaError ? 'exhausted' : authError ? 'unhealthy' : rateLimited ? 'busy' : 'degraded';
  state.lastStatusCode = statusCode || null;
  state.lastError = sanitizeMessage(message || 'Provider request failed without a response message.');
  state.updatedAt = now.toISOString();
  state.nextRetryAt = quotaError
    ? nextUtcMidnight(now)
    : authError
      ? now.getTime() + UNHEALTHY_COOLDOWN_MS
      : rateLimited
        ? now.getTime() + BUSY_COOLDOWN_MS
        : now.getTime() + PROVIDER_COOLDOWN_MS;

  // Hugging Face account-level quota applies to both supported media tasks.
  if (provider === 'huggingface' && quotaError) {
    for (const relatedTask of ['image', 'video'] as const) {
      const related = getState(provider, relatedTask, now);
      related.healthStatus = 'exhausted';
      related.lastStatusCode = statusCode || null;
      related.lastError = state.lastError;
      related.updatedAt = state.updatedAt;
      related.nextRetryAt = state.nextRetryAt;
    }
  }
}

export function getAIProviderHealth(
  configured: Array<{ provider: AIProviderId; task: AIProviderTask; configured: boolean }>,
  now = new Date(),
): AIProviderHealth[] {
  return configured.map(({ provider, task, configured: isConfigured }) => {
    const state = getState(provider, task, now);
    const status = !isConfigured
      ? 'not_configured'
      : state.healthStatus || 'ready';
    return {
      provider,
      task,
      configured: isConfigured,
      healthStatus: status,
      requestsToday: state.requestsToday,
      successesToday: state.successesToday,
      lastStatusCode: state.lastStatusCode,
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      nextRetryAt: state.nextRetryAt > now.getTime() ? new Date(state.nextRetryAt).toISOString() : null,
    };
  });
}

export function aiProviderCooldowns(): { busyMs: number; unhealthyMs: number } {
  return { busyMs: BUSY_COOLDOWN_MS, unhealthyMs: UNHEALTHY_COOLDOWN_MS };
}
