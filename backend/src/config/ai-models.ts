import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';
import { getServiceSupabaseClient } from './supabase';
import {
  cloudflarePolicyAllows,
  generateCloudflareImage,
  generateCloudflareText,
  getCloudflareProviderSettings,
} from '../services/cloudflareWorkersAi';
import {
  aiProviderIsAvailable,
  getAIProviderHealth,
  recordAIProviderFailure,
  recordAIProviderSuccess,
  type AIProviderId,
  type AIProviderTask,
} from '../services/aiProviderHealth';
import {
  generateHuggingFaceImage,
  generateHuggingFaceVideo,
  HUGGING_FACE_IMAGE_MODEL,
  HUGGING_FACE_VIDEO_MODEL,
  isHuggingFaceConfigured,
} from '../services/huggingFaceInference';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});
const freeOpenAI = new OpenAI({
  apiKey: process.env.FREE_MODELS_API || '',
  baseURL: process.env.FREE_MODELS_BASE_URL || 'https://aihubmix.com/v1',
});
const freeFallbackOpenAI = new OpenAI({
  apiKey: process.env.FREE_MODELS_API || '',
  baseURL: process.env.FREE_MODELS_FALLBACK_BASE_URL || 'https://api.inferera.com',
});

const GEMINI_FLASH_MODEL = 'gemini-3.6-flash';
const GEMINI_VISION_MODEL = 'gemini-3.6-flash';
const OPENAI_STRATEGY_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o';
const FREE_TEXT_MODEL = 'gpt-4.1-free';
const FREE_SMALL_MODEL = 'gpt-4.1-nano-free';
const FREE_VISION_MODEL = 'gemini-3.1-flash-image-preview-free';
const FREE_IMAGE_MODEL = 'gemini-3.7-flash-free';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export type AIModelRole = 'general' | 'complex' | 'profile' | 'coordinator';

export const AI_MODEL_ASSIGNMENTS: Record<AIModelRole, string> = {
  general: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  complex: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  profile: 'deepseek-ai/deepseek-v4.1-flash',
  coordinator: 'nvidia/nemotron-3-ultra-550b-a55b',
};

export type AIRequestContext = {
  userId: string;
  plan: string;
  status: string;
  cloudflareTextModel?: string;
  cloudflareImageModel?: string;
};
const aiRequestContext = new AsyncLocalStorage<AIRequestContext>();
let persistedModeCache: { mode: 'tiered' | 'free' | 'paid'; expiresAt: number } | null = null;
const freeRequestTimes: number[] = [];
const freeDailyRequestTimes: number[] = [];
let cloudflareSettingsWarningLogged = false;

export function getAIRequestContext() {
  return aiRequestContext.getStore();
}

export function runWithAIRequestContext<T>(context: AIRequestContext, fn: () => T): T {
  return aiRequestContext.run(context, fn);
}

export type AIPolicyMode = 'tiered' | 'free' | 'paid';

async function getPersistedPolicyMode(): Promise<AIPolicyMode> {
  if (persistedModeCache && persistedModeCache.expiresAt > Date.now()) return persistedModeCache.mode;
  try {
    const { data } = await getServiceSupabaseClient()
      .from('model_override_config')
      .select('forced_model, override_active')
      .eq('operation', 'all')
      .maybeSingle();
    const forced = String(data?.forced_model || 'auto');
    const mode: AIPolicyMode = forced === 'free' || forced === 'economy'
      ? 'free'
      : forced === 'paid' || forced === 'premium' ? 'paid' : 'tiered';
    persistedModeCache = { mode: data?.override_active === false ? 'tiered' : mode, expiresAt: Date.now() + 5000 };
  } catch {
    persistedModeCache = { mode: 'tiered', expiresAt: Date.now() + 5000 };
  }
  return persistedModeCache.mode;
}

async function useFreeModels(userId?: string) {
  const mode = await getPersistedPolicyMode();
  let context = getAIRequestContext();
  if (!context && userId) {
    try {
      const { data } = await getServiceSupabaseClient()
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) context = { userId, plan: String(data.plan || 'none'), status: String(data.status || 'none') };
    } catch (error: any) {
      aiLog('POLICY', `Could not resolve subscription for background image request: ${error.message}`);
    }
  }
  if (mode === 'free') return true;
  if (mode === 'paid') return false;
  return !context || context.status === 'trialing' || context.plan === 'none' || context.plan === 'trial';
}

