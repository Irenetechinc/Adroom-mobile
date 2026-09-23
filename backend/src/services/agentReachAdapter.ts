import { agentReachWebRouter } from './agentReachWebRouter';

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
    // Social discovery must not depend on opencli being installed or on a
    // user's local browser credentials. Use the already-working web router as
    // a public-signal source and preserve the requested channel as metadata.
    const domains: Record<string, string> = {
      facebook: 'site:facebook.com',
      instagram: 'site:instagram.com',
      reddit: 'site:reddit.com',
      linkedin: 'site:linkedin.com',
      google_maps: 'site:google.com/maps',
      twitter: 'site:x.com OR site:twitter.com',
      x: 'site:x.com OR site:twitter.com',
      youtube: 'site:youtube.com',
    };
    const routedQuery = domains[normalized] ? `${query} ${domains[normalized]}` : query;
    try {
      const results = await agentReachWebRouter.search(routedQuery, 8);
      console.log(`[AgentReachAdapter] ${normalized} web-routed search completed: ${results.length} result(s)`);
      return results.map((item, index) => this.mapItem(normalized, {
        id: item.url || `${normalized}:${index}`,
        title: item.title,
        snippet: item.snippet,
        url: item.url,
        source: item.source,
        captured_at: item.capturedAt,
      }, index, query));
    } catch (error: any) {
      console.error(`[AgentReachAdapter] ${normalized} web-routed search failed: ${error.message}`);
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
