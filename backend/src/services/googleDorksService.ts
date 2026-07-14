/**
 * Google Dorks Lead Finder — SalesmanAgent sub-tool
 *
 * AI-DRIVEN QUERY GENERATION: Every search session generates fresh, product-specific
 * queries using GPT-4o based on the exact product context. Zero hardcoded templates.
 *
 * Configuration:
 *   GOOGLE_CUSTOM_SEARCH_API_KEY — Google API key with Custom Search enabled
 *   GOOGLE_SEARCH_ENGINE_ID      — Programmable Search Engine CX ID
 *
 * Safety: safe=active is always passed to the CSE API.
 * Dedup:  links are checked against the discovered_leads table before insert.
 * Scoring: each result snippet is scored 0–100 by the AI against the
 *          user's product context. Results below 35 are discarded.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { dynamicProblemSolver } from './dynamicProblemSolver';

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const API_KEY    = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || '';
const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

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

  // ── AI: dynamically generate search queries for this specific product ──────
  private async generateAIDorks(product: any, recentlyUsedQueries: string[]): Promise<string[]> {
    const productName      = product.name        || 'unknown product';
    const description      = (product.description || '').slice(0, 300);
    const category         = product.category    || '';
    const targetAudience   = product.target_audience || '';
    const painPoints       = product.pain_points  || '';
    const price            = product.price ? `${product.currency || 'USD'} ${product.price}` : '';
    const recentList       = recentlyUsedQueries.length
      ? recentlyUsedQueries.slice(0, 12).map((q, i) => `${i + 1}. ${q}`).join('\n')
      : 'None yet.';

    const today = new Date().toISOString().split('T')[0];

    const prompt = `You are an expert B2B/B2C lead generation analyst specialising in Google search operator ("dork") queries that surface people or businesses actively looking to buy or hire for a specific product.

TODAY'S DATE: ${today}

TARGET PRODUCT:
  Name: ${productName}
  Description: ${description}
  Category: ${category}
  Target Audience: ${targetAudience || 'General consumers and small businesses'}
  Pain Points Solved: ${painPoints || 'Efficiency, cost savings, growth'}
  Price Point: ${price || 'Not specified'}

RECENTLY USED QUERIES (do NOT repeat these):
${recentList}

TASK:
Generate exactly 5 highly targeted Google search queries that will surface people or businesses ACTIVELY expressing a need, problem, or purchase intent that "${productName}" can solve.

Rules:
- Each query must be unique and NOT a variation of a recently used query
- Use Google operators (site:, intitle:, inurl:, filetype:, "exact phrases", OR, -exclude) where they help
- Queries must reflect REAL commercial intent language people actually type — not marketing language
- Vary the platforms: mix forum sites (reddit.com, quora.com), professional networks (linkedin.com), community sites, and open web
- Think about what a BUYER says when they're frustrated with their current solution, researching alternatives, or ready to spend money
- Queries should be specific to "${productName}"'s exact value proposition — not generic for the category
- Consider the target audience's vocabulary and the platforms they use to ask for help

Return ONLY a JSON object with this structure:
{
  "queries": [
    "query string 1",
    "query string 2",
    "query string 3",
    "query string 4",
    "query string 5"
  ],
  "rationale": "1-sentence explanation of the targeting angle used"
}`;

    try {
      const result = await this.ai.generateStrategyEconomy({}, prompt);
      const parsed = result.parsedJson;
      if (parsed?.queries && Array.isArray(parsed.queries) && parsed.queries.length >= 3) {
        const valid = parsed.queries
          .map((q: any) => (typeof q === 'string' ? q.trim() : ''))
          .filter((q: string) => q.length > 10 && q.length < 250);
        console.log(`[GoogleDorks] AI rationale: ${parsed.rationale || 'N/A'}`);
        console.log(`[GoogleDorks] Generated ${valid.length} queries for "${productName}"`);
        return valid.slice(0, 5);
      }
      // Fallback: parse queries from text if JSON parsing failed
      const text = result.text || '';
      const lines = text.split('\n').filter((l: string) => l.trim().startsWith('"') || /^\d+\./.test(l.trim()));
      return lines
        .map((l: string) => l.replace(/^\d+\.\s*/, '').replace(/^"|"$/g, '').trim())
        .filter((q: string) => q.length > 10)
        .slice(0, 5);
    } catch (err: any) {
      console.error('[GoogleDorks] AI dork generation failed:', err.message);
      return [];
    }
  }

  // ── Fetch recently-used queries from DB (last 7 days) ─────────────────────
  private async getRecentQueries(userId: string, limit = 20): Promise<string[]> {
    try {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data } = await this.supabase
        .from('discovered_leads')
        .select('dork_used')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!data?.length) return [];
      const unique = [...new Set(data.map((r: any) => r.dork_used).filter(Boolean))] as string[];
      return unique;
    } catch {
      return [];
    }
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

  // ── AI-score each result against the product ───────────────────────────────
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

  // ── Main entry: run AI-driven dork search for a product ───────────────────
  async runForProduct(userId: string, product: any): Promise<number> {
    const productName = product.name || 'product';
    console.log(`[GoogleDorks] Running AI-driven discovery for user=${userId} product="${productName}"`);

    // Step 1: Get recent queries to avoid repetition
    const recentQueries = await this.getRecentQueries(userId);

    // Step 2: AI generates fresh, product-specific search queries
    const queries = await this.generateAIDorks(product, recentQueries);

    if (!queries.length) {
      console.warn(`[GoogleDorks] AI returned no queries for "${productName}" — skipping`);
      return 0;
    }

    let totalInserted = 0;

    for (const query of queries) {
      console.log(`[GoogleDorks] Executing query: ${query}`);
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
        dork_used:       query,
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
    console.log('[GoogleDorks] Starting AI-driven discovery cycle...');

    const { data: products } = await this.supabase
      .from('product_memory')
      .select('id, name, description, category, target_audience, pain_points, price, currency, user_id')
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
