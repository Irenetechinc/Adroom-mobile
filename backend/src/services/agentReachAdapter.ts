import { execFile } from 'child_process';
import { promisify } from 'util';
import { agentReachWebRouter } from './agentReachWebRouter';

const execFileAsync = promisify(execFile);

export interface ReachResult {
  platform: string;
  externalId: string;
  authorName: string;
  authorId?: string;
  text: string;
  url?: string;
  kind: 'post' | 'comment' | 'mention' | 'message' | 'review' | 'blog';
  capturedAt: string;
  metadata?: Record<string, any>;
}

function parseOutput(output: string): any[] {
  const text = output.trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.results)) return parsed.results;
      if (Array.isArray(parsed.data)) return parsed.data;
      if (Array.isArray(parsed.items)) return parsed.items;
      return [parsed];
    }
  } catch {
    // Fall through to line-based parsing for simple CLI output.
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  return lines.map((line, index) => ({
    id: `${index}-${line.slice(0, 32)}`,
    text: line,
    author_name: 'Unknown person',
    created_at: new Date().toISOString(),
  }));
}

function normalizePlatform(platform: string): string {
  const value = (platform || '').toLowerCase().trim();
  const aliases: Record<string, string> = {
    googlemaps: 'google_maps',
    maps: 'google_maps',
    google_map: 'google_maps',
    google_map_reviews: 'google_maps',
    gmaps: 'google_maps',
    web: 'web',
    general: 'web',
    blog: 'web',
    blogs: 'web',
    social: 'web',
  };
  return aliases[value] || value;
}

/** Adapter that follows the Agent-Reach routing model: channel-first, browser-session, with graceful fallback. */
export class AgentReachAdapter {
  private readonly command = process.env.AGENT_REACH_SEARCH_COMMAND || process.env.OPENCLI_COMMAND || 'opencli';
  private readonly timeoutMs = Number(process.env.AGENT_REACH_TIMEOUT_MS || 20000);

  private buildArgs(platform: string, query: string): string[] {
    const normalized = normalizePlatform(platform);
    const quote = (value: string) => value.includes(' ') ? `"${value}"` : value;
    const baseQuery = quote(query);

    const commandMap: Record<string, string[]> = {
      facebook: ['facebook', 'search', baseQuery, '-f', 'json'],
      instagram: ['instagram', 'search', baseQuery, '-f', 'json'],
      reddit: ['reddit', 'search', baseQuery, '-f', 'json'],
      linkedin: ['linkedin', 'search', baseQuery, '-f', 'json'],
      google_maps: ['google', 'maps', 'search', baseQuery, '-f', 'json'],
      web: ['web', 'search', baseQuery, '-f', 'json'],
      blog: ['web', 'search', baseQuery, '-f', 'json'],
      youtube: ['youtube', 'search', baseQuery, '-f', 'json'],
      x: ['twitter', 'search', baseQuery, '-f', 'json'],
      twitter: ['twitter', 'search', baseQuery, '-f', 'json'],
    };

    const fallback = [normalized, 'search', baseQuery, '-f', 'json'];
    return commandMap[normalized] || fallback;
  }

  private mapItem(platform: string, item: any, index: number, query: string): ReachResult {
    const kind = (item.kind || item.type || item.category || '').toString().toLowerCase();
    const text = String(item.text || item.content || item.title || item.snippet || item.body || item.message || '');

    return {
      platform,
      externalId: String(item.id || item.post_id || item.review_id || item.url || `${platform}:${query}:${index}`),
      authorName: String(item.author_name || item.author || item.username || item.user?.name || item.person || 'Unknown person'),
      authorId: item.author_id || item.user?.id || item.user_id || undefined,
      text,
      url: item.url || item.link || item.permalink || item.href || undefined,
      kind: kind.includes('comment') ? 'comment' : kind.includes('review') ? 'review' : kind.includes('message') ? 'message' : kind.includes('blog') ? 'blog' : 'post',
      capturedAt: item.captured_at || item.created_at || item.reviewed_at || new Date().toISOString(),
      metadata: { adapter: 'agent-reach', raw: item },
    };
  }

  async search(platform: string, query: string): Promise<ReachResult[]> {
    const normalized = normalizePlatform(platform);
    if (normalized === 'web') {
      const webResults = await agentReachWebRouter.search(query, 8);
      console.log(`[AgentReachAdapter] web search completed: ${webResults.length} result(s)`);
      return webResults.map((item, index) => this.mapItem('web', {
        id: item.url || `web:${index}`,
        title: item.title,
        snippet: item.snippet,
        url: item.url,
        source: item.source,
        captured_at: item.capturedAt,
      }, index, query));
    }
    const args = this.buildArgs(normalized, query);

    try {
      const result = await execFileAsync(this.command, args, {
        cwd: process.env.AGENT_REACH_HOME || undefined,
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });

      const stdout = String(result.stdout || '');
      const output = parseOutput(stdout);
      console.log(`[AgentReachAdapter] ${normalized} search completed: ${output.length} raw result(s)`);

      return output
        .filter((item) => item && (item.text || item.content || item.title || item.snippet || item.body || item.url))
        .map((item: any, index) => this.mapItem(normalized, item, index, query));
    } catch (error: any) {
      console.error(`[AgentReachAdapter] ${normalized} search failed: ${error.message}`);
      return [];
    }
  }

  async searchAcrossSources(query: string, extraSources: string[] = []): Promise<ReachResult[]> {
    const defaultSources = ['web', 'facebook', 'instagram', 'reddit', 'linkedin', 'google_maps'];
    const sources = Array.from(new Set([...defaultSources, ...extraSources.map(normalizePlatform)])).filter(Boolean);

    const results = await Promise.all(
      sources.map((source) => this.search(source, query).catch(() => [])),
    );

    return results.flat().filter((item) => item.text && item.text.trim().length > 12);
  }
}

export const agentReachAdapter = new AgentReachAdapter();
