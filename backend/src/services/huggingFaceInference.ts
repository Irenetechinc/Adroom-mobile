import {
  aiProviderIsAvailable,
  recordAIProviderFailure,
  recordAIProviderSuccess,
} from './aiProviderHealth';

export const HUGGING_FACE_IMAGE_MODEL = 'black-forest-labs/FLUX.1-dev';
export const HUGGING_FACE_VIDEO_MODEL = 'larryvrh/MiniMax-H3-Turbo-Lora';

const HUGGING_FACE_HUB = 'https://huggingface.co';
const HUGGING_FACE_ROUTER = 'https://router.huggingface.co/wavespeed';
const WAVESPEED_PROVIDER = 'wavespeed';
const REQUEST_TIMEOUT_MS = 90_000;
const IMAGE_JOB_TIMEOUT_MS = 5 * 60_000;
const VIDEO_JOB_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 2_000;

interface HfProviderMapping {
  providerId: string;
  task: string;
  status: string;
  adapter?: string;
}

interface WavespeedJob {
  id?: string;
  urls?: { get?: string };
  status?: string;
  error?: string;
  outputs?: string[];
}

const mappingCache = new Map<string, { mapping: HfProviderMapping; expiresAt: number }>();

export class HuggingFaceInferenceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 0) {
    super(message);
    this.name = 'HuggingFaceInferenceError';
    this.statusCode = statusCode;
  }
}

export function isHuggingFaceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.HF_TOKEN || env.HUGGINGFACE_API_TOKEN || '').trim());
}

function token(): string {
  return String(process.env.HF_TOKEN || process.env.HUGGINGFACE_API_TOKEN || '').trim();
}

function safeProviderId(value: unknown): string {
  const id = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i.test(id)) {
    throw new HuggingFaceInferenceError('Hugging Face returned an invalid inference provider route.');
  }
  return id.split('/').map(encodeURIComponent).join('/');
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    return String(body?.error?.message || body?.error || body?.message || body?.detail || text || `HTTP ${response.status}`);
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

async function getProviderMapping(model: string, task: 'text-to-image' | 'text-to-video'): Promise<HfProviderMapping> {
  const key = `${model}:${task}`;
  const cached = mappingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.mapping;

  const accessToken = token();
  if (!accessToken) throw new HuggingFaceInferenceError('Hugging Face inference is not configured: set HF_TOKEN in Railway.');

  const modelPath = model.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${HUGGING_FACE_HUB}/api/models/${modelPath}?expand%5B%5D=inferenceProviderMapping`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new HuggingFaceInferenceError(
      `Hugging Face model mapping request failed: ${await readError(response)}`,
      response.status,
    );
  }

  const body: any = await response.json().catch(() => null);
  const entry = body?.inferenceProviderMapping?.[WAVESPEED_PROVIDER] as HfProviderMapping | undefined;
  if (!entry || entry.status !== 'live' || entry.task !== task) {
    throw new HuggingFaceInferenceError(
      `Hugging Face model ${model} has no live ${task} route through ${WAVESPEED_PROVIDER}.`,
      404,
    );
  }
  safeProviderId(entry.providerId);
  mappingCache.set(key, { mapping: entry, expiresAt: Date.now() + 60 * 60_000 });
  return entry;
}

async function submitJob(
  model: string,
  task: 'text-to-image' | 'text-to-video',
  prompt: string,
): Promise<WavespeedJob> {
  const accessToken = token();
  const mapping = await getProviderMapping(model, task);
  const providerId = safeProviderId(mapping.providerId);
  const payload: Record<string, unknown> = { prompt };
  if (mapping.adapter === 'lora') {
    payload.loras = [{ path: model, scale: 1 }];
  }

  const response = await fetch(`${HUGGING_FACE_ROUTER}/api/v3/${providerId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new HuggingFaceInferenceError(`Hugging Face ${task} request failed: ${await readError(response)}`, response.status);
  }

  const body: any = await response.json().catch(() => null);
  const job = body?.data as WavespeedJob | undefined;
  if (Number(body?.code || 0) >= 400 || !job?.urls?.get) {
    throw new HuggingFaceInferenceError(
      String(body?.message || body?.error || 'Hugging Face returned an invalid generation job.'),
      Number(body?.code || response.status || 502),
    );
  }
  return job;
}

