import { getServiceSupabaseClient } from '../config/supabase';
import { broadcast } from '../events/sseBroadcast';

export type CloudflareTaskType = 'text' | 'image';
export type CloudflarePolicyMode = 'tiered' | 'free' | 'paid';

export interface CloudflareProviderSettings {
  freeModeEnabled: boolean;
  universalFreeModeEnabled: boolean;
}

export interface CloudflareAccountUsage {
  accountType: CloudflareTaskType;
  configured: boolean;
  neuronsUsed: number;
  neuronsRemaining: number;
  dailyLimit: number;
  calls: number;
  exhausted: boolean;
  healthStatus: string;
  lastStatusCode: number | null;
  lastError: string | null;
  updatedAt: string | null;
  usageIsEstimated: true;
}

const CLOUDFLARE_API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';
const DEFAULT_TEXT_MODEL = '@cf/meta/llama-3.2-1b-instruct';
const DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const DAILY_NEURON_LIMIT = 10_000;
const MAX_TEXT_OUTPUT_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 30_000;
const DATABASE_TIMEOUT_MS = 4_000;
const UNHEALTHY_RETRY_MS = 5 * 60_000;
const RATE_LIMIT_RETRY_MS = 30_000;
const SETTINGS_CACHE_MS = 2_000;

const ENV_KEYS: Record<CloudflareTaskType, { accountId: string; apiToken: string }> = {
  text: { accountId: 'CLOUDFLARE_ACCOUNT_ID_1', apiToken: 'CLOUDFLARE_API_TOKEN_1' },
  image: { accountId: 'CLOUDFLARE_ACCOUNT_ID_2', apiToken: 'CLOUDFLARE_API_TOKEN_2' },
};

interface CloudflareAccountCredentials {
  accountId: string;
  apiToken: string;
}

interface UsageRow {
  account_type: CloudflareTaskType;
  neurons_used: number | string;
  call_count: number | string;
  is_exhausted: boolean;
  health_status: string;
  last_status_code: number | null;
  last_error: string | null;
  updated_at: string | null;
}

interface CloudflareRequestError extends Error {
  statusCode: number;
  isModelError: boolean;
}

let settingsCache: { value: CloudflareProviderSettings; expiresAt: number } | null = null;
let migrationWarningLogged = false;
const lastAuthAlertAt: Partial<Record<CloudflareTaskType, number>> = {};