async function shouldRouteToCloudflare(userId?: string): Promise<boolean> {
  try {
    const mode = await getPersistedPolicyMode();
    if (mode === 'paid') return false;

    let context = getAIRequestContext();
    if (!context && userId) {
      try {
        const { data } = await getServiceSupabaseClient()
          .from('subscriptions')
          .select('plan, status')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) context = { userId, plan: String(data.plan || 'none'), status: String(data.status || 'none') };
      } catch {
        // The existing free-model policy remains authoritative if subscription
        // lookup is unavailable; Cloudflare stays opted out for this request.
        return false;
      }
    }

    const isFreeTierUser = !context ||
      context.status === 'trialing' ||
      context.plan === 'none' ||
      context.plan === 'trial';
    const settings = await getCloudflareProviderSettings();
    return cloudflarePolicyAllows(mode, isFreeTierUser, settings);
  } catch {
    if (!cloudflareSettingsWarningLogged) {
      cloudflareSettingsWarningLogged = true;
      console.warn('[AI:CLOUDFLARE] Provider settings are unavailable; keeping Cloudflare routing disabled until its Supabase migration is applied.');
    }
    return false;
  }
}

export async function isFreeAIRequest() {
  return useFreeModels();
}

function providerError(error: any): Error {
  const status = Number(error?.status || error?.response?.status || 0);
  if ([404, 429, 503].includes(status)) return new Error('The free AI service is busy right now. Please try again shortly.');
  return new Error(error?.message || 'AI service temporarily unavailable.');
}

async function reserveFreeQuota(estimatedTokens: number) {
  let reservation: any = null;
  try {
    const result = await getServiceSupabaseClient().rpc('reserve_free_ai_request', { p_tokens: estimatedTokens });
    if (result.error) throw result.error;
    reservation = result.data;
    if (!reservation?.allowed) {
      const active = Number(reservation.active || 5);
      const minutes = Math.max(1, Math.ceil(active / 5));
      throw Object.assign(new Error(`Free AI capacity is currently full (${active} users in use). Estimated wait: about ${minutes} minute${minutes === 1 ? '' : 's'}.`), { status: 429 });
    }
  } catch (error: any) {
    // Keep older deployments usable until the migration is applied; the local
    // limiter is conservative and is replaced automatically once RPC exists.
    if (!String(error?.message || '').includes('reserve_free_ai_request')) throw error;
    const now = Date.now();
    while (freeRequestTimes[0] && now - freeRequestTimes[0] >= 60_000) freeRequestTimes.shift();
    while (freeDailyRequestTimes[0] && now - freeDailyRequestTimes[0] >= 86_400_000) freeDailyRequestTimes.shift();
    if (freeRequestTimes.length >= 5 || freeDailyRequestTimes.length >= 500) {
      const minutes = Math.max(1, Math.ceil(freeRequestTimes.length / 5));
      throw Object.assign(new Error(`Free AI capacity is currently full (${freeRequestTimes.length} users in use). Estimated wait: about ${minutes} minute${minutes === 1 ? '' : 's'}.`), { status: 429 });
    }
    freeRequestTimes.push(now);
    freeDailyRequestTimes.push(now);
  }
  return reservation;
}

function aiProviderStatus() {
  const freeKeys = [
    process.env.FREE_MODELS_API,
    ...Array.from({ length: 20 }, (_, index) => process.env[`FREE_MODELS_API_${index + 1}`]),
  ];
  return getAIProviderHealth([
    { provider: 'nvidia', task: 'text', configured: Boolean(process.env.NVIDIA_API) },
    { provider: 'huggingface', task: 'image', configured: isHuggingFaceConfigured() },
    { provider: 'huggingface', task: 'video', configured: isHuggingFaceConfigured() },
    { provider: 'cloudflare_workers_ai', task: 'text', configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) },
    { provider: 'cloudflare_workers_ai', task: 'image', configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) },
    { provider: 'free_models', task: 'text', configured: freeKeys.some(Boolean) },
    { provider: 'free_models', task: 'image', configured: freeKeys.some(Boolean) },
    { provider: 'openai', task: 'text', configured: Boolean(process.env.OPENAI_API_KEY) },
    { provider: 'gemini', task: 'text', configured: Boolean(process.env.GEMINI_API_KEY) },
    { provider: 'gemini', task: 'image', configured: Boolean(process.env.GEMINI_API_KEY) },
    { provider: 'runway', task: 'video', configured: Boolean(process.env.RUNWAY_API_KEY) },
  ]);
}

