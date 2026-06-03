/**
 * Lead Discovery Service — Capability 2
 *
 * Multiple autonomous lead discovery agents, each running independently:
 * - Social Listening Agent  (Twitter/Reddit public posts — people asking for recommendations)
 * - Reddit Agent            (REDDIT_CLIENT_ID/SECRET — finds problem-aware posters)
 * - NewsAPI Agent           (NEWSAPI_KEY — companies in the news that might need User's product)
 * - Forum Agent             (Quora/Nairaland via web search — people asking questions)
 * - Competitor Agent        (public competitor mentions — unhappy customers)
 *
 * All agents:
 * - Feed into the same agent_leads table
 * - Deduplicate by (user_id + platform + platform_user_id)
 * - Score leads with a confidence score
 * - Log source in lead_discovery_log
 *
 * NEVER hardcodes search queries. AI Brain generates them from product context.
 */

import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { dynamicProblemSolver } from './dynamicProblemSolver';
import fetch from 'node-fetch';

const REDDIT_CLIENT_ID     = process.env.REDDIT_CLIENT_ID     || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const NEWSAPI_KEY          = process.env.NEWSAPI_KEY           || '';
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN || '';
const SERPAPI_KEY          = process.env.SERPAPI_KEY           || '';

interface RawLead {
  platformUserId: string;
  platformUsername: string;
  platform: string;
  firstInteraction: string;
  sourceUrl?: string;
  discoverySource: string;
  rawContent: string;
  confidence: number;
}

export class LeadDiscoveryService {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;
  private redditToken: string | null = null;
  private redditTokenExpiry = 0;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  /**
   * Main entry point — runs all discovery agents for all active strategies.
   */
  async runDiscoveryCycle(): Promise<void> {
    console.log('[LeadDiscovery] Starting multi-source discovery cycle...');

    const { data: products } = await this.supabase
      .from('product_memory')
      .select('id, name, description, category, user_id')
      .limit(50);

    if (!products?.length) return;

    // Group by user_id so we can run per-user discovery
    const byUser: Record<string, typeof products> = {};
    for (const p of products) {
      if (!p.user_id) continue;
      if (!byUser[p.user_id]) byUser[p.user_id] = [];
      byUser[p.user_id].push(p);
    }

    for (const [userId, userProducts] of Object.entries(byUser)) {
      for (const product of userProducts.slice(0, 2)) { // max 2 products per user per cycle
        await this.discoverForProduct(userId, product);
      }
    }
  }

