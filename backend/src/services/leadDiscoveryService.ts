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
    // AI Brain generates the search queries — nothing hardcoded
    const queries = await this.generateSearchQueries(product);

    const allLeads: RawLead[] = [];

    // Run all agents in parallel, failures don't stop others
    const results = await Promise.allSettled([
      this.socialListeningAgent(queries, product, userId),
      this.redditAgent(queries, product, userId),
      this.newsApiAgent(queries, product, userId),
      this.forumAgent(queries, product, userId),
      this.competitorAgent(queries, product, userId),
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
}

export const leadDiscoveryService = new LeadDiscoveryService();