async function nvidiaChat(params: any, role: AIModelRole, task: AIProviderTask = 'text') {
  const apiKey = String(process.env.NVIDIA_API || '').trim();
  if (!apiKey) throw Object.assign(new Error('NVIDIA_API is not configured.'), { providerNotConfigured: true });
  if (!aiProviderIsAvailable('nvidia', task)) {
    throw Object.assign(new Error('NVIDIA provider is cooling down after a recent failure.'), { status: 429 });
  }

  const request = { ...params, model: AI_MODEL_ASSIGNMENTS[role] };
  delete request.cloudflare_model;
  delete request.cloudflareModel;
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: NVIDIA_BASE_URL,
      maxRetries: 0,
      timeout: 60_000,
    });
    const response = await client.chat.completions.create(request);
    if (!response?.choices?.[0]) throw Object.assign(new Error('NVIDIA returned an empty chat completion.'), { status: 502 });
    recordAIProviderSuccess('nvidia', task);
    return response;
  } catch (error) {
    recordAIProviderFailure('nvidia', task, error);
    throw error;
  }
}

async function paidChat(params: any, role: AIModelRole, task: AIProviderTask = 'text') {
  let lastError: any;
  if (String(process.env.NVIDIA_API || '').trim()) {
    try {
      return await nvidiaChat(params, role, task);
    } catch (error: any) {
      lastError = error;
      aiLog('NVIDIA', 'Provider failed; rotating to configured paid providers', {
        status: error?.status || error?.statusCode || error?.response?.status || 'unknown',
      });
    }
  }

  if (String(process.env.OPENAI_API_KEY || '').trim()) {
    if (aiProviderIsAvailable('openai', task)) {
      try {
        const request = { ...params, model: OPENAI_STRATEGY_MODEL };
        delete request.cloudflare_model;
        delete request.cloudflareModel;
        const response = await openai.chat.completions.create(request);
        if (!response?.choices?.[0]) throw Object.assign(new Error('OpenAI returned an empty chat completion.'), { status: 502 });
        recordAIProviderSuccess('openai', task);
        return response;
      } catch (error: any) {
        lastError = error;
        recordAIProviderFailure('openai', task, error);
      }
    } else {
      lastError = new Error('OpenAI provider is cooling down after a recent failure.');
    }
  }

  throw lastError || new Error('No configured paid text AI provider is available.');
}

async function freeChat(params: any, role: AIModelRole = 'general') {
  const reservation = await reserveFreeQuota(Number(params.max_tokens || 4096));
  const keys = Array.from(new Set([
    process.env.FREE_MODELS_API,
    ...Array.from({ length: 20 }, (_, index) => process.env[`FREE_MODELS_API_${index + 1}`]),
  ].filter(Boolean))) as string[];
  const baseUrls = Array.from(new Set([
    process.env.FREE_MODELS_BASE_URL || 'https://aihubmix.com/v1',
    process.env.FREE_MODELS_FALLBACK_BASE_URL || 'https://api.inferera.com',
  ]));
  const existingProviderParams = { ...params };
  delete existingProviderParams.cloudflare_model;
  delete existingProviderParams.cloudflareModel;
  let lastError: any;

  if (String(process.env.NVIDIA_API || '').trim() && aiProviderIsAvailable('nvidia', 'text')) {
    try {
      const response = await nvidiaChat(existingProviderParams, role, 'text');
      const usage = Number((response as any).usage?.total_tokens || 0);
      await getServiceSupabaseClient().from('ai_usage_logs').insert({
        user_id: getAIRequestContext()?.userId || null,
        model: AI_MODEL_ASSIGNMENTS[role],
        operation: 'free_ai_request',
        actual_cost_usd: 0,
        energy_debited: 0,
        metadata: { tokens: usage, quota: reservation, provider: 'nvidia' },
      });
      return response;
    } catch (error: any) {
      lastError = error;
      aiLog('NVIDIA', 'Free-mode provider failed; rotating to other configured free providers', {
        status: error?.status || error?.statusCode || error?.response?.status || 'unknown',
      });
    }
  }

  if (await shouldRouteToCloudflare()) {
    try {
      const response = await generateCloudflareText(params);
      recordAIProviderSuccess('cloudflare_workers_ai', 'text');
      const usage = Number((response as any).usage?.total_tokens || 0);
      await getServiceSupabaseClient().from('ai_usage_logs').insert({
        user_id: getAIRequestContext()?.userId || null,
        model: params.model,
        operation: 'free_ai_request',
        actual_cost_usd: 0,
        energy_debited: 0,
        metadata: { tokens: usage, quota: reservation, provider: 'cloudflare_workers_ai', neuronUsageEstimated: true },
      });
      return response;
    } catch (error: any) {
      lastError = error;
      recordAIProviderFailure('cloudflare_workers_ai', 'text', error);
      console.warn(`[AI:CLOUDFLARE] Text provider failed; rotating to existing free providers status=${error?.statusCode || error?.status || 'unknown'}`);
    }
  }

  if (!keys.length) {
    throw lastError || new Error('Free AI providers are not configured.');
  }
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const apiKey = keys[keyIndex];
    for (const baseURL of baseUrls) {
      try {
        const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 60_000 });
        const response = await client.chat.completions.create(existingProviderParams);
        if (!response?.choices?.[0]) throw Object.assign(new Error('Free provider returned an empty chat completion.'), { status: 502 });
        recordAIProviderSuccess('free_models', 'text');
        const usage = Number((response as any).usage?.total_tokens || 0);
        await getServiceSupabaseClient().from('ai_usage_logs').insert({
          user_id: getAIRequestContext()?.userId || null,
          model: params.model,
          operation: 'free_ai_request',
          actual_cost_usd: 0,
          energy_debited: 0,
          metadata: { tokens: usage, quota: reservation, provider: 'free_models' },
        });
        return response;
      } catch (error: any) {
        lastError = error;
        recordAIProviderFailure('free_models', 'text', error);
        console.warn(`[AI:FREE] Provider failed; rotating route key=${keyIndex + 1}/${keys.length} base=${baseURL} status=${error?.status || error?.response?.status || 'unknown'} reason=${error?.message || 'unknown'}`);
      }
    }
  }

  throw lastError || new Error('Free AI service is unavailable.');
}

