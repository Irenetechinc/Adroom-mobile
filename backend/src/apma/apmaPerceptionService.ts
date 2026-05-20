import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaGeoService } from './apmaGeoService';
import type { PerceptionSnapshot } from './apmaTypes';

const NEWSAPI_KEY        = process.env.NEWSAPI_KEY || '';
const REDDIT_CLIENT_ID   = process.env.REDDIT_CLIENT_ID || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';

interface RawConversation {
  source: string;
  external_id?: string;
  author_handle?: string;
  content: string;
  url?: string;
  published_at?: string;
  engagement_score?: number;
}

export class APMAPerceptionService {
  private ai = AIEngine.getInstance();

  async runPerceptionCycle(
    clientId: string,
    campaignId: string,
    keywords: string[],
    platforms: string[],
    country: string = 'US',
  ): Promise<PerceptionSnapshot> {
    const geoCtx = await apmaGeoService.getCountryContext(country);

    // Augment keywords with country-specific news keywords
    const allKeywords = [...new Set([...keywords, ...geoCtx.newsKeywords.slice(0, 3)])];

    const raw: RawConversation[] = [];

    await Promise.allSettled([
      platforms.includes('twitter')
        ? this._fetchTwitter(allKeywords, geoCtx.language).then((r) => raw.push(...r))
        : Promise.resolve(),
      platforms.includes('reddit')
        ? this._fetchReddit(allKeywords, country).then((r) => raw.push(...r))
        : Promise.resolve(),
      // Always fetch news regardless of platforms — it's perception, not publishing
      this._fetchNews(allKeywords, country, geoCtx.language).then((r) => raw.push(...r)),
    ]);

    if (!raw.length) {
      return {
        client_id: clientId,
        campaign_id: campaignId,
        overall_sentiment: 0,
        sample_size: 0,
        dominant_topic: keywords[0] ?? 'general',
        top_narratives: [],
        trending_keywords: allKeywords,
        threat_signals: [],
        opportunity_signals: [],
      };
    }

    const analysed = await this._analyseConversations(raw, allKeywords, geoCtx.countryName);
    await this._storeConversations(clientId, campaignId, analysed);
    return this._buildSnapshot(clientId, campaignId, analysed, allKeywords);
  }

