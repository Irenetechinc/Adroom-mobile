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

interface DemographicIntel {
  primaryAudience: string;
  segments: Array<{
    name: string;
    ageRange: string;
    gender: string;
    location: string;
    income: string;
    interests: string[];
    painPoints: string[];
    buyingBehavior: string;
    confidenceLevel: 'high' | 'medium' | 'low';
  }>;
  marketSize: string;
  marketGrowth: string;
  geographicFocus: string;
  languagesTone: string[];
  culturalConsiderations: string[];
  bestChannels: string[];
  worstChannels: string[];
  priceSensitivity: string;
  purchaseDrivers: string[];
  improvementSuggestions: string[];
  dataConfidence: 'real_data' | 'proxy_data' | 'general_knowledge';
  dataSource: string;
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

  /**
   * Capability 3: Demographic & Market Intelligence
   * AI Brain adapts its analysis based on what data is actually available.
   * Uses real leads/conversations when present; proxies to industry knowledge when not.
   */
  async runDemographicAnalysis(userId: string, strategyId: string): Promise<DemographicIntel | null> {
    console.log(`[RadarAgent] Running demographic & market intelligence for strategy ${strategyId}`);
    try {
      const [stratRes, leadsRes, convRes, socialRes] = await Promise.all([
        this.supabase.from('strategy_memory').select('*, product_id').eq('strategy_id', strategyId).single(),
        this.supabase.from('agent_leads').select('platform, country, intent_score, stage, platform_bio').eq('user_id', userId).eq('strategy_id', strategyId).limit(50),
        this.supabase.from('social_conversations').select('platform, sentiment, topic, language').eq('user_id', userId).eq('strategy_id', strategyId).order('created_at', { ascending: false }).limit(30),
        this.supabase.from('social_listening_data').select('content, platform, sentiment').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
      ]);

      const strategy = stratRes.data;
      if (!strategy) return null;

      let product = null;
      if (strategy.product_id) {
        const { data } = await this.supabase.from('product_memory').select('*').eq('product_id', strategy.product_id).single();
        product = data;
      }

      const leads = leadsRes.data || [];
      const conversations = convRes.data || [];
      const socialSignals = socialRes.data || [];

      // Determine data confidence level dynamically
      const hasRealLeads = leads.length >= 10;
      const hasConversations = conversations.length >= 5;
      const dataConfidence = hasRealLeads && hasConversations ? 'real_data'
        : (leads.length > 0 || conversations.length > 0) ? 'proxy_data'
        : 'general_knowledge';

      // AI Brain adapts its analysis method based on what's available
      const demographicPrompt = `You are the AdRoom AI Demographic & Market Intelligence Engine.

AVAILABLE DATA:
- Leads discovered: ${leads.length} (${dataConfidence === 'real_data' ? 'sufficient for real analysis' : dataConfidence === 'proxy_data' ? 'limited — improvise with proxies' : 'none — use general market knowledge'})
- Conversations: ${conversations.length}
- Social signals: ${socialSignals.length}

PRODUCT/SERVICE:
${product ? `
Name: ${product.product_name || product.name}
Category: ${product.category || 'unknown'}
Price: ${product.price || 'unknown'}
Description: ${(product.description || '').slice(0, 300)}
` : 'No product data — use strategy goal to infer'}

STRATEGY GOAL: ${strategy.goal}
PLATFORMS: ${JSON.stringify(strategy.platforms || [])}

LEAD SAMPLE (demographics proxy):
${leads.slice(0, 15).map((l: any) => `- Platform: ${l.platform}, Country: ${l.country || 'unknown'}, Intent: ${l.intent_score}, Stage: ${l.stage}, Bio: ${(l.platform_bio || '').slice(0, 80)}`).join('\n') || 'No leads yet'}

CONVERSATION INTELLIGENCE:
${conversations.slice(0, 10).map((c: any) => `- Platform: ${c.platform}, Sentiment: ${c.sentiment}, Topic: ${c.topic}, Language: ${c.language}`).join('\n') || 'No conversations yet'}

INSTRUCTIONS:
Data confidence: ${dataConfidence}
- If real_data: perform detailed, evidence-based demographic segmentation
- If proxy_data: use available signals + industry benchmarks to approximate
- If general_knowledge: use your knowledge of the product category and platforms to generate credible audience profiles — flag as estimated

Perform a FULL demographic & market intelligence analysis.

Return JSON ONLY:
{
  "primaryAudience": "one-sentence description of the primary target audience",
  "segments": [
    {
      "name": "Segment name (e.g. 'Young Entrepreneurs 25-34')",
      "ageRange": "e.g. 25-34",
      "gender": "male|female|mixed",
      "location": "country or region",
      "income": "low|middle|upper-middle|high",
      "interests": ["interest1", "interest2"],
      "painPoints": ["pain1", "pain2"],
      "buyingBehavior": "one sentence",
      "confidenceLevel": "high|medium|low"
    }
  ],
  "marketSize": "estimated market size or 'unknown'",
  "marketGrowth": "growing|stable|declining or estimated %",
  "geographicFocus": "primary geography",
  "languagesTone": ["tone1", "tone2"],
  "culturalConsiderations": ["consideration1"],
  "bestChannels": ["channel1", "channel2"],
  "worstChannels": ["channel1"],
  "priceSensitivity": "low|medium|high with one sentence reason",
  "purchaseDrivers": ["driver1", "driver2"],
  "improvementSuggestions": ["3-5 specific suggestions for the User to improve targeting"],
  "dataConfidence": "${dataConfidence}",
  "dataSource": "brief explanation of what data was used"
}`;

      const result = await this.ai.generateStrategy({}, demographicPrompt);
      const intel = result.parsedJson as DemographicIntel;

      if (!intel) return null;

      // Persist to platform_intelligence table so Dashboard can display it
      await this.supabase.from('platform_intelligence').upsert({
        user_id: userId,
        strategy_id: strategyId,
        intel_type: 'demographic_analysis',
        data: intel,
        confidence: dataConfidence,
        generated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,strategy_id,intel_type' });

      console.log(`[RadarAgent] Demographic analysis complete for strategy ${strategyId}. Confidence: ${dataConfidence}`);
      return intel;
    } catch (e: any) {
      console.error('[RadarAgent] Demographic analysis failed:', e.message);
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