// ── Global admin model override ────────────────────────────────────────────────
// Admin can switch the entire system between 'auto' | 'economy' | 'premium'.
// 'auto'    = CMA decides based on tier/burn-rate (default)
// 'economy' = force all strategy ops to Gemini Flash (cheaper/faster)
// 'premium' = force all economy ops up to GPT-4o (best quality)
let _globalModelOverride: 'auto' | 'economy' | 'premium' = 'auto';
let _modelOverrideReason = '';
let _modelOverrideSetAt: string | null = null;

export function getModelOverride() {
  return { mode: _globalModelOverride, reason: _modelOverrideReason, setAt: _modelOverrideSetAt };
}

export function setModelOverride(mode: 'auto' | 'economy' | 'premium', reason = '') {
  _globalModelOverride = mode;
  _modelOverrideReason = reason;
  _modelOverrideSetAt = mode === 'auto' ? null : new Date().toISOString();
  persistedModeCache = { mode: mode === 'economy' ? 'free' : mode === 'premium' ? 'paid' : 'tiered', expiresAt: Date.now() + 5000 };
  console.log(`[AI:ModelOverride] Set to '${mode}'${reason ? ` — ${reason}` : ''}`);
}

function aiLog(engine: string, action: string, detail?: any) {
  const ts = new Date().toISOString();
  const base = `[AI:${engine}] [${ts}] ${action}`;
  if (detail) {
    console.log(base, typeof detail === 'object' ? JSON.stringify(detail).substring(0, 300) : detail);
  } else {
    console.log(base);
  }
}

export interface AIResponse {
  text: string;
  parsedJson?: any;
}

