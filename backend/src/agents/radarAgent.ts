import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

interface RadarIntel {
  competitorMentions: string[];
  trendingTopics: string[];
  sentimentScore: number;
  opportunities: string[];
  threats: string[];
  localInsights: string[];
  recommendedActions: string[];
}

export class RadarAgent {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async runScan(userId: string, strategyId: string): Promise<RadarIntel | null> {
    console.log(`[RadarAgent] Running scan for strategy ${strategyId}`);

    try {
      const { data: strategy } = await this.supabase
        .from('strategy_memory')
        .select('*, product_id')
        .eq('strategy_id', strategyId)
        .single();

      if (!strategy) return null;

      let product = null;
      if (strategy.product_id) {
        const { data } = await this.supabase
          .from('product_memory')
          .select('*')
          .eq('product_id', strategy.product_id)
          .single();
        product = data;
      }

      const { data: socialSignals } = await this.supabase
        .from('social_listening_data')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      const prompt = `
You are a Radar Intelligence Agent for AdRoom AI. Analyze the current market situation for this strategy.

STRATEGY:
- Goal: ${strategy.goal}
- Platforms: ${JSON.stringify(strategy.platforms)}
- Status: ${strategy.status}

PRODUCT/SERVICE:
${product ? JSON.stringify(product, null, 2) : 'No product data available'}

RECENT SOCIAL SIGNALS:
${JSON.stringify(socialSignals?.slice(0, 10) || [], null, 2)}

Perform a deep radar scan and return JSON with:
{
  "competitorMentions": ["array of competitor or market movements detected"],
  "trendingTopics": ["topics trending relevant to this product/service category"],
  "sentimentScore": 0.0-1.0 (overall market sentiment for this niche),
  "opportunities": ["specific market opportunities to exploit NOW"],
  "threats": ["threats or headwinds to monitor"],
  "localInsights": ["location or demographic insights if relevant"],
  "recommendedActions": ["3-5 specific recommended next actions for the AI agents"]
}

Be specific, actionable, and data-driven. Focus on insights that can improve campaign performance.
      `;

      const result = await this.ai.generateStrategy({}, prompt);
      const intel = result.parsedJson as RadarIntel;

      if (!intel) return null;

      await this.supabase.from('radar_intel').insert({
        user_id: userId,
        strategy_id: strategyId,
        competitor_mentions: intel.competitorMentions,
        trending_topics: intel.trendingTopics,
        sentiment_score: intel.sentimentScore,
        opportunities: intel.opportunities,
        threats: intel.threats,
        local_insights: intel.localInsights,
        recommended_actions: intel.recommendedActions,
        scanned_at: new Date().toISOString(),
      });

      console.log(`[RadarAgent] Scan complete for strategy ${strategyId}. Sentiment: ${intel.sentimentScore}`);
      return intel;
    } catch (e: any) {
      console.error('[RadarAgent] Scan failed:', e.message);
      return null;
    }
  }

  async runGlobalScan(): Promise<void> {
    console.log('[RadarAgent] Running global radar scan across all active strategies...');

    try {
      const { data: activeStrategies } = await this.supabase
        .from('strategy_memory')
        .select('strategy_id, user_id')
        .eq('status', 'active');

      if (!activeStrategies?.length) {
        console.log('[RadarAgent] No active strategies to scan.');
        return;
      }

      for (const s of activeStrategies) {
        await this.runScan(s.user_id, s.strategy_id);
      }

      console.log(`[RadarAgent] Global scan complete. Processed ${activeStrategies.length} strategies.`);
    } catch (e: any) {
      console.error('[RadarAgent] Global scan error:', e.message);
    }
  }
}
