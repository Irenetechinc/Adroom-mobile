import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type PublicProfileTool =
  | 'maigret_public_username'
  | 'deepkrak3n_public_search'
  | 'helix_public_username'
  | 'osintgraph_public_instagram'
  | 'jarvis_public_research'
  | 'reddeye_public_reddit'
  | 'platform_profile_search'
  | 'web_public_profile';

export interface PublicToolHit {
  platform: string;
  externalId: string;
  authorName: string;
  authorId?: string;
  text: string;
  url?: string;
  kind: 'post' | 'comment' | 'mention' | 'message' | 'review' | 'blog';
  capturedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PublicToolSearch {
  attempted: boolean;
  available: boolean;
  hits: PublicToolHit[];
  warning?: string;
}

const TOOLS_ROOT = path.resolve(__dirname, '../../tools/vendor');
const COMMAND_TIMEOUT_MS = Math.max(5_000, Number(process.env.PROFILE_BUILDER_TOOL_TIMEOUT_MS || 45_000));
const MAX_OUTPUT_BYTES = 1_500_000;
const SENSITIVE_VALUE = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{7,}\d)/i;
const PRIVATE_QUERY = /(?:^|\s)(?:email|e-mail|phone|telephone|mobile|password|token|secret|api[- ]?key)(?:\s|$)/i;

function clean(value: unknown, max = 900): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isSafeUsername(value: string): boolean {
  const username = value.trim();
  return Boolean(username)
    && username.length <= 120
    && !PRIVATE_QUERY.test(username)
    && !SENSITIVE_VALUE.test(username)
    && !/^(?:discovery:|user:|phone:|tel:)/i.test(username)
    && !/[/?#&=]/.test(username);
}

function safeUrl(value: unknown): string | undefined {
  const candidate = clean(value, 700);
  if (!/^https?:\/\//i.test(candidate)) return undefined;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function safeText(value: unknown): string {
  const text = clean(value, 1_200);
  return text && !SENSITIVE_VALUE.test(text) ? text : '';
}

function extractRecordUrl(value: any): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const direct = safeUrl(value.url_user || value.profile_url || value.url || value.link || value.href || value.permalink);
  if (direct) return direct;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === 'string') {
      const url = safeUrl(candidate);
      if (url) return url;
    }
  }
  return undefined;
}

function parseJsonLines(output: string): any[] {
  const records: any[] = [];
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) records.push(...parsed);
      else records.push(parsed);
    } catch {
      // CLI status lines are expected. Structured lines are retained only.
    }
  }
  if (records.length) return records;
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      for (const key of ['results', 'data', 'items', 'found', 'hits', 'profiles']) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
      return [parsed];
    }
  } catch {
    // no structured output
  }
  return [];
}

function mapRecords(tool: string, platform: string, username: string, records: any[]): PublicToolHit[] {
  const seen = new Set<string>();
  const hits: PublicToolHit[] = [];
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object') continue;
    const url = extractRecordUrl(record);
    if (!url) continue;
    const site = clean(record.site || record.platform || record.name || record.title || platform, 120);
    const status = typeof record.status === 'object'
      ? record.status.status || record.status.label || record.status.http_status
      : record.status;
    const text = safeText(record.text || record.bio || record.description || `${site} public profile match for ${username}`);
    if (!text) continue;
    const key = `${url}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      platform: platform || site || 'web',
      externalId: `${tool}:${url}`,
      authorName: safeText(record.username || record.user || record.author || username).slice(0, 160) || 'Public profile',
      text: clean(`${site}${status ? ` — ${status}` : ''}: ${text}`, 1_200),
      url,
      kind: 'post',
      capturedAt: new Date().toISOString(),
      metadata: { adapter: tool, public_only: true, site },
    });
    if (hits.length >= 30) break;
  }
  return hits;
}

async function runProcess(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`tool timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdout.length);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 20_000) stderr += chunk.toString('utf8').slice(0, 20_000 - stderr.length);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        finish(new Error(`${command} exited with code ${code}: ${clean(stderr, 500)}`));
      } else {
        finish();
      }
    });
  });
}

export class PublicProfileToolAdapters {
  private readonly python = process.env.PROFILE_BUILDER_PYTHON || 'python3';

  async search(tool: PublicProfileTool, platform: string, username: string): Promise<PublicToolSearch> {
    if (!isSafeUsername(username)) {
      return { attempted: false, available: false, hits: [], warning: 'Only a public username is accepted by discovery tools.' };
    }

    switch (tool) {
      case 'maigret_public_username':
        return this.runMaigret(platform, username);
      case 'deepkrak3n_public_search':
        return this.runDeepkrak3n(platform, username);
      case 'helix_public_username':
        return this.runHelix(platform, username);
      case 'osintgraph_public_instagram':
        return this.runOsintgraph(platform, username);
      case 'jarvis_public_research':
        return this.runJarvis(platform, username);
      case 'reddeye_public_reddit':
        return {
          attempted: false,
          available: false,
          hits: [],
          warning: 'Reddeye Profiler is a Firefox extension with no server API; the Reddit public-page adapter is used instead.',
        };
      default:
        return { attempted: false, available: false, hits: [] };
    }
  }