function getRoutedPollUrl(providerUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(providerUrl);
  } catch {
    throw new HuggingFaceInferenceError('Hugging Face returned an invalid generation status URL.', 502);
  }
  if (!['api.wavespeed.ai', 'router.huggingface.co'].includes(parsed.hostname) ||
      !parsed.pathname.startsWith('/api/v3/')) {
    throw new HuggingFaceInferenceError('Hugging Face returned an unsupported generation status URL.', 502);
  }
  return `${HUGGING_FACE_ROUTER}${parsed.pathname}${parsed.search}`;
}

async function pollJob(
  job: WavespeedJob,
  task: 'text-to-image' | 'text-to-video',
): Promise<WavespeedJob> {
  const accessToken = token();
  const resultUrl = getRoutedPollUrl(String(job.urls?.get || ''));
  const deadline = Date.now() + (task === 'text-to-video' ? VIDEO_JOB_TIMEOUT_MS : IMAGE_JOB_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const response = await fetch(resultUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new HuggingFaceInferenceError(
        `Hugging Face ${task} status request failed: ${await readError(response)}`,
        response.status,
      );
    }
    const body: any = await response.json().catch(() => null);
    const result = body?.data as WavespeedJob | undefined;
    if (Number(body?.code || 0) >= 400) {
      throw new HuggingFaceInferenceError(
        String(body?.message || body?.error || 'Hugging Face generation failed.'),
        Number(body?.code || response.status || 502),
      );
    }
    if (result?.status === 'completed') {
      if (!result.outputs?.[0]) throw new HuggingFaceInferenceError('Hugging Face completed without a media output.', 502);
      return result;
    }
    if (result?.status === 'failed') {
      throw new HuggingFaceInferenceError(String(result.error || 'Hugging Face generation failed.'), 502);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new HuggingFaceInferenceError(`Hugging Face ${task} generation exceeded its time limit.`, 504);
}

export async function generateHuggingFaceImage(prompt: string): Promise<{ base64: string; mimeType: string }> {
  if (!isHuggingFaceConfigured()) throw new HuggingFaceInferenceError('Hugging Face inference is not configured.', 0);
  if (!aiProviderIsAvailable('huggingface', 'image')) {
    throw new HuggingFaceInferenceError('Hugging Face image inference is cooling down after a provider error.', 429);
  }

  try {
    const job = await submitJob(HUGGING_FACE_IMAGE_MODEL, 'text-to-image', prompt);
    const result = await pollJob(job, 'text-to-image');
    const imageResponse = await fetch(String(result.outputs?.[0]), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!imageResponse.ok) {
      throw new HuggingFaceInferenceError(`Hugging Face image download failed: HTTP ${imageResponse.status}`, imageResponse.status);
    }
    const mimeType = imageResponse.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!mimeType.startsWith('image/')) {
      throw new HuggingFaceInferenceError('Hugging Face returned an invalid image content type.', 502);
    }
    const base64 = Buffer.from(await imageResponse.arrayBuffer()).toString('base64');
    if (!base64) throw new HuggingFaceInferenceError('Hugging Face returned an empty image.', 502);
    recordAIProviderSuccess('huggingface', 'image');
    return { base64, mimeType };
  } catch (error) {
    recordAIProviderFailure('huggingface', 'image', error);
    throw error;
  }
}

export async function generateHuggingFaceVideo(prompt: string): Promise<{ url: string; taskId: string }> {
  if (!isHuggingFaceConfigured()) throw new HuggingFaceInferenceError('Hugging Face inference is not configured: set HF_TOKEN in Railway.');
  if (!aiProviderIsAvailable('huggingface', 'video')) {
    throw new HuggingFaceInferenceError('Hugging Face video inference is cooling down after a provider error.', 429);
  }

  try {
    const job = await submitJob(HUGGING_FACE_VIDEO_MODEL, 'text-to-video', prompt);
    const result = await pollJob(job, 'text-to-video');
    recordAIProviderSuccess('huggingface', 'video');
    return { url: String(result.outputs?.[0]), taskId: String(result.id || job.id || '') };
  } catch (error) {
    recordAIProviderFailure('huggingface', 'video', error);
    throw error;
  }
}
