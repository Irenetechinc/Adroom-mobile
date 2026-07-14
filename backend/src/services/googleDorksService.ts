/**
 * Google Dorks Lead Finder — SalesmanAgent sub-tool
 *
 * Uses the Google Custom Search JSON API to find commercial intent pages
 * with rotating dork queries. Falls back to direct HTML scraping when the
 * CSE quota is exhausted.
 *
 * Configuration:
 *   GOOGLE_CUSTOM_SEARCH_API_KEY — Google API key with Custom Search enabled
 *   GOOGLE_SEARCH_ENGINE_ID      — Programmable Search Engine CX ID
 *
 * Dork rotation: queries rotate daily (dayOfYear mod library length) so the
 * same query isn't repeated two days in a row.
 *
 * Safety: safe=active is always passed to the CSE API.
 * Dedup:  links are checked against the discovered_leads table before insert.
 * Scoring: each result snippet is scored 0–100 by the AI against the
 *          user's product context. Results below 30 are discarded.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { dynamicProblemSolver } from './dynamicProblemSolver';

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const API_KEY    = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || '';
const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

// ─── Commercial-intent dork library ──────────────────────────────────────────
// Placeholders {product} and {category} are replaced at runtime from product memory.
const DORK_LIBRARY = [
  '"looking for vendor" OR "need supplier" site:linkedin.com',
  '"looking for a {category}" OR "recommend a {category}" site:reddit.com',
  '"how do I find a good {product}" OR "where to buy {product}"',
  '"recommendations for {category}" site:quora.com',
  '"small business owner" "looking for" "{category}"',
  'site:linkedin.com intitle:"owner" OR intitle:"founder" "{category}"',
  '"anyone know a good {category} service" site:facebook.com',
  '"need help with {product}" site:reddit.com',
  '"looking to hire" "{category}" site:linkedin.com',
  '"best {category} for small business" OR "affordable {category}"',
  '"I need {product}" OR "want to buy {product}" site:twitter.com',
  '"{product} alternative" OR "switch from" "{product}" site:reddit.com',
  '"unhappy with current {category}" OR "frustrated with {category}"',
  '"accepting quotes" OR "get a quote" "{category}"',
  'intitle:"looking for {category}" filetype:html',
  '"can anyone recommend" "{category}" site:community',
  '"where can I find" "{product}" OR "{category}" inurl:forum',
  '"freelancer" OR "contractor" needed "{category}"',
  '"startup" "need" "{category} solution"',
  '"budget" "looking for" "{category}" site:reddit.com',
  '"pain point" "{category}" OR "{product}"',
  '"cost of {category}" OR "price of {product}" site:reddit.com',
  '"which {category} is best" OR "top {category} tools"',
  '"just launched" business needs "{category}"',
  '"side hustle" needs "{category}" site:reddit.com',
  '"ecommerce" "need" "{category}" OR "{product}"',
  '"agency owner" looking for "{category}"',
  '"digital marketing" "need" "{product}"',
  '"social media" "struggling with" "{category}"',
  '"looking for software" "{category}" site:producthunt.com',
];

// Rotating User-Agent pool for fallback scraping
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];

interface DorkSearchResult {
  url: string;
  title: string;
  snippet: string;
  source: 'google_cse' | 'fallback_scrape';
}

interface ScoredLead {
  url: string;
  title: string;
  snippet: string;
  relevance_score: number;
  dork_used: string;
  source: 'google_cse' | 'fallback_scrape';
}

export class GoogleDorksService {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  // ── Select today's dorks (rotate daily) ────────────────────────────────────
  private getDailyDorks(product: string, category: string, count = 3): Array<{ query: string; raw: string }> {
    const dayOfYear = Math.floor(Date.now() / 86400000);
    const start = dayOfYear % DORK_LIBRARY.length;

    const selected: Array<{ query: string; raw: string }> = [];
    for (let i = 0; i < count; i++) {
      const raw = DORK_LIBRARY[(start + i) % DORK_LIBRARY.length];
      const query = raw
        .replace(/{product}/g, product.toLowerCase())
        .replace(/{category}/g, (category || product).toLowerCase());
      selected.push({ query, raw });
    }
    return selected;
  }

  // ── Call Google Custom Search API ──────────────────────────────────────────
  private async callGoogleCSE(query: string): Promise<DorkSearchResult[]> {
    if (!API_KEY || !SEARCH_ENGINE_ID) {
      throw new Error('GOOGLE_CUSTOM_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID not set');
    }

    const params = new URLSearchParams({
      key:  API_KEY,
      cx:   SEARCH_ENGINE_ID,
      q:    query,
      safe: 'active',
      num:  '10',
    });

    const res = await fetch(`${GOOGLE_CSE_ENDPOINT}?${params.toString()}`, {
      headers: { 'User-Agent': 'AdRoomAI/1.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.status.toString());
      throw new Error(`Google CSE HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const items: any[] = data.items || [];

    return items.map((item: any) => ({
      url:     item.link || '',
      title:   item.title || '',
      snippet: item.snippet || '',
      source:  'google_cse' as const,
    })).filter(r => r.url);
  }

  // ── Fallback: web scrape Google search results ─────────────────────────────
  private async scrapeWithFallback(query: string): Promise<DorkSearchResult[]> {
    console.warn('[GoogleDorks] CSE quota/key failed — falling back to direct scrape');

    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&safe=active&num=10`;

    try {
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: DorkSearchResult[] = [];

      $('div.g').each((_: number, el: any) => {
        const link = $(el).find('a').first().attr('href') || '';
        const title = $(el).find('h3').first().text().trim();
        const snippet = $(el).find('div[data-sncf]').text().trim() ||
                        $(el).find('.VwiC3b').text().trim() ||
                        $(el).find('span').last().text().trim();

        if (link.startsWith('http') && title) {
          results.push({ url: link, title, snippet, source: 'fallback_scrape' });
        }
      });

      return results.slice(0, 8);
    } catch (err: any) {
      console.warn('[GoogleDorks] Fallback scrape also failed:', err.message);
      return [];
    }
  }

  // ── AI-score a single result against the product ───────────────────────────
  private async scoreResults(results: DorkSearchResult[], product: any): Promise<Array<DorkSearchResult & { score: number }>> {
    if (!results.length) return [];

    const prompt = `You are scoring web search results as potential leads for "${product.name}" (${product.description?.slice(0, 100) || product.category}).

RESULTS TO SCORE:
${results.map((r, i) => `${i}. TITLE: "${r.title}"\n   SNIPPET: "${r.snippet.slice(0, 200)}"\n   URL: ${r.url}`).join('\n\n')}

For each result, assign a relevance score from 0 to 100:
- 80-100: Strong commercial intent — person/business actively needs this product/service
- 60-79: Moderate intent — researching, comparing, or has a related problem
- 40-59: Weak intent — tangentially related topic
- 0-39: Not a relevant lead

Return JSON: { "scores": [score0, score1, ...] }`;

    try {
      const res = await this.ai.generateStrategyEconomy({}, prompt);
      const scores: number[] = res.parsedJson?.scores || [];
      return results.map((r, i) => ({ ...r, score: Math.max(0, Math.min(100, scores[i] ?? 30)) }));
    } catch {
      return results.map(r => ({ ...r, score: 40 }));
    }
  }

  // ── Dedup against discovered_leads ────────────────────────────────────────
  private async filterExisting(userId: string, results: DorkSearchResult[]): Promise<DorkSearchResult[]> {
    const urls = results.map(r => r.url);
    if (!urls.length) return [];

    const { data: existing } = await this.supabase
      .from('discovered_leads')
      .select('url')
      .eq('user_id', userId)
      .in('url', urls);

    const existingUrls = new Set((existing || []).map((e: any) => e.url));
    return results.filter(r => !existingUrls.has(r.url));
  }

  // ── Persist scored leads ───────────────────────────────────────────────────
  private async persistLeads(userId: string, leads: ScoredLead[]): Promise<void> {
    if (!leads.length) return;

    const rows = leads.map(l => ({
      user_id:         userId,
      url:             l.url,
      title:           l.title,
      snippet:         l.snippet,
      relevance_score: l.relevance_score,
      source:          l.source,
      dork_used:       l.dork_used,
      platform:        'web',
      platform_user_id: Buffer.from(l.url).toString('base64').slice(0, 24),
      stage:           'identified',
    }));

    const { error } = await this.supabase
      .from('discovered_leads')
      .upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: true });

    if (error) {
      console.error('[GoogleDorks] Failed to persist leads:', error.message);
    } else {
      console.log(`[GoogleDorks] Persisted ${rows.length} new leads to discovered_leads`);
    }
  }

  // ── Main entry: run dork search for a product ─────────────────────────────
  async runForProduct(userId: string, product: any): Promise<number> {
    const productName = product.name || 'product';
    const category   = product.category || productName;
    console.log(`[GoogleDorks] Running for user=${userId} product="${productName}"`);

    const dorks = this.getDailyDorks(productName, category, 3);
    let totalInserted = 0;

    for (const { query, raw } of dorks) {
      let rawResults: DorkSearchResult[] = [];

      // Try Google CSE first, fall back to scrape
      try {
        rawResults = await this.callGoogleCSE(query);
      } catch (err: any) {
        console.warn(`[GoogleDorks] CSE failed for "${query}": ${err.message}`);
        try {
          rawResults = await this.scrapeWithFallback(query);
        } catch (fallbackErr: any) {
          await dynamicProblemSolver.logExternalFactor(
            `GoogleDorks scrape fallback failed for query "${query}": ${fallbackErr.message}`,
            { operation: 'googleDorksService' },
          );
          continue;
        }
      }

      if (!rawResults.length) continue;

      // Dedup against DB
      const newResults = await this.filterExisting(userId, rawResults);
      if (!newResults.length) continue;

      // AI-score
      const scored = await this.scoreResults(newResults, product);

      // Threshold: only keep results scoring >= 35
      const quality = scored.filter(r => r.score >= 35);
      if (!quality.length) continue;

      const leads: ScoredLead[] = quality.map(r => ({
        url:             r.url,
        title:           r.title,
        snippet:         r.snippet,
        relevance_score: r.score,
        dork_used:       raw,
        source:          r.source,
      }));

      await this.persistLeads(userId, leads);
      totalInserted += leads.length;

      // Respect rate limits between queries
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`[GoogleDorks] Done — ${totalInserted} leads discovered for user ${userId}`);
    return totalInserted;
  }

  // ── Run discovery cycle for all active users ──────────────────────────────
  async runDiscoveryCycle(): Promise<void> {
    console.log('[GoogleDorks] Starting discovery cycle...');

    const { data: products } = await this.supabase
      .from('product_memory')
      .select('id, name, description, category, user_id')
      .limit(30);

    if (!products?.length) {
      console.log('[GoogleDorks] No products found — skipping');
      return;
    }

    // Group by user, max 1 product per user per cycle
    const byUser: Record<string, any> = {};
    for (const p of products) {
      if (p.user_id && !byUser[p.user_id]) byUser[p.user_id] = p;
    }

    for (const [userId, product] of Object.entries(byUser)) {
      try {
        await this.runForProduct(userId, product);
      } catch (err: any) {
        await dynamicProblemSolver.solve({
          error: err, operation: 'googleDorksDiscovery',
          agentType: 'LEAD_DISCOVERY', userId,
        });
      }
    }
  }
}

export const googleDorksService = new GoogleDorksService();