  private async _fetchTwitter(keywords: string[], language: string): Promise<RawConversation[]> {
    const bearer = process.env.TWITTER_BEARER_TOKEN || '';
    if (!bearer) return [];
    try {
      const lang = language.length === 2 ? language : 'en';
      const q = encodeURIComponent(
        `(${keywords.slice(0, 3).join(' OR ')}) lang:${lang} -is:retweet`,
      );
      const res = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=25&tweet.fields=created_at,public_metrics,author_id`,
        { headers: { Authorization: `Bearer ${bearer}` } },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((t: any) => ({
        source: 'twitter',
        external_id: t.id,
        content: t.text,
        published_at: t.created_at,
        engagement_score: (t.public_metrics?.like_count ?? 0) + (t.public_metrics?.retweet_count ?? 0) * 2,
        url: `https://twitter.com/i/web/status/${t.id}`,
      }));
    } catch { return []; }
  }

  private async _fetchReddit(keywords: string[], country: string): Promise<RawConversation[]> {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return [];
    try {
      const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'APMA/2.0',
        },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) return [];
      const { access_token } = await tokenRes.json();
      const q = encodeURIComponent(keywords.slice(0, 3).join(' OR '));
      const res = await fetch(
        `https://oauth.reddit.com/search.json?q=${q}&sort=new&limit=25&type=link`,
        { headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'APMA/2.0' } },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data?.children || []).map((c: any) => ({
        source: 'reddit',
        external_id: c.data.id,
        author_handle: c.data.author,
        content: `${c.data.title}. ${c.data.selftext || ''}`.slice(0, 1000),
        published_at: new Date(c.data.created_utc * 1000).toISOString(),
        engagement_score: (c.data.score ?? 0) + (c.data.num_comments ?? 0) * 2,
        url: `https://reddit.com${c.data.permalink}`,
      }));
    } catch { return []; }
  }

  private async _fetchNews(keywords: string[], country: string, language: string): Promise<RawConversation[]> {
    if (!NEWSAPI_KEY) return [];
    try {
      const q = encodeURIComponent(keywords.slice(0, 3).join(' OR '));
      const lang = language.length === 2 ? language : 'en';
      // Try country-specific news first, fall back to everything
      const urls = [
        `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=20&language=${lang}`,
        `https://newsapi.org/v2/top-headlines?q=${q}&pageSize=15&language=${lang}`,
      ];
      const results: RawConversation[] = [];
      for (const url of urls) {
        try {
          const res = await fetch(url, { headers: { 'X-Api-Key': NEWSAPI_KEY } });
          if (!res.ok) continue;
          const data = await res.json();
          results.push(...(data.articles || []).map((a: any) => ({
            source: 'news',
            content: `${a.title}. ${a.description || ''}`.trim(),
            author_handle: a.source?.name,
            published_at: a.publishedAt,
            engagement_score: 60,
            url: a.url,
          })));
        } catch {}
      }
      return results;
    } catch { return []; }
  }

  private async _analyseConversations(
    raw: RawConversation[],
    keywords: string[],
    countryName: string,
  ): Promise<Array<RawConversation & { sentiment: number; emotions: Record<string, number>; topics: string[]; narrative_cluster: string }>> {
    const BATCH = 12;
    const results: any[] = [];

    for (let i = 0; i < raw.length; i += BATCH) {
      const batch = raw.slice(i, i + BATCH);
      const texts = batch.map((b, idx) => `[${idx}] ${b.content.slice(0, 250)}`).join('\n');

      try {
        const resp = await this.ai.generateWithGemini(
          `You are a political sentiment analysis engine for ${countryName}.

Analyse these ${batch.length} texts related to political keywords: ${keywords.slice(0, 5).join(', ')}.

For EACH text (identified by [index]) return a JSON array with one object containing:
- sentiment: number -1.0 (very negative) to +1.0 (very positive) relative to the political actors/keywords
- emotions: { anger, fear, joy, trust, sadness, surprise } as 0-1 floats
- topics: array of 1-3 political topic labels from the text
- narrative_cluster: single string for dominant narrative (e.g. "corruption", "economic_growth", "security_crisis", "good_governance", "infrastructure_failure", "election_integrity")

Texts:
${texts}

Return ONLY a valid JSON array of ${batch.length} objects. No explanation.`,
          { maxTokens: 2000 },
        );

        let parsed: any[] = [];
        try {
          parsed = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
        } catch {
          parsed = batch.map(() => ({ sentiment: 0, emotions: {}, topics: [], narrative_cluster: 'general' }));
        }

        batch.forEach((b, idx) => {
          results.push({ ...b, ...(parsed[idx] ?? { sentiment: 0, emotions: {}, topics: [], narrative_cluster: 'general' }) });
        });
      } catch {
        batch.forEach((b) => results.push({ ...b, sentiment: 0, emotions: {}, topics: [], narrative_cluster: 'general' }));
      }
    }

    return results;
  }

  private async _storeConversations(clientId: string, campaignId: string, analysed: any[]): Promise<void> {
    const sb = getServiceSupabaseClient();
    const rows = analysed.map((a) => ({
      client_id: clientId,
      campaign_id: campaignId,
      source: a.source,
      external_id: a.external_id ?? null,
      author_handle: a.author_handle ?? null,
      content: (a.content ?? '').slice(0, 2000),
      sentiment: a.sentiment ?? 0,
      emotions: a.emotions ?? {},
      topics: a.topics ?? [],
      narrative_cluster: a.narrative_cluster ?? 'general',
      engagement_score: a.engagement_score ?? 0,
      url: a.url ?? null,
      published_at: a.published_at ?? null,
    }));
    if (rows.length) await sb.from('political_conversations').insert(rows);
  }

  private _buildSnapshot(clientId: string, campaignId: string, analysed: any[], keywords: string[]): PerceptionSnapshot {
    const scores = analysed.map((a) => a.sentiment as number);
    const overall = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const clusters: Record<string, { count: number; sentSum: number }> = {};
    for (const a of analysed) {
      const c = a.narrative_cluster || 'general';
      if (!clusters[c]) clusters[c] = { count: 0, sentSum: 0 };
      clusters[c].count++;
      clusters[c].sentSum += a.sentiment;
    }

    const topNarratives = Object.entries(clusters)
      .sort((x, y) => y[1].count - x[1].count)
      .slice(0, 6)
      .map(([topic, v]) => ({
        topic,
        sentiment: parseFloat((v.sentSum / v.count).toFixed(4)),
        volume: v.count,
      }));

    const threats = analysed
      .filter((a) => a.sentiment < -0.35)
      .sort((x, y) => x.sentiment - y.sentiment)
      .slice(0, 4)
      .map((a) => a.narrative_cluster as string);

    const opportunities = analysed
      .filter((a) => a.sentiment > 0.35)
      .sort((x, y) => y.sentiment - x.sentiment)
      .slice(0, 4)
      .map((a) => a.narrative_cluster as string);

    return {
      client_id: clientId,
      campaign_id: campaignId,
      overall_sentiment: parseFloat(overall.toFixed(4)),
      sample_size: analysed.length,
      dominant_topic: topNarratives[0]?.topic ?? keywords[0] ?? 'general',
      top_narratives: topNarratives,
      trending_keywords: keywords,
      threat_signals: [...new Set(threats)],
      opportunity_signals: [...new Set(opportunities)],
    };
  }

  async computeNarrativeScore(clientId: string, campaignId: string, windowHours = 24): Promise<number> {
    const sb = getServiceSupabaseClient();
    const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
    const { data } = await sb
      .from('political_conversations')
      .select('sentiment, engagement_score')
      .eq('client_id', clientId)
      .eq('campaign_id', campaignId)
      .gte('created_at', since);

    if (!data?.length) return 0;

    let weightedSum = 0;
    let totalWeight = 0;
    for (const row of data as any[]) {
      const w = Math.max(1, row.engagement_score ?? 1);
      weightedSum += (row.sentiment ?? 0) * w;
      totalWeight += w;
    }
    return totalWeight ? parseFloat((weightedSum / totalWeight).toFixed(4)) : 0;
  }
}

export const apmaPerceptionService = new APMAPerceptionService();
