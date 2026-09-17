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

function extractSearchResults(text: string): SearchCandidate[] {
  const results: SearchCandidate[] = [];
  const seen = new Set<string>();
  const pattern = /href=\"([^\"]+)\"[^>]*>\s*([^<]+)<\/a>/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const url = match[1];
    const title = normalizeText(match[2] || '');
    if (!url || !title || url.startsWith('javascript:')) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      title,
      url,
      snippet: title,
      source: 'search_result',
      trustScore: 0.7,
      capturedAt: new Date().toISOString(),
    });
  }

  return results.slice(0, 8);
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
        const extracted = extractSearchResults(content)
          .map((item) => ({
            ...item,
            trustScore: 0.68,
            source: 'search',
            snippet: normalizeText(item.snippet || item.title || 'Search result'),
          }))
          .filter((item) => item.url && item.title)
          .slice(0, limit);

        if (extracted.length) return extracted;
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
