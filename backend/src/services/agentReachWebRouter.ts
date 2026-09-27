export interface SearchCandidate {
  title: string;
  url: string;
  snippet: string;
  source: string;
  trustScore: number;
  capturedAt: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function visibleText(value: string): string {
  return normalizeText(decodeHtml(value.replace(/<[^>]+>/g, ' ')));
}

function unwrapSearchUrl(value: string, provider: string): string | undefined {
  const candidate = decodeHtml(value);
  try {
    const parsed = new URL(candidate, `https://${provider}.com`);
    if (provider === 'google' && parsed.pathname === '/url') {
      return parsed.searchParams.get('q') || parsed.searchParams.get('url') || undefined;
    }
    if (provider === 'bing' && parsed.searchParams.get('u')) {
      const encoded = parsed.searchParams.get('u') || '';
      if (encoded.startsWith('a1')) {
        return Buffer.from(encoded.slice(2), 'base64').toString('utf8');
      }
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isProviderNavigation(url: string, provider: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (provider === 'google') {
      return host === 'google.com' || host.endsWith('.google.com')
        || host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
    }
    if (provider === 'bing') return host === 'bing.com' || host.endsWith('.bing.com');
    if (provider === 'duckduckgo') return host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com');
    return false;
  } catch {
    return true;
  }
}

function addCandidate(
  results: SearchCandidate[],
  seen: Set<string>,
  provider: string,
  rawUrl: string,
  rawTitle: string,
  rawSnippet?: string,
): void {
  const url = unwrapSearchUrl(rawUrl, provider);
  const title = visibleText(rawTitle);
  const snippet = visibleText(rawSnippet || rawTitle);
  if (!url || !title || title.length < 13 || isProviderNavigation(url, provider)) return;
  if (seen.has(url)) return;
  seen.add(url);
  results.push({
    title: title.slice(0, 300),
    url,
    snippet: (snippet || title).slice(0, 600),
    source: provider,
    trustScore: 0.7,
    capturedAt: new Date().toISOString(),
  });
}

function extractSearchResults(text: string, provider: string, limit: number): SearchCandidate[] {
  const results: SearchCandidate[] = [];
  const seen = new Set<string>();

  if (provider === 'bing') {
    const blocks = text.match(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][\s\S]*?<\/li>/gi) || [];
    for (const block of blocks) {
      const link = block.match(/<h2\b[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;
      const snippet = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
      addCandidate(results, seen, provider, link[1], link[2], snippet);
      if (results.length >= limit) return results;
    }
  } else if (provider === 'google') {
    const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<\/a>/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCandidate(results, seen, provider, match[1], match[2]);
      if (results.length >= limit) return results;
    }
  } else if (provider === 'duckduckgo') {
    const pattern = /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCandidate(results, seen, provider, match[1], match[2]);
      if (results.length >= limit) return results;
    }
  }

  // Conservative fallback for minor provider markup changes. Navigation links
  // and short labels are rejected so a "feedback" link cannot count as a lead.
  const pattern = /href=["']([^"']+)["'][^>]*>\s*([^<]{13,})<\/a>/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    addCandidate(results, seen, provider, match[1], match[2]);
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

export class AgentReachWebRouter {
  async search(query: string, limit = 5): Promise<SearchCandidate[]> {
    if (!query || !query.trim()) return [];

    const candidates = [
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`,
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`,
    ];

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) continue;

        const content = await response.text();
        const provider = new URL(url).hostname.split('.')[1] || 'search';
        const extracted = extractSearchResults(content, provider, limit)
          .map((item) => ({
            ...item,
            trustScore: 0.68,
            source: item.source || provider,
            snippet: normalizeText(item.snippet || item.title || 'Search result'),
          }))
          .filter((item) => item.url && item.title)
          .slice(0, limit);

        if (extracted.length) {
          console.log(`[AgentReachWebRouter] live provider=${provider} results=${extracted.length}`);
          return extracted;
        }
      } catch {
        // try next backend
      }
    }

    return [];
  }

  async fetchText(url: string): Promise<string> {
    const variants = [
      `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`,
      `https://r.jina.ai/${encodeURIComponent(url)}`,
      url,
    ];

    for (const candidate of variants) {
      try {
        const response = await fetch(candidate, {
          headers: {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Accept': 'text/plain, text/html, */*',
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) continue;
        const text = await response.text();
        const normalized = normalizeText(text.replace(/<[^>]+>/g, ' '));
        if (normalized.length > 200) return normalized;
      } catch {
        // continue to the next backend
      }
    }

    throw new Error(`Unable to fetch page content for ${url}`);
  }
}

export const agentReachWebRouter = new AgentReachWebRouter();
