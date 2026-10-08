import { agentReachWebRouter } from './agentReachWebRouter';
import {
  publicProfileToolAdapters,
  type PublicProfileTool,
} from './publicProfileToolAdapters';
import { mapWithConcurrency } from '../utils/asyncConcurrency';

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

export function normalizePublicAuthorName(value: unknown): string {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name || /^(?:unknown(?:\s+person|\s+user)?|anonymous|n\/?a|null|undefined)$/i.test(name)) {
    return '';
  }
  return name.slice(0, 180);
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
    author_name: '',
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

const PUBLIC_BUSINESS_EMAIL_LOCALS = new Set([
  'admin', 'bookings', 'business', 'contact', 'enquiries', 'hello', 'info',
  'inquiry', 'marketing', 'office', 'partnerships', 'sales', 'support', 'team',
]);
const EXCLUDED_EMAIL_SOURCE_HOSTS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com',
  'twitter.com', 'x.com', 'youtube.com', 'quora.com',
];
const PUBLIC_SUFFIX_ONLY_DOMAINS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.ng', 'org.ng', 'net.ng', 'com.br', 'com.mx', 'co.in',
  'com.sg', 'co.za',
]);
const PUBLIC_EMAIL_PATTERN = /\b([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi;

function hostname(value?: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function safeEmailSourceUrl(value?: string): string | undefined {
  if (!hostname(value)) return undefined;
  try {
    const parsed = new URL(value as string);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function sameBusinessDomain(first: string, second: string): boolean {
  return Boolean(first && second && (
    first === second
    || first.endsWith(`.${second}`)
    || second.endsWith(`.${first}`)
  ));
}

export function extractPublicBusinessEmail(
  text: string,
  sourceUrl?: string,
  expectedBusinessUrl?: string,
): { email: string; sourceUrl: string } | undefined {
  const sourceHost = hostname(sourceUrl);
  const expectedHost = expectedBusinessUrl ? hostname(expectedBusinessUrl) : '';
  if (!sourceHost || (expectedBusinessUrl && !expectedHost)) return undefined;
  if (EXCLUDED_EMAIL_SOURCE_HOSTS.some((blocked) => sourceHost === blocked || sourceHost.endsWith(`.${blocked}`))) {
    return undefined;
  }

  const source = new URL(sourceUrl as string);
  source.search = '';
  source.hash = '';
  for (const candidate of String(text || '').match(PUBLIC_EMAIL_PATTERN) || []) {
    const email = candidate.trim().toLowerCase();
    const [local, emailDomain] = email.split('@');
    if (!PUBLIC_BUSINESS_EMAIL_LOCALS.has(local)) continue;
    if (PUBLIC_SUFFIX_ONLY_DOMAINS.has(emailDomain)) continue;
    if (!sameBusinessDomain(sourceHost, emailDomain)) continue;
    if (expectedHost && !sameBusinessDomain(expectedHost, emailDomain)) continue;
    return { email, sourceUrl: source.toString() };
  }
  return undefined;
}

function extractRecipient(platform: string, url?: string, authorId?: string, text?: string): string | undefined {
  if (platform === 'email') {
    return extractPublicBusinessEmail(text || '', url)?.email;
  }
  if (authorId) return String(authorId);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (platform === 'telegram' && parsed.hostname.endsWith('t.me') && path && !path.startsWith('+')) return `@${path.split('/')[0]}`;
    if (platform === 'whatsapp_personal' && parsed.hostname.endsWith('wa.me') && path) return path.split('/')[0];
    if (platform === 'signal_personal' && parsed.hostname.endsWith('signal.me')) {
      const match = url.match(/#p\/([^/?]+)/);
      return match?.[1];
    }
    if (platform === 'bluesky' && parsed.hostname.endsWith('bsky.app') && path.startsWith('profile/')) {
      return path.slice('profile/'.length).split('/')[0];
    }
  } catch {
    // An invalid public URL is not a usable messaging recipient.
  }
  return undefined;
}

/** Adapter that follows the Agent-Reach routing model: channel-first, browser-session, with graceful fallback. */
export class AgentReachAdapter {
  private mapItem(platform: string, item: any, index: number, query: string): ReachResult {
    const kind = (item.kind || item.type || item.category || '').toString().toLowerCase();
    const rawText = String(item.text || item.content || item.title || item.snippet || item.body || item.message || '');

    const rawUrl = item.url || item.link || item.permalink || item.href || undefined;
    const url = platform === 'email' ? safeEmailSourceUrl(rawUrl) : rawUrl;
    const publicEmail = platform === 'email' ? extractPublicBusinessEmail(rawText, url) : undefined;
    const text = platform === 'email'
      ? rawText.replace(PUBLIC_EMAIL_PATTERN, '[public business contact]')
      : rawText;
    const rawAuthorId = item.author_id || item.user?.id || item.user_id || undefined;
    const authorId = platform === 'email' ? undefined : rawAuthorId;
    const recipient = platform === 'email'
      ? publicEmail?.email
      : extractRecipient(platform, url, authorId, rawText);
    const rawAuthorName = normalizePublicAuthorName(
      item.author_name
      || item.author
      || item.username
      || item.user?.display_name
      || item.user?.name
      || item.person,
    );
    const authorName = platform === 'email'
      ? rawAuthorName.replace(PUBLIC_EMAIL_PATTERN, '[public business contact]')
      : rawAuthorName;
    const rawExternalId = item.id || item.post_id || item.review_id || url || `${platform}:${query}:${index}`;
    return {
      platform,
      externalId: platform === 'email'
        ? String(rawExternalId).replace(PUBLIC_EMAIL_PATTERN, '[public business contact]')
        : String(rawExternalId),
      authorName,
      authorId,
      text,
      url,
      kind: kind.includes('comment') ? 'comment' : kind.includes('review') ? 'review' : kind.includes('message') ? 'message' : kind.includes('blog') ? 'blog' : 'post',
      capturedAt: item.captured_at || item.created_at || item.reviewed_at || new Date().toISOString(),
      metadata: {
        adapter: 'agent-reach',
        discovery_mode: 'live_web_search',
        provider: platform === 'email' && item.source
          ? String(item.source).replace(PUBLIC_EMAIL_PATTERN, '[public business contact]')
          : item.source,
        captured_live: true,
        ...(platform !== 'email' ? { raw: item } : {}),
        ...(recipient ? { recipient } : {}),
      },
    };
  }

  async search(platform: string, query: string, tool?: PublicProfileTool): Promise<ReachResult[]> {
    const normalized = normalizePlatform(platform);
    if (tool && !['platform_profile_search', 'web_public_profile'].includes(tool)) {
      const toolResult = await publicProfileToolAdapters.search(tool, normalized, query);
      if (toolResult.warning) console.warn(`[AgentReachAdapter] ${toolResult.warning}`);
      if (toolResult.hits.length) {
        if (normalized === 'email') {
          return toolResult.hits.map((hit, index) => {
            const sanitized = this.mapItem('email', {
              id: hit.externalId,
              author_name: hit.authorName,
              author_id: hit.authorId,
              text: hit.text,
              url: hit.url,
              kind: hit.kind,
              captured_at: hit.capturedAt,
              source: hit.metadata?.provider,
            }, index, query);
            return { ...hit, ...sanitized, platform: 'email' };
          });
        }
        return toolResult.hits.map((hit) => ({
          ...hit,
          platform: normalizePlatform(hit.platform || normalized),
        }));
      }
    }
    if (normalized === 'web') {
      const webResults = await agentReachWebRouter.search(query, 8);
      console.log(`[AgentReachAdapter] live web search completed: ${webResults.length} result(s)`);
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
      telegram: 'site:t.me',
      whatsapp_personal: 'site:wa.me',
      signal_personal: 'site:signal.me',
      bluesky: 'site:bsky.app',
    };
    const routedQuery = domains[normalized] ? `${query} ${domains[normalized]}` : query;
    try {
      const results = await agentReachWebRouter.search(routedQuery, 8);
      console.log(`[AgentReachAdapter] live web-routed search completed platform=${normalized} results=${results.length}`);
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
    // Web is the credential-free discovery fallback. Other social sources are
    // opt-in so a strategy never broadens discovery or creates work for
    // accounts the user did not select.
    const defaultSources = ['web'];
    const sources = Array.from(new Set([...defaultSources, ...extraSources.map(normalizePlatform)])).filter(Boolean);

    const sourceConcurrency = Number.parseInt(process.env.AGENT_REACH_SOURCE_CONCURRENCY || '3', 10);
    const results = await mapWithConcurrency(
      sources,
      Number.isFinite(sourceConcurrency) ? Math.max(1, Math.min(6, sourceConcurrency)) : 3,
      (source) => this.search(source, query).catch(() => []),
    );

    return results.flat().filter((item) => item.text && item.text.trim().length > 12);
  }
}

export const agentReachAdapter = new AgentReachAdapter();
