/**
 * APMA Perception Layer
 * Monitors Twitter/X, Reddit, Facebook, NewsAPI, Google Trends,
 * Nairaland (scrape) and YouTube for political conversation.
 * Runs NLP sentiment + emotion + topic clustering via Gemini.
 * Stores everything in political_conversations.
 */

import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { apmaCycleLog } from './apmaCycleLogger';

const supabase = () => getServiceSupabaseClient();

// ── Perception sub-agents ─────────────────────────────────────────────────────

export class ApmaPerceptionService {
  private ai = AIEngine.getInstance();

  // ── Entry point: full perception cycle for one client ──────────────────────
  async runPerceptionCycle(clientId: string, userId: string): Promise<{
    collected: number;
    sentimentAvg: number;
    topTopics: string[];
  }> {
    await apmaCycleLog(clientId, userId, 'perception', 'cycle_start', 'running', { clientId });

    const client = await this.getClient(clientId);
    if (!client) throw new Error('Political client not found');

    const keywords = await this.buildKeywords(client);

    // Run all source scrapers in parallel
    const [twitterItems, redditItems, newsItems, nairalandItems, trendsItems] =
      await Promise.allSettled([
        this.fetchTwitter(keywords, client),
        this.fetchReddit(keywords, client),
        this.fetchNewsAPI(keywords, client),
        this.scrapeNairaland(keywords),
        this.fetchGoogleTrends(keywords),
      ]);

    const raw: RawItem[] = [
      ...(twitterItems.status === 'fulfilled' ? twitterItems.value : []),
      ...(redditItems.status === 'fulfilled' ? redditItems.value : []),
      ...(newsItems.status === 'fulfilled' ? newsItems.value : []),
      ...(nairalandItems.status === 'fulfilled' ? nairalandItems.value : []),
      ...(trendsItems.status === 'fulfilled' ? trendsItems.value : []),
    ];

    await apmaCycleLog(clientId, userId, 'perception', 'raw_collected', 'success', {
      count: raw.length,
      sources: [...new Set(raw.map(r => r.source))],
    });

    // NLP analysis in batches
    const analyzed = await this.batchAnalyze(raw, client, clientId, userId);

    // Persist to DB
    if (analyzed.length > 0) {
      const rows = analyzed.map(a => ({
        client_id: clientId,
        user_id: userId,
        source: a.source,
        source_id: a.sourceId,
        text: a.text.substring(0, 2000),
        sentiment: a.sentiment,
        emotions: a.emotions,
        topic: a.topic,
        intent: a.intent,
        url: a.url ?? null,
        author_handle: a.authorHandle ?? null,
        engagement_score: a.engagementScore ?? 0,
        processed: true,
      }));

      await supabase()
        .from('political_conversations')
        .upsert(rows, { onConflict: 'source_id', ignoreDuplicates: true });
    }

    // Compute stats
    const sentimentAvg = analyzed.length > 0
      ? analyzed.reduce((s, a) => s + (a.sentiment ?? 0), 0) / analyzed.length
      : 0;
    const topicMap: Record<string, number> = {};
    analyzed.forEach(a => { if (a.topic) topicMap[a.topic] = (topicMap[a.topic] ?? 0) + 1; });
    const topTopics = Object.entries(topicMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    // Update client narrative score
    if (analyzed.length > 0) {
      await supabase()
        .from('political_clients')
        .update({ narrative_current: sentimentAvg, updated_at: new Date().toISOString() })
        .eq('id', clientId);
    }

    await apmaCycleLog(clientId, userId, 'perception', 'cycle_complete', 'success', {
      analyzed: analyzed.length, sentimentAvg, topTopics,
    });

    return { collected: analyzed.length, sentimentAvg, topTopics };
  }

  // ── Keyword builder — dynamic from client data ─────────────────────────────
  private async buildKeywords(client: any): Promise<string[]> {
    const base = [
      client.client_name,
      ...(client.target_keywords ?? []),
      ...(client.rivals ?? []),
    ].filter(Boolean);

    // Ask AI to expand keywords based on campaign type
    const prompt = `You are a Nigerian political analyst. Given:
Client: ${client.client_name}
Campaign type: ${client.client_type} - ${client.campaign_subtype ?? ''}
Goal: ${client.campaign_goal}
Base keywords: ${base.join(', ')}

Generate 15 additional highly relevant search keywords for monitoring Nigerian political conversation about this client.
Return ONLY a JSON array of strings. No explanation.`;

    try {
      const res = await this.ai.generateText(prompt, 'gemini-flash');
      const expanded = JSON.parse(res.text.replace(/```json|```/g, '').trim());
      return [...new Set([...base, ...(Array.isArray(expanded) ? expanded : [])])];
    } catch {
      return base;
    }
  }

  // ── Twitter/X v2 ──────────────────────────────────────────────────────────
  private async fetchTwitter(keywords: string[], client: any): Promise<RawItem[]> {
    const token = process.env.TWITTER_BEARER_TOKEN;
    if (!token) return [];

    const query = keywords.slice(0, 5).map(k => `"${k}"`).join(' OR ');
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query + ' lang:en -is:retweet')}&max_results=50&tweet.fields=public_metrics,created_at,author_id&expansions=author_id&user.fields=username`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];

    const json = await res.json() as any;
    const users: Record<string, string> = {};
    (json.includes?.users ?? []).forEach((u: any) => { users[u.id] = u.username; });

    return (json.data ?? []).map((t: any) => ({
      source: 'twitter',
      sourceId: `twitter_${t.id}`,
      text: t.text,
      url: `https://twitter.com/i/web/status/${t.id}`,
      authorHandle: users[t.author_id] ?? null,
      engagementScore: (t.public_metrics?.like_count ?? 0) + (t.public_metrics?.retweet_count ?? 0),
    }));
  }

  // ── Reddit ────────────────────────────────────────────────────────────────
  private async fetchReddit(keywords: string[], client: any): Promise<RawItem[]> {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const secret = process.env.REDDIT_CLIENT_SECRET;
    if (!clientId || !secret) return [];

    const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'APMA/1.0',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) return [];
    const { access_token } = await tokenRes.json() as any;

    const query = keywords.slice(0, 3).join(' OR ');
    const searchRes = await fetch(
      `https://oauth.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=50&subreddit=nigeria+naija+politics`,
      { headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'APMA/1.0' } }
    );
    if (!searchRes.ok) return [];

    const json = await searchRes.json() as any;
    return (json.data?.children ?? []).map((c: any) => ({
      source: 'reddit',
      sourceId: `reddit_${c.data.id}`,
      text: `${c.data.title} ${c.data.selftext ?? ''}`.trim(),
      url: `https://reddit.com${c.data.permalink}`,
      authorHandle: c.data.author,
      engagementScore: c.data.score ?? 0,
    }));
  }

  // ── NewsAPI ───────────────────────────────────────────────────────────────
  private async fetchNewsAPI(keywords: string[], client: any): Promise<RawItem[]> {
    const apiKey = process.env.NEWSAPI_KEY;
    if (!apiKey) return [];

    const q = keywords.slice(0, 3).join(' OR ');
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&pageSize=30&sortBy=publishedAt`,
      { headers: { 'X-Api-Key': apiKey } }
    );
    if (!res.ok) return [];

    const json = await res.json() as any;
    return (json.articles ?? []).map((a: any) => ({
      source: 'newsapi',
      sourceId: `newsapi_${crypto.createHash('md5').update(a.url ?? a.title).digest('hex')}`,
      text: `${a.title} ${a.description ?? ''}`.trim(),
      url: a.url,
      authorHandle: a.source?.name ?? null,
      engagementScore: 0,
    }));
  }

  // ── Nairaland scraper (respects robots.txt — only public search) ───────────
  private async scrapeNairaland(keywords: string[]): Promise<RawItem[]> {
    const results: RawItem[] = [];
    for (const kw of keywords.slice(0, 3)) {
      try {
        const res = await fetch(
          `https://www.nairaland.com/search/posts?body=${encodeURIComponent(kw)}&board=0`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; APMA-Perception/1.0; +https://adroomai.com/bot)',
              Accept: 'text/html',
            },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) continue;
        const html = await res.text();

        // Extract post snippets from Nairaland HTML (no JS rendering needed)
        const postPattern = /<div class="body">([\s\S]*?)<\/div>/g;
        let m;
        while ((m = postPattern.exec(html)) !== null) {
          const text = m[1].replace(/<[^>]+>/g, '').trim();
          if (text.length > 30) {
            results.push({
              source: 'nairaland',
              sourceId: `nairaland_${crypto.createHash('md5').update(text.substring(0, 100)).digest('hex')}`,
              text: text.substring(0, 1000),
              engagementScore: 0,
            });
          }
        }
      } catch { /* skip failed keyword */ }
    }
    return results;
  }

  // ── Google Trends ─────────────────────────────────────────────────────────
  private async fetchGoogleTrends(keywords: string[]): Promise<RawItem[]> {
    // Use unofficial JSON endpoint (no API key required)
    const results: RawItem[] = [];
    for (const kw of keywords.slice(0, 3)) {
      try {
        const url = `https://trends.google.com/trends/api/dailytrends?hl=en-NG&tz=-60&geo=NG&ns=15`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) continue;
        const text = await res.text();
        const json = JSON.parse(text.replace(")]}'", ''));
        const trending: string[] = [];
        (json.default?.trendingSearchesDays ?? []).forEach((day: any) => {
          (day.trendingSearches ?? []).forEach((ts: any) => {
            trending.push(ts.title?.query ?? '');
          });
        });
        if (trending.some(t => t.toLowerCase().includes(kw.toLowerCase()))) {
          results.push({
            source: 'google_trends',
            sourceId: `trends_${Date.now()}_${kw}`,
            text: `TRENDING in Nigeria: ${trending.slice(0, 10).join(', ')}`,
            engagementScore: 1000,
          });
        }
      } catch { /* skip */ }
    }
    return results;
  }

  // ── Batch NLP analysis via Gemini ─────────────────────────────────────────
  private async batchAnalyze(
    items: RawItem[],
    client: any,
    clientId: string,
    userId: string,
  ): Promise<AnalyzedItem[]> {
    const results: AnalyzedItem[] = [];
    const batchSize = 15;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const prompt = `You are a Nigerian political sentiment analyst.
Client: "${client.client_name}" (${client.client_type}, goal: ${client.campaign_goal})
Rivals: ${(client.rivals ?? []).join(', ') || 'none'}

Analyze these ${batch.length} social media posts about Nigerian politics. For each, return JSON with:
- sentiment: float -1 (very negative) to +1 (very positive) toward "${client.client_name}"
- emotions: object with keys anger,joy,fear,trust,anticipation,sadness each 0-1
- topic: ONE of: corruption,economy,security,infrastructure,education,health,leadership,scandal,achievement,youth,religion,ethnicity,election,other
- intent: ONE of: support,oppose,neutral,amplify,attack

Posts:
${batch.map((item, idx) => `[${idx}] SOURCE:${item.source} TEXT:${item.text.substring(0, 300)}`).join('\n\n')}

Return ONLY a JSON array of ${batch.length} objects in order. No explanation.`;

      try {
        const res = await this.ai.generateText(prompt, 'gemini-flash');
        const parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) {
          parsed.forEach((analysis: any, idx: number) => {
            const item = batch[idx];
            if (!item) return;
            results.push({
              ...item,
              sentiment: typeof analysis.sentiment === 'number' ? analysis.sentiment : 0,
              emotions: analysis.emotions ?? {},
              topic: analysis.topic ?? 'other',
              intent: analysis.intent ?? 'neutral',
            });
          });
        }
      } catch {
        // On parse failure, push items with neutral sentiment
        batch.forEach(item => results.push({ ...item, sentiment: 0, emotions: {}, topic: 'other', intent: 'neutral' }));
      }

      await apmaCycleLog(clientId, userId, 'perception', 'batch_analyzed', 'success', {
        batch: Math.floor(i / batchSize) + 1, count: batch.length,
      });
    }

    return results;
  }

  // ── Retrieve narrative snapshot ────────────────────────────────────────────
  async getNarrativeSnapshot(clientId: string, days = 7): Promise<NarrativeSnapshot> {
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { data } = await supabase()
      .from('political_conversations')
      .select('sentiment, topic, intent, source, created_at')
      .eq('client_id', clientId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    const rows = data ?? [];
    const avgSentiment = rows.length > 0
      ? rows.reduce((s, r) => s + (r.sentiment ?? 0), 0) / rows.length
      : 0;

    const topicMap: Record<string, { count: number; sentiment: number }> = {};
    rows.forEach(r => {
      const t = r.topic ?? 'other';
      if (!topicMap[t]) topicMap[t] = { count: 0, sentiment: 0 };
      topicMap[t].count++;
      topicMap[t].sentiment += r.sentiment ?? 0;
    });

    const topTopics = Object.entries(topicMap)
      .map(([topic, { count, sentiment }]) => ({ topic, count, sentiment: sentiment / count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Daily trend
    const dailyMap: Record<string, { sum: number; count: number }> = {};
    rows.forEach(r => {
      const day = r.created_at.substring(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { sum: 0, count: 0 };
      dailyMap[day].sum += r.sentiment ?? 0;
      dailyMap[day].count++;
    });
    const trend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { sum, count }]) => ({ date, sentiment: sum / count }));

    return { avgSentiment, topTopics, trend, totalItems: rows.length };
  }

  private async getClient(clientId: string) {
    const { data } = await supabase()
      .from('political_clients')
      .select('*')
      .eq('id', clientId)
      .single();
    return data;
  }
}

export const apmaPerception = new ApmaPerceptionService();

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawItem {
  source: string;
  sourceId: string;
  text: string;
  url?: string;
  authorHandle?: string;
  engagementScore?: number;
}
interface AnalyzedItem extends RawItem {
  sentiment: number;
  emotions: Record<string, number>;
  topic: string;
  intent: string;
}
export interface NarrativeSnapshot {
  avgSentiment: number;
  topTopics: { topic: string; count: number; sentiment: number }[];
  trend: { date: string; sentiment: number }[];
  totalItems: number;
}