function stripCodeFences(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractBalancedJson(value: string): string | null {
  const firstJsonStart = value.search(/[\[{]/);
  if (firstJsonStart < 0) return null;

  const pairs: Record<string, string> = { '{': '}', '[': ']' };
  const stack: string[] = [];
  let start = -1;

  for (let i = firstJsonStart; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '{' || char === '[') && start < 0) {
      start = i;
      stack.push(char);
      continue;
    }
    if (start < 0) continue;
    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']') {
      const opener = stack.pop();
      if (!opener || pairs[opener] !== char) {
        return null;
      }
      if (stack.length === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseStructuredJson(raw: string | undefined | null): any {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  try {
    return JSON.parse(stripCodeFences(text));
  } catch (_e) {
    // Try to recover from text that surrounds the JSON payload.
  }

  const candidateStart = text.search(/[\[{]/);
  if (candidateStart >= 0) {
    const candidate = text.slice(candidateStart);
    const balanced = extractBalancedJson(candidate);
    if (balanced) {
      try {
        return JSON.parse(stripCodeFences(balanced));
      } catch (_e) {
        // ignore and fall through
      }
    }
  }

  return null;
}

export class AIEngine {
  private static instance: AIEngine;
  
  private constructor() {}
  
  public static getInstance(): AIEngine {
    if (!AIEngine.instance) {
      AIEngine.instance = new AIEngine();
    }
    return AIEngine.instance;
  }

  async analyzeImage(imageBase64: string, prompt: string, userId?: string): Promise<AIResponse> {
    if (await useFreeModels(userId)) return this.analyzeImageFree(imageBase64, prompt);
    const messages = [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
    ] as any }];
    try {
      const completion = await paidChat({
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }, 'profile', 'image');
      const text = completion.choices[0]?.message?.content || '';
      return { text, parsedJson: parseStructuredJson(text) };
    } catch (primaryError: any) {
      if (!String(process.env.GEMINI_API_KEY || '').trim() || !aiProviderIsAvailable('gemini', 'image')) {
        throw new Error(`Image analysis failed after provider rotation: ${primaryError?.message || 'no provider response'}`);
      }
      try {
        const model = genAI.getGenerativeModel({ model: GEMINI_VISION_MODEL });
        const result = await model.generateContent([prompt, {
          inlineData: { data: imageBase64, mimeType: 'image/jpeg' as const },
        }]);
        const response = await result.response;
        const text = response.text();
        recordAIProviderSuccess('gemini', 'image');
        return { text, parsedJson: parseStructuredJson(text) };
      } catch (error: any) {
        recordAIProviderFailure('gemini', 'image', error);
        throw new Error(`Image analysis failed on NVIDIA/OpenAI and Gemini: ${error.message}`);
      }
    }
  }

  async generateStrategy(
    context: any,
    prompt: string,
    options?: { modelRole?: AIModelRole; userId?: string },
  ): Promise<AIResponse> {
    const role = options?.modelRole || 'general';
    if (await useFreeModels(options?.userId)) return this.generateStrategyFree(context, prompt, role);
    if (_globalModelOverride === 'economy') {
      aiLog('AI', 'generateStrategy OVERRIDE→economy (admin forced)');
      return this.generateStrategyEconomy(context, prompt, role);
    }

    const messages = [
      {
        role: 'system',
        content: 'You are Adirum AI Core Brain. Always respond with valid JSON only, no markdown, no code blocks.',
      },
      { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` },
    ];
    try {
      const completion = await paidChat({
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }, role);
      const text = completion.choices[0]?.message?.content || '';
      return { text, parsedJson: parseStructuredJson(text) };
    } catch (primaryError: any) {
      if (!String(process.env.GEMINI_API_KEY || '').trim() || !aiProviderIsAvailable('gemini', 'text')) {
        throw new Error(`Strategy generation failed after provider rotation: ${primaryError?.message || 'no provider response'}`);
      }
      try {
        const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
        const result = await model.generateContent([
          'You are Adirum AI Core Brain. Return ONLY valid JSON, no markdown, no code blocks.',
          `Context: ${JSON.stringify(context)}`,
          `Task: ${prompt}`,
        ].join('\n\n'));
        const response = await result.response;
        const text = response.text().trim();
        recordAIProviderSuccess('gemini', 'text');
        return { text, parsedJson: parseStructuredJson(text) };
      } catch (error: any) {
        recordAIProviderFailure('gemini', 'text', error);
        throw new Error(`Strategy generation failed on configured providers: ${error.message}`);
      }
    }
  }

  private async generateStrategyFree(context: any, prompt: string, role: AIModelRole = 'general'): Promise<AIResponse> {
    try {
      const completion = await freeChat({
        model: FREE_TEXT_MODEL,
        cloudflare_model: context?.cloudflareTextModel,
        messages: [
          { role: 'system', content: 'You are Adirum AI Core Brain. Return valid JSON only, without markdown.' },
          { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }, role);
      const text = completion.choices[0]?.message?.content || '';
      const parsedJson = parseStructuredJson(text);
      return { text, parsedJson };
    } catch (error: any) { throw providerError(error); }
  }

  private async analyzeImageFree(imageBase64: string, prompt: string): Promise<AIResponse> {
    try {
      const completion = await freeChat({
        model: FREE_VISION_MODEL,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ] as any }],
        response_format: { type: 'json_object' },
      }, 'profile');
      const text = completion.choices[0]?.message?.content || '';
      const parsedJson = parseStructuredJson(text);
      return { text, parsedJson };
    } catch (error: any) { throw providerError(error); }
  }

  /**
   * Strategy generation through the same role-aware provider rotation.
   */
  async generateStrategyEconomy(context: any, prompt: string, role: AIModelRole = 'complex'): Promise<AIResponse> {
    if (await useFreeModels()) {
      aiLog('AI', 'generateStrategyEconomy ROUTE->free-provider');
      return this.generateStrategyFree(context, prompt, role);
    }
    if (_globalModelOverride === 'premium') {
      aiLog('AI', 'generateStrategyEconomy OVERRIDE→premium (admin forced)');
      return this._generateStrategyOpenAI(context, prompt, role);
    }
    const messages = [
      { role: 'system', content: 'You are Adirum AI Core Brain. Return ONLY valid JSON, no markdown, no code blocks.' },
      { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` },
    ];
    try {
      const completion = await paidChat({ messages, response_format: { type: 'json_object' }, temperature: 0.7 }, role);
      const text = completion.choices[0]?.message?.content || '';
      return { text, parsedJson: parseStructuredJson(text) };
    } catch (primaryError: any) {
      if (!String(process.env.GEMINI_API_KEY || '').trim() || !aiProviderIsAvailable('gemini', 'text')) {
        throw new Error(`Strategy generation failed after provider rotation: ${primaryError?.message || 'no provider response'}`);
      }
      try {
        const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
        const result = await model.generateContent([
          'You are Adirum AI Core Brain. Return ONLY valid JSON, no markdown, no code blocks.',
          `Context: ${JSON.stringify(context)}`,
          `Task: ${prompt}`,
        ].join('\n\n'));
        const response = await result.response;
        const text = response.text().trim();
        recordAIProviderSuccess('gemini', 'text');
        return { text, parsedJson: parseStructuredJson(text) };
      } catch (error: any) {
        recordAIProviderFailure('gemini', 'text', error);
        throw new Error(`Strategy generation failed on configured providers: ${error.message}`);
      }
    }
  }

  async generateDeepProductBrandAnalysis(prompt: string): Promise<AIResponse> {
    // Free mode uses the shared provider rotation and quota controls. The
    // previous hardcoded model bypassed that route and returned a multipart
    // error from the provider.
    if (await useFreeModels()) {
      return this.generateStrategyFree({}, prompt, 'general');
    }

    return this.generateStrategyEconomy({}, prompt, 'general');
  }

  // Internal helper used when admin forces premium mode on economy calls
  private async _generateStrategyOpenAI(context: any, prompt: string, role: AIModelRole = 'complex'): Promise<AIResponse> {
    const completion = await paidChat({
      messages: [
        { role: 'system', content: 'You are Adirum AI Core Brain. Always respond with valid JSON only, no markdown, no code blocks.' },
        { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }, role);
    const text = completion.choices[0]?.message?.content || '';
    return { text, parsedJson: parseStructuredJson(text) };
  }

  async generateJson(
    prompt: string,
    options?: { cloudflareModel?: string; economyMode?: boolean; modelRole?: AIModelRole; userId?: string },
  ): Promise<any> {
    const role = options?.modelRole || 'general';
    const context = { cloudflareTextModel: options?.cloudflareModel };
    if (await useFreeModels(options?.userId)) {
      const completion = await freeChat({
        model: FREE_TEXT_MODEL,
        cloudflare_model: options?.cloudflareModel,
        messages: [{ role: 'user', content: `Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}` }],
        response_format: { type: 'json_object' },
      }, role);
      const parsed = parseStructuredJson(completion.choices[0]?.message?.content || '');
      if (parsed === null) throw new Error('Free AI providers returned a response that was not valid JSON.');
      return parsed;
    }
    if (options?.economyMode === false) {
      const result = await this.generateStrategy({}, prompt, { modelRole: role, userId: options?.userId });
      if (result.parsedJson === null || result.parsedJson === undefined) throw new Error('AI providers returned a response that was not valid JSON.');
      return result.parsedJson;
    }

    const messages = [{ role: 'user', content: `Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}` }];
    try {
      const completion = await paidChat({ messages, response_format: { type: 'json_object' } }, role);
      const parsed = parseStructuredJson(completion.choices[0]?.message?.content || '');
      if (parsed === null) throw new Error('Configured AI providers returned a response that was not valid JSON.');
      return parsed;
    } catch (primaryError: any) {
      if (!String(process.env.GEMINI_API_KEY || '').trim() || !aiProviderIsAvailable('gemini', 'text')) throw primaryError;
      try {
        const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
        const result = await model.generateContent(`Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}`);
        const response = await result.response;
        const text = response.text().trim();
        recordAIProviderSuccess('gemini', 'text');
        const parsed = parseStructuredJson(text);
        if (parsed === null) throw new Error('Gemini returned a response that was not valid JSON.');
        return parsed;
      } catch (error: any) {
        recordAIProviderFailure('gemini', 'text', error);
        throw new Error(`JSON generation failed after provider rotation: ${error.message}`);
      }
    }
  }

  async generateText(
    prompt: string,
    options?: { cloudflareModel?: string; modelRole?: AIModelRole; userId?: string },
  ): Promise<string> {
    const role = options?.modelRole || 'general';
    if (await useFreeModels(options?.userId)) {
      const result = await freeChat({
        model: FREE_SMALL_MODEL,
        cloudflare_model: options?.cloudflareModel || getAIRequestContext()?.cloudflareTextModel,
        messages: [{ role: 'user', content: prompt }],
      }, role);
      const text = result.choices[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('Free AI providers returned an empty text response.');
      return text;
    }

    try {
      const completion = await paidChat({ messages: [{ role: 'user', content: prompt }] }, role);
      const text = completion.choices[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('Configured AI providers returned an empty text response.');
      return text;
    } catch (primaryError: any) {
      if (!String(process.env.GEMINI_API_KEY || '').trim() || !aiProviderIsAvailable('gemini', 'text')) throw primaryError;
      try {
        const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        if (!text.trim()) throw new Error('Gemini returned an empty text response.');
        recordAIProviderSuccess('gemini', 'text');
        return text;
      } catch (error: any) {
        recordAIProviderFailure('gemini', 'text', error);
        throw new Error(`Text generation failed after provider rotation: ${error.message}`);
      }
    }
  }

  async generateImage(
    imagePrompt: string,
    userId?: string,
    options?: { cloudflareModel?: string },
  ): Promise<{ base64: string; mimeType: string }> {
    const freeMode = await useFreeModels(userId);
    const errors: any[] = [];
    if (freeMode) await reserveFreeQuota(0);

    if (isHuggingFaceConfigured() && aiProviderIsAvailable('huggingface', 'image')) {
      try {
        const image = await generateHuggingFaceImage(imagePrompt);
        if (freeMode) {
          await getServiceSupabaseClient().from('ai_usage_logs').insert({
            user_id: getAIRequestContext()?.userId || userId || null,
            model: HUGGING_FACE_IMAGE_MODEL,
            operation: 'free_ai_request',
            actual_cost_usd: 0,
            energy_debited: 0,
            metadata: { tokens: 0, provider: 'huggingface' },
          });
        }
        return image;
      } catch (error: any) {
        errors.push(error);
        aiLog('HUGGINGFACE-IMAGE', 'Provider failed; rotating to other allowed image providers', {
          status: error?.status || error?.statusCode || error?.response?.status || 'unknown',
        });
      }
    }

    if (freeMode) {
      if (await shouldRouteToCloudflare(userId) && aiProviderIsAvailable('cloudflare_workers_ai', 'image')) {
        try {
          const image = await generateCloudflareImage(
            imagePrompt,
            options?.cloudflareModel || getAIRequestContext()?.cloudflareImageModel,
          );
          recordAIProviderSuccess('cloudflare_workers_ai', 'image');
          await getServiceSupabaseClient().from('ai_usage_logs').insert({
            user_id: getAIRequestContext()?.userId || userId || null,
            model: 'cloudflare_workers_ai',
            operation: 'free_ai_request',
            actual_cost_usd: 0,
            energy_debited: 0,
            metadata: { tokens: 0, provider: 'cloudflare_workers_ai', neuronUsageEstimated: true },
          });
          return image;
        } catch (error: any) {
          errors.push(error);
          recordAIProviderFailure('cloudflare_workers_ai', 'image', error);
        }
      }

      const mediaUrls = [
        `${(process.env.FREE_MODELS_MEDIA_BASE_URL || 'https://aihubmix.com/ai/v1').replace(/\/$/, '')}/images/generations`,
        `${(process.env.FREE_MODELS_FALLBACK_MEDIA_BASE_URL || 'https://api.inferera.com/ai/v1').replace(/\/$/, '')}/images/generations`,
      ];
      const apiKeys = Array.from(new Set([
        process.env.FREE_MODELS_API,
        ...Array.from({ length: 20 }, (_, index) => process.env[`FREE_MODELS_API_${index + 1}`]),
      ].filter(Boolean))) as string[];

      for (const apiKey of apiKeys) {
        for (const url of mediaUrls) {
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: FREE_IMAGE_MODEL, prompt: imagePrompt, n: 1, response_format: 'b64_json' }),
              signal: AbortSignal.timeout(60_000),
            });
            const data: any = await response.json().catch(() => ({}));
            if (!response.ok) {
              const error = Object.assign(new Error(data?.error?.message || data?.message || `Free image provider returned HTTP ${response.status}`), { status: response.status });
              errors.push(error);
              recordAIProviderFailure('free_models', 'image', error);
              continue;
            }
            const base64 = data?.data?.[0]?.b64_json;
            if (!base64) {
              const error = Object.assign(new Error('Free image provider returned no image data.'), { status: 502 });
              errors.push(error);
              recordAIProviderFailure('free_models', 'image', error);
              continue;
            }
            recordAIProviderSuccess('free_models', 'image');
            await getServiceSupabaseClient().from('ai_usage_logs').insert({
              user_id: getAIRequestContext()?.userId || userId || null,
              model: FREE_IMAGE_MODEL,
              operation: 'free_ai_request',
              actual_cost_usd: 0,
              energy_debited: 0,
              metadata: { tokens: 0, provider: 'free_models' },
            });
            return { base64, mimeType: 'image/png' };
          } catch (error: any) {
            errors.push(error);
            recordAIProviderFailure('free_models', 'image', error);
          }
        }
      }

      throw new Error(errors.length
        ? `Image generation failed on all configured free providers: ${errors.map((error) => error?.message || 'provider error').join(' | ')}`
        : 'No configured image provider is available in free mode.');
    }

    if (String(process.env.GEMINI_API_KEY || '').trim() && aiProviderIsAvailable('gemini', 'image')) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: imagePrompt }],
              parameters: { sampleCount: 1, aspectRatio: '1:1' },
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );
        const data: any = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw Object.assign(new Error(data?.error?.message || `Gemini Imagen returned HTTP ${response.status}`), { status: response.status });
        }
        const base64 = data?.predictions?.[0]?.bytesBase64Encoded;
        const mimeType = data?.predictions?.[0]?.mimeType || 'image/png';
        if (!base64) throw Object.assign(new Error('Gemini Imagen returned no image data.'), { status: 502 });
        recordAIProviderSuccess('gemini', 'image');
        return { base64, mimeType };
      } catch (error: any) {
        recordAIProviderFailure('gemini', 'image', error);
        errors.push(error);
      }
    }

    throw new Error(errors.length
      ? `Image generation failed on all configured providers: ${errors.map((error) => error?.message || 'provider error').join(' | ')}`
      : 'No image generation provider is configured.');
  }

  async generateVideo(
    promptText: string,
    imageBase64?: string | null,
    imageMime = 'image/png',
  ): Promise<{ url: string; taskId: string }> {
    const freeMode = await useFreeModels();
    const errors: any[] = [];

    if (!imageBase64 && isHuggingFaceConfigured() && aiProviderIsAvailable('huggingface', 'video')) {
      try {
        return await generateHuggingFaceVideo(promptText);
      } catch (error: any) {
        errors.push(error);
        aiLog('HUGGINGFACE-VIDEO', 'Provider failed; rotating to an allowed video provider', {
          status: error?.status || error?.statusCode || error?.response?.status || 'unknown',
        });
      }
    }

    // Free mode must not unexpectedly spend a paid Runway key. The configured
    // Hugging Face provider is the free-mode text-to-video route.
    if (freeMode) {
      throw new Error(errors.length
        ? `Video generation failed on Hugging Face: ${errors.map((error) => error?.message || 'provider error').join(' | ')}`
        : imageBase64
          ? 'Image-to-video is not supported by the configured free-mode video model.'
          : 'Hugging Face video inference is not configured in free mode; set HF_TOKEN in Railway.');
    }

    const key = String(process.env.RUNWAY_API_KEY || '').trim();
    if (!key) {
      throw new Error(errors.length
        ? `Video generation failed on Hugging Face and no Runway provider is configured: ${errors.map((error) => error?.message || 'provider error').join(' | ')}`
        : 'No video generation provider is configured.');
    }
    if (!aiProviderIsAvailable('runway', 'video')) {
      throw new Error('Runway video provider is cooling down after a recent failure.');
    }

    try {
      const body: Record<string, unknown> = {
        model: 'gen3a_turbo',
        promptText: promptText.slice(0, 512),
        duration: 5,
        ratio: '1280:768',
      };
      if (imageBase64) body.promptImage = `data:${imageMime};base64,${imageBase64}`;
      const createRes = await fetch('https://api.runwayml.com/v1/image_to_video', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!createRes.ok) {
        const err: any = await createRes.json().catch(() => ({}));
        throw Object.assign(new Error(err?.error || err?.message || `Runway API returned HTTP ${createRes.status}`), { status: createRes.status });
      }
      const { id: taskId } = await createRes.json() as any;
      if (!taskId) throw Object.assign(new Error('Runway returned no task ID.'), { status: 502 });

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 8_000));
        const pollRes = await fetch(`https://api.runwayml.com/v1/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06' },
          signal: AbortSignal.timeout(30_000),
        });
        if (!pollRes.ok) {
          throw Object.assign(new Error(`Runway task status returned HTTP ${pollRes.status}`), { status: pollRes.status });
        }
        const task: any = await pollRes.json();
        if (task.status === 'SUCCEEDED' && task.output?.[0]) {
          recordAIProviderSuccess('runway', 'video');
          return { url: task.output[0] as string, taskId: String(taskId) };
        }
        if (task.status === 'FAILED') throw Object.assign(new Error('Runway video generation failed.'), { status: 502 });
      }
      throw Object.assign(new Error('Runway video generation exceeded its time limit.'), { status: 504 });
    } catch (error: any) {
      recordAIProviderFailure('runway', 'video', error);
      throw new Error(`Video generation failed after provider rotation: ${error.message}`);
    }
  }
}