  private async runMaigret(platform: string, username: string): Promise<PublicToolSearch> {
    const cwd = path.join(TOOLS_ROOT, 'maigret');
    try {
      const result = await runProcess(this.python, ['-m', 'maigret', username, '--json', 'ndjson', '--no-progressbar'], cwd);
      return { attempted: true, available: true, hits: mapRecords('maigret_public_username', platform, username, parseJsonLines(result.stdout)) };
    } catch (error: any) {
      return { attempted: true, available: false, hits: [], warning: `Maigret unavailable: ${clean(error?.message, 300)}` };
    }
  }

  private async runHelix(platform: string, username: string): Promise<PublicToolSearch> {
    const cwd = path.join(TOOLS_ROOT, 'helix');
    const runDir = path.join(cwd, '.runtime', randomUUID());
    try {
      await fs.mkdir(runDir, { recursive: true });
      const relativeOutput = path.relative(cwd, runDir);
      const result = await runProcess(this.python, ['helix.py', '-u', username, '--format', 'json', '--output', relativeOutput, '--no-browser'], cwd);
      const files = await fs.readdir(runDir).catch(() => []);
      const jsonFile = files.find((name) => name.endsWith('.json'));
      const output = jsonFile ? await fs.readFile(path.join(runDir, jsonFile), 'utf8') : result.stdout;
      return { attempted: true, available: true, hits: mapRecords('helix_public_username', platform, username, parseJsonLines(output)) };
    } catch (error: any) {
      return { attempted: true, available: false, hits: [], warning: `Helix unavailable: ${clean(error?.message, 300)}` };
    } finally {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async runDeepkrak3n(platform: string, username: string): Promise<PublicToolSearch> {
    const baseUrl = process.env.DEEPKRAK3N_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      return {
        attempted: false,
        available: false,
        hits: [],
        warning: 'Deepkrak3n is vendored, but its separate FastAPI runtime is not configured; public web fallback remains enabled.',
      };
    }
    try {
      const response = await fetch(`${baseUrl}/api/search/username?username=${encodeURIComponent(username)}&limit=30`, {
        signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: any = await response.json();
      const records = Array.isArray(body) ? body : (body.results || body.data || []);
      return { attempted: true, available: true, hits: mapRecords('deepkrak3n_public_search', platform, username, records) };
    } catch (error: any) {
      return { attempted: true, available: false, hits: [], warning: `Deepkrak3n unavailable: ${clean(error?.message, 300)}` };
    }
  }

  private async runOsintgraph(platform: string, username: string): Promise<PublicToolSearch> {
    if (process.env.PROFILE_BUILDER_ENABLE_OSINTGRAPH !== 'true') {
      return { attempted: false, available: false, hits: [], warning: 'Osintgraph is disabled unless explicitly configured for public Instagram data.' };
    }
    try {
      const result = await runProcess('osintgraph', ['discover', username, '--limit', 'follower=0', 'followee=0', 'post=1'], path.join(TOOLS_ROOT, 'osintgraph'));
      return { attempted: true, available: true, hits: mapRecords('osintgraph_public_instagram', platform || 'instagram', username, parseJsonLines(result.stdout)) };
    } catch (error: any) {
      return { attempted: true, available: false, hits: [], warning: `Osintgraph unavailable: ${clean(error?.message, 300)}` };
    }
  }

  private async runJarvis(platform: string, username: string): Promise<PublicToolSearch> {
    const baseUrl = process.env.JARVIS_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      return { attempted: false, available: false, hits: [], warning: 'J.A.R.V.I.S is vendored but its optional public-research API is not configured.' };
    }
    try {
      const sourceAliases: Record<string, string> = {
        web: 'google',
        twitter: 'twitter',
        instagram: 'instagram',
        linkedin: 'linkedin',
        reddit: 'google',
      };
      const response = await fetch(`${baseUrl}/api/agents/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          person_id: `profile-builder-${username}`,
          person_name: username,
          sources: [sourceAliases[platform] || 'google'],
        }),
        signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: any = await response.json();
      const agents = Array.isArray(body?.agents) ? body.agents : [];
      const records: any[] = [];
      for (const agent of agents.slice(0, 3)) {
        if (!agent?.session_id) continue;
        const statusResponse = await fetch(
          `${baseUrl}/api/agents/sessions/${encodeURIComponent(agent.session_id)}`,
          { signal: AbortSignal.timeout(Math.min(COMMAND_TIMEOUT_MS, 10_000)), headers: { Accept: 'application/json' } },
        ).catch(() => null);
        if (!statusResponse?.ok) continue;
        const status: any = await statusResponse.json().catch(() => null);
        const task = status?.task;
        if (task?.output || Array.isArray(task?.steps)) {
          for (const step of (task.steps || []).slice(0, 10)) {
            records.push({
              url: step.url,
              text: task.output || step.next_goal || 'Public research result',
              platform,
            });
          }
        }
      }
      return { attempted: true, available: true, hits: mapRecords('jarvis_public_research', platform, username, records) };
    } catch (error: any) {
      return { attempted: true, available: false, hits: [], warning: `J.A.R.V.I.S unavailable: ${clean(error?.message, 300)}` };
    }
  }
}

export const publicProfileToolAdapters = new PublicProfileToolAdapters();