  private async discoverForProduct(userId: string, product: any): Promise<void> {
    // AI Brain generates base queries, then augments with evolved queries from
    // previous self-evolution cycles — so the system improves with every run.
    const baseQueries = await this.generateSearchQueries(product);

    // Load adopted query variations per source from past evolution cycles
    const [evolvedSocial, evolvedReddit, evolvedForum, evolvedSearch, evolvedReview] = await Promise.all([
      this.loadEvolvedQueries('social_listening'),
      this.loadEvolvedQueries('reddit'),
      this.loadEvolvedQueries('forum'),
      this.loadEvolvedQueries('search_engine'),
      this.loadEvolvedQueries('review_site'),
    ]);

    // Merge base queries with evolved ones — deduplicated, capped at 6 per agent
    const mergeQueries = (base: string[], evolved: string[]) =>
      [...new Set([...base, ...evolved])].slice(0, 6);

    const queries = baseQueries; // base queries go to all agents
    const socialQueries  = mergeQueries(baseQueries, evolvedSocial);
    const redditQueries  = mergeQueries(baseQueries, evolvedReddit);
    const forumQueries   = mergeQueries(baseQueries, evolvedForum);
    const searchQueries  = mergeQueries(baseQueries, evolvedSearch);
    const reviewQueries  = mergeQueries(baseQueries, evolvedReview);

    const allLeads: RawLead[] = [];

    // Run all agents in parallel with their evolved query sets; failures don't stop others
    const results = await Promise.allSettled([
      this.socialListeningAgent(socialQueries, product, userId),
      this.redditAgent(redditQueries, product, userId),
      this.newsApiAgent(queries, product, userId),
      this.forumAgent(forumQueries, product, userId),
      this.competitorAgent(queries, product, userId),
      this.reviewSiteAgent(reviewQueries, product, userId),
      this.searchEngineAgent(searchQueries, product, userId),
    ]);

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.length) {
        allLeads.push(...r.value);
      }
    }

    if (allLeads.length > 0) {
      await this.scoreAndUpsertLeads(userId, product, allLeads);
    }
  }

  /**
   * AI Brain generates search queries from product context — no hardcoded strings.
   */
  private async generateSearchQueries(product: any): Promise<string[]> {
    const prompt = `You are the AdRoom AI Brain. Generate search queries to find potential customers for this product/service.

PRODUCT: ${product.name}
DESCRIPTION: ${product.description || 'Not provided'}
CATEGORY: ${product.category || 'general'}

Generate 5 search queries that would find:
1. People asking for recommendations for this type of product
2. People complaining about a problem this product solves
3. People who are unhappy with a competitor
4. Businesses in the news that might need this product
5. Forum questions related to this product's use case

Return JSON: { "queries": ["query1", "query2", "query3", "query4", "query5"] }`;

    try {
      const res = await this.ai.generateStrategyEconomy({}, prompt);
      return res.parsedJson?.queries || [product.name, product.category || 'business'];
    } catch {
      return [product.name, product.category || 'business solution'];
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 1: Social Listening (Twitter / X)
  // ──────────────────────────────────────────────────────────────────────────
  private async socialListeningAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    if (!TWITTER_BEARER_TOKEN) return [];

    const leads: RawLead[] = [];
    const query = queries.slice(0, 2).join(' OR ');

    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query + ' -is:retweet lang:en')}&max_results=20&tweet.fields=author_id,text,created_at&expansions=author_id&user.fields=username,name`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
      });

      if (!res.ok) {
        await dynamicProblemSolver.logExternalFactor(`Twitter API returned ${res.status}`, { operation: 'socialListeningAgent' });
        return [];
      }

      const data: any = await res.json();
      const users: Record<string, any> = {};
      for (const u of (data.includes?.users || [])) users[u.id] = u;

      for (const tweet of (data.data || [])) {
        const user = users[tweet.author_id];
        if (!user) continue;

        leads.push({
          platformUserId: tweet.author_id,
          platformUsername: user.username,
          platform: 'twitter',
          firstInteraction: tweet.text,
          sourceUrl: `https://twitter.com/${user.username}/status/${tweet.id}`,
          discoverySource: 'social_listening',
          rawContent: tweet.text,
          confidence: 0.6,
        });
      }
    } catch (err) {
      await dynamicProblemSolver.solve({ error: err, operation: 'socialListeningAgent', agentType: 'LEAD_DISCOVERY', userId });
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 2: Reddit
  // ──────────────────────────────────────────────────────────────────────────
  private async getRedditToken(): Promise<string | null> {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
    if (this.redditToken && Date.now() < this.redditTokenExpiry) return this.redditToken;

    try {
      const res = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'AdRoomAI/1.0',
        },
        body: 'grant_type=client_credentials',
      });
      const data: any = await res.json();
      if (data.access_token) {
        this.redditToken = data.access_token;
        this.redditTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        return this.redditToken;
      }
    } catch (e) {
      await dynamicProblemSolver.solve({ error: e, operation: 'reddit_auth', agentType: 'LEAD_DISCOVERY' });
    }
    return null;
  }

  private async redditAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    const token = await this.getRedditToken();
    if (!token) return [];

    const leads: RawLead[] = [];

    for (const q of queries.slice(0, 2)) {
      try {
        const url = `https://oauth.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=15&type=link`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'AdRoomAI/1.0',
          },
        });

        if (!res.ok) continue;
        const data: any = await res.json();

        for (const post of (data.data?.children || [])) {
          const p = post.data;
          if (!p.author || p.author === '[deleted]') continue;

          leads.push({
            platformUserId: `reddit_${p.author}`,
            platformUsername: p.author,
            platform: 'reddit',
            firstInteraction: `${p.title} — ${(p.selftext || '').slice(0, 200)}`,
            sourceUrl: `https://reddit.com${p.permalink}`,
            discoverySource: 'reddit',
            rawContent: p.title + ' ' + (p.selftext || ''),
            confidence: 0.55,
          });
        }
      } catch (err) {
        await dynamicProblemSolver.solve({ error: err, operation: 'redditAgent', agentType: 'LEAD_DISCOVERY', userId });
      }
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 3: NewsAPI — companies in the news that might need User's product
  // ──────────────────────────────────────────────────────────────────────────
  private async newsApiAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    if (!NEWSAPI_KEY) return [];

    const leads: RawLead[] = [];
    const q = queries[0];

    try {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWSAPI_KEY}`;
      const res = await fetch(url);

      if (!res.ok) return [];
      const data: any = await res.json();

      for (const article of (data.articles || [])) {
        if (!article.source?.name || article.source.name === '[Removed]') continue;

        leads.push({
          platformUserId: `news_${Buffer.from(article.url || '').toString('base64').slice(0, 20)}`,
          platformUsername: article.source.name,
          platform: 'news',
          firstInteraction: `${article.title} — ${(article.description || '').slice(0, 300)}`,
          sourceUrl: article.url,
          discoverySource: 'newsapi',
          rawContent: article.title + ' ' + (article.description || ''),
          confidence: 0.45,
        });
      }
    } catch (err) {
      await dynamicProblemSolver.solve({ error: err, operation: 'newsApiAgent', agentType: 'LEAD_DISCOVERY', userId });
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 4: Forum Agent — Quora, Nairaland via SerpAPI or Google Custom Search
  // ──────────────────────────────────────────────────────────────────────────
  private async forumAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    if (!SERPAPI_KEY) return [];

    const leads: RawLead[] = [];
    const sites = 'site:quora.com OR site:nairaland.com OR site:reddit.com OR site:stackoverflow.com';

    for (const q of queries.slice(0, 2)) {
      try {
        const searchQ = encodeURIComponent(`${q} ${sites}`);
        const url = `https://serpapi.com/search.json?q=${searchQ}&api_key=${SERPAPI_KEY}&num=10`;
        const res = await fetch(url);

        if (!res.ok) continue;
        const data: any = await res.json();

        for (const result of (data.organic_results || [])) {
          const domain = new URL(result.link || 'https://unknown.com').hostname;
          const platform = domain.includes('quora') ? 'quora'
            : domain.includes('nairaland') ? 'nairaland'
            : domain.includes('reddit') ? 'reddit'
            : 'forum';

          leads.push({
            platformUserId: `forum_${Buffer.from(result.link || '').toString('base64').slice(0, 20)}`,
            platformUsername: result.displayed_link || domain,
            platform,
            firstInteraction: `${result.title} — ${(result.snippet || '').slice(0, 300)}`,
            sourceUrl: result.link,
            discoverySource: 'forum',
            rawContent: result.title + ' ' + (result.snippet || ''),
            confidence: 0.5,
          });
        }
      } catch (err) {
        await dynamicProblemSolver.solve({ error: err, operation: 'forumAgent', agentType: 'LEAD_DISCOVERY', userId });
      }
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 5: Competitor Agent — public posts mentioning competitors
  // ──────────────────────────────────────────────────────────────────────────
  private async competitorAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    if (!TWITTER_BEARER_TOKEN) return [];

    const leads: RawLead[] = [];

    // AI Brain identifies competitor keywords from product context
    try {
      const competitorPrompt = `Product: "${product.name}" (${product.category}). 
List 2-3 competitor brand names or generic competitor keywords someone would mention when unhappy with the alternative. 
Return JSON: { "competitors": ["name1", "name2"] }`;

      const res = await this.ai.generateStrategyEconomy({}, competitorPrompt);
      const competitors: string[] = res.parsedJson?.competitors || [];
      if (!competitors.length) return [];

      const query = competitors.map(c => `"${c}" (bad OR terrible OR worst OR alternative OR switched OR leaving)`).join(' OR ');
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query + ' -is:retweet lang:en')}&max_results=10&tweet.fields=author_id,text&expansions=author_id&user.fields=username`;

      const twitterRes = await fetch(url, {
        headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
      });

      if (!twitterRes.ok) return [];
      const data: any = await twitterRes.json();
      const users: Record<string, any> = {};
      for (const u of (data.includes?.users || [])) users[u.id] = u;

      for (const tweet of (data.data || [])) {
        const user = users[tweet.author_id];
        if (!user) continue;

        leads.push({
          platformUserId: tweet.author_id,
          platformUsername: user.username,
          platform: 'twitter',
          firstInteraction: tweet.text,
          sourceUrl: `https://twitter.com/${user.username}/status/${tweet.id}`,
          discoverySource: 'competitor',
          rawContent: tweet.text,
          confidence: 0.7, // Higher confidence — actively unhappy with competitor
        });
      }
    } catch (err) {
      await dynamicProblemSolver.solve({ error: err, operation: 'competitorAgent', agentType: 'LEAD_DISCOVERY', userId });
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 6: Review Site Agent — Trustpilot, G2, Capterra, Google Reviews
  // Finds businesses with negative reviews that the User's product could solve.
  // ──────────────────────────────────────────────────────────────────────────
  private async reviewSiteAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    if (!SERPAPI_KEY) return [];

    const leads: RawLead[] = [];
    const reviewSites = 'site:trustpilot.com OR site:g2.com OR site:capterra.com OR site:reviews.google.com';

    for (const q of queries.slice(0, 2)) {
      try {
        // AI Brain decides the best negative-review search — no hardcoded patterns
        const searchQuery = encodeURIComponent(`${q} negative review ${reviewSites}`);
        const url = `https://serpapi.com/search.json?q=${searchQuery}&api_key=${SERPAPI_KEY}&num=10`;
        const res = await fetch(url);
        if (!res.ok) continue;

        const data: any = await res.json();
        for (const result of (data.organic_results || [])) {
          if (!result.link) continue;
          const domain = (() => { try { return new URL(result.link).hostname; } catch { return 'review'; } })();
          const platform = domain.includes('trustpilot') ? 'trustpilot'
            : domain.includes('g2.com') ? 'g2'
            : domain.includes('capterra') ? 'capterra'
            : 'google_reviews';

          // All review results are included — hardcoded keyword arrays are forbidden.
          // The AI Brain scores each lead's relevance during scoreAndUpsertLeads().
          // Low-scoring results are dropped there (score < 0.35 threshold).

          leads.push({
            platformUserId: `review_${Buffer.from(result.link).toString('base64').slice(0, 20)}`,
            platformUsername: result.title?.replace(/\s+\|.*$/, '').trim() || domain,
            platform,
            firstInteraction: `${result.title} — ${(result.snippet || '').slice(0, 300)}`,
            sourceUrl: result.link,
            discoverySource: 'review_site',
            rawContent: result.title + ' ' + (result.snippet || ''),
            confidence: 0.65,
          });
        }
      } catch (err) {
        await dynamicProblemSolver.solve({ error: err, operation: 'reviewSiteAgent', agentType: 'LEAD_DISCOVERY', userId });
      }
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AGENT 7: Search Engine Agent — people actively searching for solutions
  // Finds intent-rich queries like "[problem] solution" or "[industry] help"
  // ──────────────────────────────────────────────────────────────────────────
  private async searchEngineAgent(queries: string[], product: any, userId: string): Promise<RawLead[]> {
    if (!SERPAPI_KEY) return [];

    const leads: RawLead[] = [];

    // AI Brain generates problem-centric search queries — not product-centric
    let problemQueries: string[] = [];
    try {
      const problemPrompt = `Product: "${product.name}" (${product.category}).
Generate 3 Google search queries that someone would type when they have the PROBLEM this product solves.
Format: "[problem] solution" or "[pain point] how to fix" or "[industry] best tool"
Return JSON: { "queries": ["query1", "query2", "query3"] }`;
      const res = await this.ai.generateStrategyEconomy({}, problemPrompt);
      problemQueries = res.parsedJson?.queries || queries.slice(0, 2).map(q => `${q} solution`);
    } catch {
      problemQueries = queries.slice(0, 2).map(q => `${q} solution help`);
    }

    for (const pq of problemQueries.slice(0, 2)) {
      try {
        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(pq)}&api_key=${SERPAPI_KEY}&num=10`;
        const res = await fetch(url);
        if (!res.ok) continue;

        const data: any = await res.json();

        // Extract People Also Ask — high-intent signal
        for (const paa of (data.related_questions || []).slice(0, 3)) {
          if (!paa.question) continue;
          leads.push({
            platformUserId: `search_paa_${Buffer.from(paa.question).toString('base64').slice(0, 20)}`,
            platformUsername: paa.source?.link ? new URL(paa.source.link).hostname : 'search_user',
            platform: 'search',
            firstInteraction: `Actively searching: "${paa.question}" — ${(paa.snippet || '').slice(0, 200)}`,
            sourceUrl: paa.source?.link || '',
            discoverySource: 'search_engine',
            rawContent: paa.question + ' ' + (paa.snippet || ''),
            confidence: 0.7, // People asking questions = high intent
          });
        }

        // Extract organic results from forums / community sites
        for (const result of (data.organic_results || [])) {
          if (!result.link) continue;
          const domain = (() => { try { return new URL(result.link).hostname; } catch { return ''; } })();
          const isCommunity = ['reddit', 'quora', 'stackoverflow', 'community', 'forum', 'answers']
            .some(kw => domain.includes(kw));
          if (!isCommunity) continue;

          leads.push({
            platformUserId: `search_${Buffer.from(result.link).toString('base64').slice(0, 20)}`,
            platformUsername: domain,
            platform: domain.includes('reddit') ? 'reddit' : domain.includes('quora') ? 'quora' : 'forum',
            firstInteraction: `${result.title} — ${(result.snippet || '').slice(0, 300)}`,
            sourceUrl: result.link,
            discoverySource: 'search_engine',
            rawContent: result.title + ' ' + (result.snippet || ''),
            confidence: 0.6,
          });
        }
      } catch (err) {
        await dynamicProblemSolver.solve({ error: err, operation: 'searchEngineAgent', agentType: 'LEAD_DISCOVERY', userId });
      }
    }

    return leads;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AI SCORING + UPSERT — feeds all leads into agent_leads
  // ──────────────────────────────────────────────────────────────────────────
  private async scoreAndUpsertLeads(userId: string, product: any, rawLeads: RawLead[]): Promise<void> {
    // Deduplicate by platform + platformUserId before scoring
    const seen = new Set<string>();
    const unique = rawLeads.filter(l => {
      const key = `${l.platform}::${l.platformUserId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Check which ones already exist in DB for this user
    const { data: existing } = await this.supabase
      .from('agent_leads')
      .select('platform_user_id, platform')
      .eq('user_id', userId);

    const existingKeys = new Set((existing || []).map((e: any) => `${e.platform}::${e.platform_user_id}`));
    const newLeads = unique.filter(l => !existingKeys.has(`${l.platform}::${l.platformUserId}`));

    if (!newLeads.length) return;

    // Batch AI intent scoring — AI Brain scores all leads at once
    const scoringPrompt = `You are the AdRoom AI Brain scoring potential leads for "${product.name}" (${product.category}).

LEADS TO SCORE:
${newLeads.map((l, i) => `${i}. [${l.platform}] @${l.platformUsername}: "${l.firstInteraction.slice(0, 150)}"`).join('\n')}

For each lead, assign an intent score (0.0 to 1.0) based on:
- 1.0: Explicitly asking to buy, requesting pricing, clear purchase intent
- 0.8-0.9: Strong problem awareness, actively seeking solution
- 0.6-0.7: Moderate interest, discussing related topic
- 0.4-0.5: Vague relevance, general topic mention
- 0.0-0.3: Noise, unrelated, or competitor mention without clear need

Return JSON: { "scores": [0.7, 0.4, ...] } — one score per lead in same order`;

    let scores: number[] = newLeads.map(l => l.confidence);
    try {
      const res = await this.ai.generateStrategyEconomy({}, scoringPrompt);
      const parsed = res.parsedJson?.scores;
      if (Array.isArray(parsed) && parsed.length === newLeads.length) {
        scores = parsed;
      }
    } catch { /* use default confidence scores */ }

    // Get active strategy for this user
    const { data: strategy } = await this.supabase
      .from('strategies')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Insert new leads
    for (let i = 0; i < newLeads.length; i++) {
      const lead = newLeads[i];
      const score = Math.max(0, Math.min(1, scores[i] ?? lead.confidence));

      if (score < 0.35) continue; // Skip very low-relevance leads

      try {
        const { data: inserted } = await this.supabase
          .from('agent_leads')
          .insert({
            user_id: userId,
            strategy_id: strategy?.id || null,
            platform: lead.platform,
            platform_user_id: lead.platformUserId,
            platform_username: lead.platformUsername,
            first_interaction: lead.firstInteraction.slice(0, 1000),
            intent_score: score,
            intent_signals: [{ source: lead.discoverySource, text: lead.rawContent.slice(0, 200), score }],
            stage: 'identified',
            dm_sequence_step: 0,
            next_followup_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            discovery_source: lead.discoverySource,
            source_url: lead.sourceUrl || null,
            discovery_raw: lead.rawContent.slice(0, 500),
          })
          .select('id')
          .single();

        if (inserted?.id) {
          // Log source in discovery log
          await this.supabase.from('lead_discovery_log').insert({
            lead_id: inserted.id,
            user_id: userId,
            source: lead.discoverySource,
            source_url: lead.sourceUrl || null,
            raw_content: lead.rawContent.slice(0, 1000),
            confidence: score,
          });
        }
      } catch { /* duplicate or constraint error — skip */ }
    }

    console.log(`[LeadDiscovery] Upserted ${newLeads.length} new leads for user ${userId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SELF-EVOLUTION ENGINE (Capability 0)
  //
  // After each discovery cycle, the AI Brain:
  //   1. Analyses which sources produced the most high-intent leads
  //   2. Identifies under-performing and over-performing sources
  //   3. Generates new search query variations for high-performing sources
  //   4. Experiments with new sub-methods in each domain
  //   5. Permanently adopts effective variations, discards failing ones
  //   6. Logs every decision to self_evolution_log
  //
  // No hardcoded thresholds — the AI Brain decides what "good" means
  // relative to the overall system performance at runtime.
  // ──────────────────────────────────────────────────────────────────────────
  async evolveDiscoverySources(): Promise<void> {
    console.log('[LeadDiscovery] Running self-evolution cycle...');

    try {
      // 1. Gather performance data — count leads per source + average intent score
      const { data: perf } = await this.supabase
        .from('lead_discovery_log')
        .select('source, confidence')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      if (!perf?.length) {
        console.log('[LeadDiscovery] Self-evolution: not enough data yet (need at least 1 week of logs)');
        return;
      }

      // Aggregate per source
      const sourceStats: Record<string, { count: number; totalScore: number }> = {};
      for (const row of perf) {
        if (!sourceStats[row.source]) sourceStats[row.source] = { count: 0, totalScore: 0 };
        sourceStats[row.source].count++;
        sourceStats[row.source].totalScore += row.confidence ?? 0;
      }
      const sourceSummary = Object.entries(sourceStats).map(([source, s]) => ({
        source,
        leadCount: s.count,
        avgScore: s.count > 0 ? (s.totalScore / s.count).toFixed(3) : '0',
      }));

      // 2. Also get recent conversion signals — leads that progressed beyond 'identified'
      const { data: engaged } = await this.supabase
        .from('agent_leads')
        .select('discovery_source, stage, intent_score')
        .neq('stage', 'identified')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      const conversionBySource: Record<string, number> = {};
      for (const l of (engaged || [])) {
        conversionBySource[l.discovery_source || 'unknown'] = (conversionBySource[l.discovery_source || 'unknown'] || 0) + 1;
      }

      // 3. AI Brain analyses performance and decides what to do — no hardcoded rules
      const evolutionPrompt = `You are the AdRoom AI Brain performing a self-evolution analysis of the lead discovery system.

WEEKLY SOURCE PERFORMANCE:
${JSON.stringify(sourceSummary, null, 2)}

LEAD CONVERSIONS (leads that progressed from 'identified' to active engagement):
${JSON.stringify(conversionBySource, null, 2)}

AVAILABLE SOURCES: social_listening (Twitter), reddit, newsapi, forum (Quora/Nairaland), competitor_agent, review_site (Trustpilot/G2/Capterra/Google Reviews), search_engine (Google via SerpAPI)

Your task: Analyze this performance data and produce evolution decisions.

For each analysis, consider:
- Which sources produce the most leads AND have the best conversion rates?
- Which sources are generating noise (many leads, low conversion)?
- Which sources are underutilized but likely high-potential for this type of product?
- What search query variations could improve each source's precision?
- Are there entirely new sub-methods within any source's domain worth experimenting with?

Decisions must be driven ONLY by the data above, not by assumptions.

Return JSON:
{
  "analysis": "2-3 sentence insight on what the data shows",
  "adopt": [
    {
      "source": "source_name",
      "reason": "why this source is worth scaling",
      "new_query_variations": ["variation 1", "variation 2"],
      "sub_method_experiment": "describe a new technique to try within this source domain"
    }
  ],
  "scale_back": [
    {
      "source": "source_name",
      "reason": "why this source is underperforming"
    }
  ],
  "new_source_ideas": [
    {
      "name": "descriptive name",
      "description": "what this new source is and how to access it",
      "rationale": "why it would produce good leads for products like these"
    }
  ],
  "overall_recommendation": "one sentence on the most impactful evolution step"
}`;

      const res = await this.ai.generateStrategyEconomy({}, evolutionPrompt);
      const evolution = res.parsedJson;
      if (!evolution?.analysis) {
        console.log('[LeadDiscovery] Self-evolution: AI returned empty analysis');
        return;
      }

      console.log('[LeadDiscovery] Self-evolution analysis:', evolution.analysis);

      // 4. Persist evolution decisions to self_evolution_log
      await this.supabase.from('self_evolution_log').insert({
        agent: 'LEAD_DISCOVERY',
        cycle_date: new Date().toISOString(),
        source_performance: sourceSummary,
        conversion_by_source: conversionBySource,
        analysis: evolution.analysis,
        adopted_sources: evolution.adopt || [],
        scaled_back_sources: evolution.scale_back || [],
        new_source_ideas: evolution.new_source_ideas || [],
        overall_recommendation: evolution.overall_recommendation || '',
      });

      // 5. Store approved query variations as learned search keywords so the next
      //    discovery cycle uses them automatically. We insert them into a
      //    lead_evolution_queries table so generateSearchQueries() can pick them up.
      for (const adopt of (evolution.adopt || [])) {
        for (const variation of (adopt.new_query_variations || [])) {
          await this.supabase.from('lead_evolution_queries').upsert({
            source: adopt.source,
            query: variation,
            rationale: adopt.reason,
            status: 'active',
            discovered_at: new Date().toISOString(),
          }, { onConflict: 'source,query' });
        }
      }

      // 6. Log any new source ideas as pending experiments
      for (const idea of (evolution.new_source_ideas || [])) {
        await this.supabase.from('self_evolution_log').insert({
          agent: 'LEAD_DISCOVERY',
          cycle_date: new Date().toISOString(),
          source_performance: [],
          conversion_by_source: {},
          analysis: `NEW SOURCE IDEA: ${idea.name}`,
          adopted_sources: [],
          scaled_back_sources: [],
          new_source_ideas: [idea],
          overall_recommendation: idea.rationale,
        });
      }

      console.log(`[LeadDiscovery] Self-evolution complete — adopt: ${(evolution.adopt||[]).length}, scale_back: ${(evolution.scale_back||[]).length}, new ideas: ${(evolution.new_source_ideas||[]).length}`);
    } catch (err) {
      const { dynamicProblemSolver } = await import('./dynamicProblemSolver');
      await dynamicProblemSolver.solve({ error: err, agentType: 'LEAD_DISCOVERY', operation: 'evolveDiscoverySources' });
    }
  }

  /**
   * Augment AI-generated queries with any evolved/adopted queries from previous
   * self-evolution cycles. Called at the start of discoverForProduct().
   */
  private async loadEvolvedQueries(source: string): Promise<string[]> {
    try {
      const { data } = await this.supabase
        .from('lead_evolution_queries')
        .select('query')
        .eq('source', source)
        .eq('status', 'active')
        .order('discovered_at', { ascending: false })
        .limit(5);
      return (data || []).map((r: any) => r.query);
    } catch {
      return [];
    }
  }
}

export const leadDiscoveryService = new LeadDiscoveryService();