async function withDatabaseTimeout<T>(query: PromiseLike<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), DATABASE_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([Promise.resolve(query), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function credentialsFor(task: CloudflareTaskType, env: NodeJS.ProcessEnv = process.env): CloudflareAccountCredentials | null {
  const names = ENV_KEYS[task];
  const accountId = String(env[names.accountId] || '').trim();
  const apiToken = String(env[names.apiToken] || '').trim();
  if (!/^[a-zA-Z0-9-]+$/.test(accountId) || !apiToken) return null;
  return { accountId, apiToken };
}

function isAllowedModelId(candidate: string): boolean {
  return /^@cf\/[a-z0-9][a-z0-9._/-]*$/i.test(candidate) &&
    candidate.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

export function isCloudflareConfigured(task: CloudflareTaskType, env: NodeJS.ProcessEnv = process.env): boolean {
  return credentialsFor(task, env) !== null;
}

export function cloudflarePolicyAllows(
  mode: CloudflarePolicyMode,
  isFreeTierUser: boolean,
  settings: CloudflareProviderSettings,
): boolean {
  if (mode === 'paid') return false;
  if (mode === 'free') return settings.universalFreeModeEnabled;
  return isFreeTierUser && settings.freeModeEnabled;
}

export function resolveCloudflareModel(task: CloudflareTaskType, requestedModel?: string): string {
  const defaultModel = task === 'text'
    ? DEFAULT_TEXT_MODEL
    : DEFAULT_IMAGE_MODEL;
  const configuredModel = task === 'text'
    ? process.env.CLOUDFLARE_TEXT_MODEL
    : process.env.CLOUDFLARE_IMAGE_MODEL;
  const candidate = String(requestedModel || configuredModel || defaultModel).trim();
  return isAllowedModelId(candidate) ? candidate : defaultModel;
}

export function resolveCloudflareFallbackModel(task: CloudflareTaskType): string {
  const configuredFallback = task === 'text'
    ? process.env.CLOUDFLARE_TEXT_FALLBACK_MODEL
    : process.env.CLOUDFLARE_IMAGE_FALLBACK_MODEL;
  const defaultModel = task === 'text' ? DEFAULT_TEXT_MODEL : DEFAULT_IMAGE_MODEL;
  const candidate = String(configuredFallback || defaultModel).trim();
  return isAllowedModelId(candidate) ? candidate : defaultModel;
}

export function isCloudflareModelError(statusCode: number, message: string): boolean {
  return (statusCode === 400 || statusCode === 404) &&
    /model|not found|not available|does not exist|invalid/i.test(message);
}

export function isCloudflareQuotaError(statusCode: number, message: string): boolean {
  return statusCode === 429 && /rate|quota|neuron|daily|limit|exceed|allocation/i.test(message);
}

export function estimateCloudflareTextNeurons(model: string, inputTokens: number, outputTokens: number): number {
  const normalized = model.toLowerCase();
  let inputPerMillion: number;
  let outputPerMillion: number;

  if (normalized.includes('llama-3.2-1b-instruct')) {
    inputPerMillion = 2_457;
    outputPerMillion = 18_252;
  } else if (normalized.includes('mistral-7b-instruct')) {
    inputPerMillion = 10_000;
    outputPerMillion = 17_300;
  } else if (normalized.includes('llama-3.1-70b-instruct')) {
    inputPerMillion = 26_668;
    outputPerMillion = 204_805;
  } else {
    // Unknown model IDs use the highest rate in the supported text rate card
    // instead of silently counting as zero.
    inputPerMillion = 26_668;
    outputPerMillion = 204_805;
  }

  const estimate = (Math.max(0, inputTokens) * inputPerMillion + Math.max(0, outputTokens) * outputPerMillion) / 1_000_000;
  return estimate > 0 ? Math.ceil(estimate) : 0;
}

export function estimateCloudflareImageNeurons(model: string, steps = 4, inputTiles = 0, outputTiles = 1): number {
  const normalized = model.toLowerCase();
  let estimate: number;

  if (normalized.includes('flux-1-schnell')) {
    estimate = Math.max(1, outputTiles) * 4.8 + Math.max(1, steps) * 9.6;
  } else if (normalized.includes('flux-2-klein-4b')) {
    estimate = Math.max(0, inputTiles) * 5.37 + Math.max(1, outputTiles) * 26.05;
  } else {
    // Unknown model IDs use the higher default image estimate.
    estimate = Math.max(1, outputTiles) * 4.8 + Math.max(1, steps) * 9.6;
  }

  return estimate > 0 ? Math.ceil(estimate) : 0;
}

function requestError(statusCode: number, message: string, isModelError = false): CloudflareRequestError {
  const error = new Error(message) as CloudflareRequestError;
  error.statusCode = statusCode;
  error.isModelError = isModelError;
  return error;
}

function getBodyErrorText(body: any): string {
  const messages = Array.isArray(body?.errors)
    ? body.errors.map((error: any) => [error?.code, error?.message].filter(Boolean).join(' ')).join(' ')
    : '';
  return String(body?.error?.message || body?.message || messages || '');
}

function promptTokenEstimate(messages: any[]): number {
  const content = (messages || []).map((entry) => {
    if (typeof entry?.content === 'string') return entry.content;
    return JSON.stringify(entry?.content || '');
  }).join(' ');
  return Math.ceil(content.length / 4);
}

function textTokenUsage(params: any, body: any): { inputTokens: number; outputTokens: number } {
  const usage = body?.usage || body?.result?.usage || {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.input ?? 0) ||
    promptTokenEstimate(params.messages || []);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.output ?? 0) ||
    Math.min(Math.max(1, Number(params.max_tokens || 512)), 512);
  return { inputTokens, outputTokens };
}

function emitAuthAlert(task: CloudflareTaskType, statusCode: number): void {
  const now = Date.now();
  if (now - Number(lastAuthAlertAt[task] || 0) < 5 * 60_000) return;
  lastAuthAlertAt[task] = now;
  broadcast('cloudflare_provider_alert', {
    accountType: task,
    statusCode,
    message: 'Cloudflare Workers AI credentials were rejected. Check the server environment settings.',
    at: new Date(now).toISOString(),
  });
}

async function recordAttempt(
  task: CloudflareTaskType,
  neurons: number,
  statusCode: number,
  errorKind: 'success' | 'exhausted' | 'unhealthy' | 'degraded',
): Promise<void> {
  try {
    const { data, error } = await withDatabaseTimeout(
      getServiceSupabaseClient().rpc('record_cloudflare_ai_usage', {
        p_account_type: task,
        p_neurons: Math.max(0, Math.trunc(neurons)),
        p_status_code: statusCode || null,
        p_health_status: errorKind === 'success' ? 'healthy' : errorKind,
        p_last_error: errorKind === 'success'
          ? null
          : errorKind === 'exhausted'
            ? 'Daily usage limit reached'
            : errorKind === 'unhealthy'
              ? 'Cloudflare rejected the account credentials'
              : 'Cloudflare request failed; another provider will be tried',
      }),
      'Cloudflare usage update timed out',
    );
    if (error) throw error;

    const record = data && typeof data === 'object' ? data : {};
    broadcast('cloudflare_usage_updated', {
      accountType: task,
      neuronsUsed: Number(record.neurons_used || 0),
      calls: Number(record.call_count || 0),
      exhausted: Boolean(record.is_exhausted),
      healthStatus: String(record.health_status || errorKind),
      updatedAt: String(record.updated_at || new Date().toISOString()),
    });
  } catch {
    if (!migrationWarningLogged) {
      migrationWarningLogged = true;
      console.warn('[AI:CLOUDFLARE] Usage counters could not be persisted; apply the Cloudflare Workers AI Supabase migration.');
    }
  }
}

async function recordHttpFailure(task: CloudflareTaskType, statusCode: number, bodyMessage: string): Promise<void> {
  const quotaError = isCloudflareQuotaError(statusCode, bodyMessage);
  const authError = statusCode === 401 || statusCode === 403;
  const modelError = isCloudflareModelError(statusCode, bodyMessage);
  const kind = quotaError ? 'exhausted' : authError ? 'unhealthy' : 'degraded';
  await recordAttempt(task, 0, statusCode, kind);
  if (authError) emitAuthAlert(task, statusCode);
  throw requestError(
    statusCode,
    modelError
      ? 'Cloudflare Workers AI rejected the selected model.'
      : authError
        ? 'Cloudflare Workers AI rejected the account credentials.'
        : quotaError
          ? 'Cloudflare Workers AI daily quota is exhausted.'
          : `Cloudflare Workers AI request failed with HTTP ${statusCode}.`,
    modelError,
  );
}

async function fetchJson(url: string, token: string, body: unknown): Promise<{ response: Response; data: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (typeof timeout.unref === 'function') timeout.unref();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch {
    throw requestError(0, 'Cloudflare Workers AI request timed out or could not connect.');
  } finally {
    clearTimeout(timeout);
  }
}

function accountIsAvailableFromRow(row: UsageRow | null, now = Date.now()): boolean {
  if (!row) return true;
  if (row.is_exhausted || Number(row.neurons_used || 0) >= DAILY_NEURON_LIMIT) return false;
  const ageMs = now - Date.parse(String(row.updated_at || ''));
  if (row.health_status === 'unhealthy' && ageMs < UNHEALTHY_RETRY_MS) return false;
  if (Number(row.last_status_code || 0) === 429 && ageMs < RATE_LIMIT_RETRY_MS) return false;
  return true;
}

export async function isCloudflareAccountAvailable(task: CloudflareTaskType): Promise<boolean> {
  if (!isCloudflareConfigured(task)) return false;
  try {
    const { data, error } = await withDatabaseTimeout(
      getServiceSupabaseClient()
        .from('cloudflare_ai_daily_usage')
        .select('account_type, neurons_used, call_count, is_exhausted, health_status, last_status_code, last_error, updated_at')
        .eq('usage_date', utcDateKey())
        .eq('account_type', task)
        .maybeSingle(),
      'Cloudflare account status query timed out',
    );
    if (error) throw error;
    return accountIsAvailableFromRow(data as UsageRow | null);
  } catch {
    return false;
  }
}

export async function getCloudflareProviderSettings(): Promise<CloudflareProviderSettings> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.value;
  const { data, error } = await withDatabaseTimeout(
    getServiceSupabaseClient()
      .from('cloudflare_ai_provider_settings')
      .select('free_mode_enabled, universal_free_mode_enabled')
      .eq('id', 'global')
      .maybeSingle(),
    'Cloudflare provider settings query timed out',
  );
  if (error) throw error;
  const value: CloudflareProviderSettings = {
    freeModeEnabled: Boolean(data?.free_mode_enabled),
    universalFreeModeEnabled: Boolean(data?.universal_free_mode_enabled),
  };
  settingsCache = { value, expiresAt: Date.now() + SETTINGS_CACHE_MS };
  return value;
}

export async function updateCloudflareProviderSettings(
  settings: CloudflareProviderSettings,
  adminEmail: string,
): Promise<CloudflareProviderSettings> {
  const { data, error } = await withDatabaseTimeout(
    getServiceSupabaseClient()
      .from('cloudflare_ai_provider_settings')
      .upsert({
        id: 'global',
        free_mode_enabled: settings.freeModeEnabled,
        universal_free_mode_enabled: settings.universalFreeModeEnabled,
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      .select('free_mode_enabled, universal_free_mode_enabled')
      .single(),
    'Cloudflare provider settings update timed out',
  );
  if (error) throw error;

  const updated = {
    freeModeEnabled: Boolean(data.free_mode_enabled),
    universalFreeModeEnabled: Boolean(data.universal_free_mode_enabled),
  };
  settingsCache = { value: updated, expiresAt: Date.now() + SETTINGS_CACHE_MS };
  return updated;
}

function buildAccountUsage(task: CloudflareTaskType, row?: UsageRow): CloudflareAccountUsage {
  const neuronsUsed = Math.max(0, Number(row?.neurons_used || 0));
  return {
    accountType: task,
    configured: isCloudflareConfigured(task),
    neuronsUsed,
    neuronsRemaining: Math.max(0, DAILY_NEURON_LIMIT - neuronsUsed),
    dailyLimit: DAILY_NEURON_LIMIT,
    calls: Math.max(0, Number(row?.call_count || 0)),
    exhausted: Boolean(row?.is_exhausted) || neuronsUsed >= DAILY_NEURON_LIMIT,
    healthStatus: String(row?.health_status || (isCloudflareConfigured(task) ? 'ready' : 'not_configured')),
    lastStatusCode: row?.last_status_code == null ? null : Number(row.last_status_code),
    lastError: row?.last_error || null,
    updatedAt: row?.updated_at || null,
    usageIsEstimated: true,
  };
}

export async function getCloudflareAdminStatus(): Promise<{
  settings: CloudflareProviderSettings;
  accounts: { text: CloudflareAccountUsage; image: CloudflareAccountUsage };
  checkedAt: string;
}> {
  const [settings, usageResult] = await Promise.all([
    getCloudflareProviderSettings(),
    withDatabaseTimeout(
      getServiceSupabaseClient()
        .from('cloudflare_ai_daily_usage')
        .select('account_type, neurons_used, call_count, is_exhausted, health_status, last_status_code, last_error, updated_at')
        .eq('usage_date', utcDateKey()),
      'Cloudflare usage status query timed out',
    ),
  ]);
  if (usageResult.error) throw usageResult.error;
  const rows = (usageResult.data || []) as UsageRow[];
  const byType = new Map(rows.map((row) => [row.account_type, row]));
  return {
    settings,
    accounts: {
      text: buildAccountUsage('text', byType.get('text')),
      image: buildAccountUsage('image', byType.get('image')),
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function logCloudflareStartupDiagnostics(): Promise<void> {
  const configured = {
    text: isCloudflareConfigured('text'),
    image: isCloudflareConfigured('image'),
  };
  try {
    const status = await getCloudflareAdminStatus();
    console.info('[AI:CLOUDFLARE] Startup diagnostics', {
      freeModeEnabled: status.settings.freeModeEnabled,
      universalFreeModeEnabled: status.settings.universalFreeModeEnabled,
      textAccountConfigured: configured.text,
      textAccountHealth: status.accounts.text.healthStatus,
      imageAccountConfigured: configured.image,
      imageAccountHealth: status.accounts.image.healthStatus,
      credentialsRedacted: true,
    });
  } catch {
    console.warn('[AI:CLOUDFLARE] Startup diagnostics incomplete; verify Supabase migration and provider environment configuration.', {
      textAccountConfigured: configured.text,
      imageAccountConfigured: configured.image,
      credentialsRedacted: true,
    });
  }
}

async function requestTextWithModel(params: any, model: string): Promise<any> {
  const credentials = credentialsFor('text');
  if (!credentials) throw requestError(0, 'Cloudflare text account is not configured.');

  const url = `${CLOUDFLARE_API_ROOT}/${encodeURIComponent(credentials.accountId)}/ai/v1/chat/completions`;
  const requestedMaxTokens = Number(params.max_tokens ?? params.max_completion_tokens ?? MAX_TEXT_OUTPUT_TOKENS);
  const maxTokens = Number.isFinite(requestedMaxTokens)
    ? Math.min(MAX_TEXT_OUTPUT_TOKENS, Math.max(1, Math.trunc(requestedMaxTokens)))
    : MAX_TEXT_OUTPUT_TOKENS;
  const requestBody = { ...params, model, stream: false, max_tokens: maxTokens };
  delete (requestBody as any).cloudflare_model;
  delete (requestBody as any).cloudflareModel;
  delete (requestBody as any).max_completion_tokens;

  let response: Response;
  let data: any;
  try {
    ({ response, data } = await fetchJson(url, credentials.apiToken, requestBody));
  } catch (error: any) {
    await recordAttempt('text', 0, 0, 'degraded');
    throw error;
  }

  if (!response.ok || data?.success === false) {
    const bodyMessage = getBodyErrorText(data);
    await recordHttpFailure('text', response.ok ? 400 : response.status, bodyMessage);
  }

  const usage = textTokenUsage(params, data);
  const neurons = estimateCloudflareTextNeurons(model, usage.inputTokens, usage.outputTokens);
  await recordAttempt('text', neurons, response.status, 'success');
  if (Array.isArray(data?.choices) && data.choices.length) return data;

  const text = String(data?.result?.response || data?.response || '');
  return {
    id: data?.id || `cloudflare-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  };
}

export async function generateCloudflareText(params: any, requestedModel?: string): Promise<any> {
  if (!(await isCloudflareAccountAvailable('text'))) {
    throw requestError(429, 'Cloudflare text account is not currently available.');
  }

  const selectedModel = resolveCloudflareModel('text', requestedModel || params?.cloudflare_model || params?.cloudflareModel);
  try {
    return await requestTextWithModel(params, selectedModel);
  } catch (error: any) {
    const fallbackModel = resolveCloudflareFallbackModel('text');
    if (!error?.isModelError || selectedModel === fallbackModel) throw error;
    console.warn('[AI:CLOUDFLARE] Text model was rejected; retrying the configured default model.');
    return requestTextWithModel(params, fallbackModel);
  }
}

async function requestImageWithModel(prompt: string, model: string): Promise<{ base64: string; mimeType: string }> {
  const credentials = credentialsFor('image');
  if (!credentials) throw requestError(0, 'Cloudflare image account is not configured.');

  const url = `${CLOUDFLARE_API_ROOT}/${encodeURIComponent(credentials.accountId)}/ai/run/${model}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (typeof timeout.unref === 'function') timeout.unref();

  let response: Response;
  let raw: ArrayBuffer;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    raw = await response.arrayBuffer();
  } catch {
    await recordAttempt('image', 0, 0, 'degraded');
    throw requestError(0, 'Cloudflare Workers AI image request timed out or could not connect.');
  } finally {
    clearTimeout(timeout);
  }

  const mimeType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let bodyMessage = '';
    try {
      bodyMessage = getBodyErrorText(JSON.parse(Buffer.from(raw).toString('utf8')));
    } catch {}
    await recordHttpFailure('image', response.status, bodyMessage);
  }
  if (response.ok && mimeType.includes('application/json')) {
    let data: any = {};
    try { data = JSON.parse(Buffer.from(raw).toString('utf8')); } catch {}
    if (data?.success === false) {
      await recordHttpFailure('image', 400, getBodyErrorText(data));
    }
  }

  let base64 = '';
  let resultMimeType = mimeType.startsWith('image/') ? mimeType.split(';')[0].trim() : 'image/png';
  if (mimeType.includes('application/json') || !mimeType) {
    let data: any = {};
    try { data = JSON.parse(Buffer.from(raw).toString('utf8')); } catch {}
    base64 = String(data?.result?.image || data?.image || '');
    resultMimeType = String(data?.result?.mimeType || data?.mimeType || resultMimeType).split(';')[0].trim();
  } else {
    base64 = Buffer.from(raw).toString('base64');
  }
  if (!base64) {
    await recordAttempt('image', 0, response.status, 'degraded');
    throw requestError(response.status, 'Cloudflare Workers AI returned no image data.');
  }

  const neurons = estimateCloudflareImageNeurons(model);
  await recordAttempt('image', neurons, response.status, 'success');
  return { base64, mimeType: resultMimeType };
}

export async function generateCloudflareImage(prompt: string, requestedModel?: string): Promise<{ base64: string; mimeType: string }> {
  if (!(await isCloudflareAccountAvailable('image'))) {
    throw requestError(429, 'Cloudflare image account is not currently available.');
  }

  const selectedModel = resolveCloudflareModel('image', requestedModel);
  try {
    return await requestImageWithModel(prompt, selectedModel);
  } catch (error: any) {
    const fallbackModel = resolveCloudflareFallbackModel('image');
    if (!error?.isModelError || selectedModel === fallbackModel) throw error;
    console.warn('[AI:CLOUDFLARE] Image model was rejected; retrying the configured default model.');
    return requestImageWithModel(prompt, fallbackModel);
  }
}

export const cloudflareAiLimits = {
  dailyNeuronsPerAccount: DAILY_NEURON_LIMIT,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
};
