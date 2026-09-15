import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';
import { getServiceSupabaseClient } from './supabase';

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
const FREE_IMAGE_MODEL = 'gpt-image-2-free';

export type AIRequestContext = { userId: string; plan: string; status: string };
const aiRequestContext = new AsyncLocalStorage<AIRequestContext>();
let persistedModeCache: { mode: 'tiered' | 'free' | 'paid'; expiresAt: number } | null = null;
const freeRequestTimes: number[] = [];
const freeDailyRequestTimes: number[] = [];

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

async function useFreeModels() {
  const mode = await getPersistedPolicyMode();
  const context = getAIRequestContext();
  if (mode === 'free') return true;
  if (mode === 'paid') return false;
  return !context || context.status === 'trialing' || context.plan === 'none' || context.plan === 'trial';
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

async function freeChat(params: any) {
  const reservation = await reserveFreeQuota(Number(params.max_tokens || 4096));
  const keys = Array.from(new Set([
    process.env.FREE_MODELS_API,
    ...Array.from({ length: 20 }, (_, index) => process.env[`FREE_MODELS_API_${index + 1}`]),
  ].filter(Boolean))) as string[];
  const baseUrls = Array.from(new Set([
    process.env.FREE_MODELS_BASE_URL || 'https://aihubmix.com/v1',
    process.env.FREE_MODELS_FALLBACK_BASE_URL || 'https://api.inferera.com',
  ]));
  let lastError: any;

  for (const apiKey of keys) {
    for (const baseURL of baseUrls) {
      try {
        const client = new OpenAI({ apiKey, baseURL });
        const response = await client.chat.completions.create(params);
        const usage = Number((response as any).usage?.total_tokens || 0);
        await getServiceSupabaseClient().from('ai_usage_logs').insert({
          user_id: getAIRequestContext()?.userId || null,
          model: params.model,
          operation: 'free_ai_request',
          actual_cost_usd: 0,
          energy_debited: 0,
          metadata: { tokens: usage, quota: reservation },
        });
        return response;
      } catch (error: any) {
        lastError = error;
        console.warn(`[AI:FREE] Provider failed; rotating free-model route (${baseURL}).`);
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

  async analyzeImage(imageBase64: string, prompt: string): Promise<AIResponse> {
    if (await useFreeModels()) return this.analyzeImageFree(imageBase64, prompt);
    aiLog('GEMINI-VISION', `analyzeImage START — model: ${GEMINI_VISION_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_VISION_MODEL });
      
      const imagePart = {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg' as const,
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      
      let parsedJson;
      try {
        parsedJson = parseStructuredJson(text);
      } catch (_e) {
        console.warn('[AI:GEMINI-VISION] Could not parse JSON, returning raw text');
      }

      aiLog('GEMINI-VISION', 'analyzeImage SUCCESS', { textLength: text.length, hasParsedJson: !!parsedJson });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GEMINI-VISION', 'analyzeImage ERROR', error.message);
      throw new Error(`Gemini Vision Analysis Failed: ${error.message}`);
    }
  }

  async generateStrategy(context: any, prompt: string): Promise<AIResponse> {
    if (await useFreeModels()) return this.generateStrategyFree(context, prompt);
    // Admin economy override: route premium request to Gemini Flash
    if (_globalModelOverride === 'economy') {
      aiLog('GPT-4o', 'generateStrategy OVERRIDE→economy (admin forced)');
      return this.generateStrategyEconomy(context, prompt);
    }
    aiLog('GPT-4o', `generateStrategy START — model: ${OPENAI_STRATEGY_MODEL}`);
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are Adirum AI Core Brain — a world-class marketing strategist. Always respond with valid JSON only, no markdown, no code blocks.',
          },
          {
            role: 'user',
            content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}`,
          },
        ],
        model: OPENAI_STRATEGY_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const text = completion.choices[0].message.content || '';
      let parsedJson;
      try {
        parsedJson = parseStructuredJson(text);
      } catch (_e) {
        console.warn('[AI:GPT-4o] Could not parse JSON from response');
      }

      aiLog('GPT-4o', 'generateStrategy SUCCESS', { textLength: text.length });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GPT-4o', 'generateStrategy ERROR', error.message);
      throw new Error(`OpenAI Strategy Generation Failed: ${error.message}`);
    }
  }

  private async generateStrategyFree(context: any, prompt: string): Promise<AIResponse> {
    try {
      const completion = await freeChat({
        model: FREE_TEXT_MODEL,
        messages: [
          { role: 'system', content: 'You are Adirum AI Core Brain. Return valid JSON only, without markdown.' },
          { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });
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
      });
      const text = completion.choices[0]?.message?.content || '';
      const parsedJson = parseStructuredJson(text);
      return { text, parsedJson };
    } catch (error: any) { throw providerError(error); }
  }

  /**
   * Economy strategy generation using Gemini Flash.
   * Used by the Credit Management Agent for non-Pro users.
   * Produces the same JSON structure as generateStrategy.
   */
  async generateStrategyEconomy(context: any, prompt: string): Promise<AIResponse> {
    // Admin premium override: route economy request up to GPT-4o
    if (_globalModelOverride === 'premium') {
      aiLog('GEMINI-FLASH', 'generateStrategyEconomy OVERRIDE→premium (admin forced)');
      return this._generateStrategyOpenAI(context, prompt);
    }
    aiLog('GEMINI-FLASH', `generateStrategyEconomy START (economy routing)`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const fullPrompt = [
        'You are Adirum AI Core Brain — a world-class marketing strategist.',
        'Return ONLY valid JSON, no markdown, no code blocks.',
        `Context: ${JSON.stringify(context)}`,
        `Task: ${prompt}`,
      ].join('\n\n');
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text().trim();
      const parsedJson = parseStructuredJson(text);
      aiLog('GEMINI-FLASH', 'generateStrategyEconomy SUCCESS', { textLength: text.length });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GEMINI-FLASH', 'generateStrategyEconomy ERROR', error.message);
      throw new Error(`Gemini Economy Strategy Failed: ${error.message}`);
    }
  }

  async generateDeepProductBrandAnalysis(prompt: string): Promise<AIResponse> {
    if (await useFreeModels()) {
      const response = await freeChat({
        model: 'gemini-3.7-flash-free',
        messages: [{ role: 'user', content: `Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}` }],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      });
      const text = response.choices[0]?.message?.content || '';
      return { text, parsedJson: parseStructuredJson(text) };
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
    const result = await model.generateContent(`Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}`);
    const text = (await result.response).text();
    return { text, parsedJson: parseStructuredJson(text) };
  }

  // Internal helper used when admin forces premium mode on economy calls
  private async _generateStrategyOpenAI(context: any, prompt: string): Promise<AIResponse> {
    aiLog('GPT-4o', `_generateStrategyOpenAI START (premium override)`);
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are Adirum AI Core Brain — a world-class marketing strategist. Always respond with valid JSON only, no markdown, no code blocks.' },
          { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nTask: ${prompt}` },
        ],
        model: OPENAI_STRATEGY_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });
      const text = completion.choices[0].message.content || '';
      const parsedJson = parseStructuredJson(text);
      aiLog('GPT-4o', '_generateStrategyOpenAI SUCCESS', { textLength: text.length });
      return { text, parsedJson };
    } catch (error: any) {
      aiLog('GPT-4o', '_generateStrategyOpenAI ERROR', error.message);
      throw new Error(`OpenAI Premium Override Failed: ${error.message}`);
    }
  }

  async generateJson(prompt: string): Promise<any> {
    if (await useFreeModels()) return (await this.generateStrategyFree({}, prompt)).parsedJson ?? null;
    aiLog('GEMINI-FLASH', `generateJson START — model: ${GEMINI_FLASH_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const result = await model.generateContent(
        `Return ONLY valid JSON, no markdown fences, no explanation.\n\n${prompt}`
      );
      const response = await result.response;
      const text = response.text().trim();
      aiLog('GEMINI-FLASH', 'generateJson SUCCESS', { textLength: text.length });
      return parseStructuredJson(text);
    } catch (error: any) {
      aiLog('GEMINI-FLASH', 'generateJson ERROR', error.message);
      return null;
    }
  }

  async generateText(prompt: string): Promise<string> {
    if (await useFreeModels()) {
      try {
        const result = await freeChat({ model: FREE_SMALL_MODEL, messages: [{ role: 'user', content: prompt }] });
        return result.choices[0]?.message?.content || '';
      } catch (error: any) { throw providerError(error); }
    }
    aiLog('GEMINI-FLASH', `generateText START — model: ${GEMINI_FLASH_MODEL}`);
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      aiLog('GEMINI-FLASH', 'generateText SUCCESS', { textLength: text.length });
      return text;
    } catch (error: any) {
      aiLog('GEMINI-FLASH', 'generateText ERROR', error.message);
      throw new Error(`Gemini Text Generation Failed: ${error.message}`);
    }
  }

  async generateImage(imagePrompt: string): Promise<{ base64: string; mimeType: string } | null> {
    if (await useFreeModels()) {
      try {
        await reserveFreeQuota(0);
        const mediaUrls = [
          `${(process.env.FREE_MODELS_MEDIA_BASE_URL || 'https://aihubmix.com/ai/v1').replace(/\/$/, '')}/images/generations`,
          `${(process.env.FREE_MODELS_FALLBACK_MEDIA_BASE_URL || 'https://api.inferera.com/ai/v1').replace(/\/$/, '')}/images/generations`,
        ];
        let response: Response | null = null;
        let data: any = {};
        const apiKeys = Array.from(new Set([
          process.env.FREE_MODELS_API,
          ...Array.from({ length: 20 }, (_, index) => process.env[`FREE_MODELS_API_${index + 1}`]),
        ].filter(Boolean))) as string[];
        for (const apiKey of apiKeys) {
          for (const url of mediaUrls) {
            response = await fetch(url, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: FREE_IMAGE_MODEL, prompt: imagePrompt, n: 1, response_format: 'b64_json' }),
            });
            data = await response.json().catch(() => ({}));
            if (response.ok) break;
          }
          if (response?.ok) break;
        }
        if (!response?.ok) throw Object.assign(new Error(data?.error?.message || `Provider error ${response?.status || 503}`), { status: response?.status || 503 });
        const base64 = data?.data?.[0]?.b64_json;
        if (!base64) throw new Error('No image data returned by the free image model');
        await getServiceSupabaseClient().from('ai_usage_logs').insert({
          user_id: getAIRequestContext()?.userId || null,
          model: FREE_IMAGE_MODEL,
          operation: 'free_ai_request',
          actual_cost_usd: 0,
          energy_debited: 0,
          metadata: { tokens: 0 },
        });
        return { base64, mimeType: 'image/png' };
      } catch (error: any) { aiLog('AIHUBMIX-IMAGE', 'generateImage ERROR', error.message); return null; }
    }
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    aiLog('GEMINI-IMAGEN', `generateImage START — prompt: ${imagePrompt.substring(0, 80)}...`);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: imagePrompt }],
            parameters: { sampleCount: 1, aspectRatio: '1:1' },
          }),
        }
      );

      if (!response.ok) {
        const errData: any = await response.json();
        throw new Error(errData?.error?.message || `Imagen API Error: ${response.status}`);
      }

      const data: any = await response.json();
      const base64 = data?.predictions?.[0]?.bytesBase64Encoded;
      const mimeType = data?.predictions?.[0]?.mimeType || 'image/png';

      if (!base64) throw new Error('No image data in Imagen response');

      aiLog('GEMINI-IMAGEN', 'generateImage SUCCESS');
      return { base64, mimeType };
    } catch (error: any) {
      aiLog('GEMINI-IMAGEN', 'generateImage ERROR', error.message);
      return null;
    }
  }

  async generateVideo(
    promptText: string,
    imageBase64?: string | null,
    imageMime = 'image/png',
  ): Promise<{ url: string; taskId: string } | null> {
    if (await useFreeModels()) {
      aiLog('AIHUBMIX', 'generateVideo SKIP — video generation is disabled in free AI mode');
      return null;
    }
    const key = process.env.RUNWAY_API_KEY || '';
    if (!key) { aiLog('RUNWAY', 'generateVideo SKIP — RUNWAY_API_KEY not set'); return null; }
    aiLog('RUNWAY', `generateVideo START — prompt: ${promptText.slice(0, 80)}...`);
    try {
      const body: Record<string, unknown> = {
        model: 'gen3a_turbo',
        promptText: promptText.slice(0, 512),
        duration: 5,
        ratio: '1280:768',
      };
      if (imageBase64) {
        body.promptImage = `data:${imageMime};base64,${imageBase64}`;
      }
      const createRes = await fetch('https://api.runwayml.com/v1/image_to_video', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify(body),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error((err as any)?.error || `Runway API error ${createRes.status}`);
      }
      const { id: taskId } = await createRes.json();
      if (!taskId) throw new Error('No task ID from Runway');

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 8000));
        const pollRes = await fetch(`https://api.runwayml.com/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06' },
        });
        if (!pollRes.ok) continue;
        const task = await pollRes.json();
        if (task.status === 'SUCCEEDED' && task.output?.[0]) {
          aiLog('RUNWAY', 'generateVideo SUCCESS');
          return { url: task.output[0] as string, taskId };
        }
        if (task.status === 'FAILED') throw new Error('Runway video generation failed');
      }
      aiLog('RUNWAY', 'generateVideo TIMEOUT — task not completed in 120s');
      return null;
    } catch (e: any) {
      aiLog('RUNWAY', 'generateVideo ERROR', e.message);
      return null;
    }
  }
}
