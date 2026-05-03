import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

export interface BehavioralProfile {
  category: string;
  likes: string[];
  hates: string[];
  wants: string[];
  ignores: string[];
  buys: string[];
  rejects: string[];
  emotional_triggers: {
    primary: string;
    secondary: string[];
    negative: string[];
    emotional_arc: string;
  };
  timing_patterns: {
    peak_engagement_hours: number[];
    peak_days: string[];
    decision_velocity: 'impulsive' | 'considered' | 'deliberate';
  };
  share_drivers: string[];
  trust_signals: string[];
  rejection_signals: string[];
  confidence: number;
  data_freshness?: string;
}

/**
 * PSYCHOLOGIST ENGINE
 * Predicts in real-time how humans behave toward any product, brand, or service.
 * Analyzes WHY they act, WHEN they act, and what EMOTIONS drive every action —
 * going beyond surface behavior to reveal deep psychological patterns.
 *
 * Works in sync with: Social Listening, Emotional Intelligence, IPE, GEO, AI Brain.
 * Runs every 15 minutes. Powers Director Agent, CreativeService, and all Agents.
 */
export class PsychologistEngine {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async runCycle(): Promise<void> {
    console.log('[PsychologistEngine] Starting behavioral analysis cycle...');

    const { data: products } = await this.supabase
      .from('product_memory')
      .select('product_id, product_name, category, user_id')
      .limit(25);

    if (!products || products.length === 0) {
      console.log('[PsychologistEngine] No products to analyze');
      return;
    }

    let analyzed = 0;
    for (const product of products) {
      try {
        await this.analyzeForProduct(product);
        analyzed++;
      } catch (e: any) {
        console.error(`[PsychologistEngine] Failed for ${product.product_name}:`, e.message);
      }
    }
    console.log(`[PsychologistEngine] Cycle complete — ${analyzed}/${products.length} analyzed`);
  }

  /**
   * Run a full real-time behavioral analysis for a specific product.
   * Pulls live data from all intelligence engines and synthesizes a deep
   * psychological profile of the target audience.
   */
  async analyzeForProduct(product: any): Promise<BehavioralProfile | null> {
    const [social, emotional, platform, geo] = await Promise.all([
      this.supabase
        .from('social_conversations')
        .select('content, sentiment, intent, behavior, reaction, topics')
        .eq('category', product.category)
        .order('collected_at', { ascending: false })
        .limit(50),
      this.supabase
        .from('emotional_ownership')
        .select('emotion, ownership_percentage, confidence, owner_brand')
        .eq('category', product.category)
        .limit(20),
      this.supabase
        .from('platform_intelligence')
        .select('platform, algorithm_priorities, trending_formats, optimal_times, predictions')
        .order('captured_at', { ascending: false })
        .limit(5),
      this.supabase
        .from('narrative_snapshots')
        .select('sentiment, claims, missing_claims, competitors, query')
        .eq('brand_id', product.product_id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const socialData = social.data || [];
    const emotionalData = emotional.data || [];
    const platformData = platform.data || [];
    const geoData = geo.data || [];

    const prompt = `
You are the AdRoom PSYCHOLOGIST ENGINE — the world's most advanced real-time audience behavior prediction system.

MISSION: Predict with maximum accuracy how humans behave toward products in this category.
Not just what they say — WHY they say it, WHEN they say it, and what EMOTIONS drive every action.
Go deep: reveal unconscious patterns, hidden desires, and real rejection triggers.

PRODUCT: ${product.product_name}
CATEGORY: ${product.category}

LIVE INTELLIGENCE DATA:

Social Conversations (${socialData.length} real signals):
${JSON.stringify(socialData.slice(0, 20))}

Emotional Ownership Map (what emotions competitors own in this space):
${JSON.stringify(emotionalData)}

Platform Algorithm Intelligence (what content patterns are WINNING right now):
${JSON.stringify(platformData.slice(0, 3))}

Brand Perception by AI Models (how the market perceives this brand):
${JSON.stringify(geoData.slice(0, 5))}

ANALYZE AND PREDICT (be hyper-specific, reference actual data signals above):

1. LIKES: What behaviors show people genuinely love this category? (specific, observational)
2. HATES: What specific triggers cause instant rejection? (psychological pain points)
3. WANTS: What do they secretly desire but rarely articulate? (latent desires, aspirational)
4. IGNORES: What marketing patterns do they tune out completely? (waste signals)
5. BUYS: What specific triggers actually close the purchase decision? (conversion psychology)
6. REJECTS: What last-second factors make them abandon? (cognitive blockers)
7. PRIMARY EMOTIONAL DRIVER: The single strongest emotion driving action RIGHT NOW (from data)
8. EMOTIONAL ARC: The full journey from first exposure to purchase (emotional sequence)
9. TIMING: When is this audience most receptive? (specific hours, days, mental states)
10. SHARE TRIGGERS: What makes them share this type of content? (social currency)
11. TRUST BUILDERS: What instantly signals credibility to this audience?
12. TRUST DESTROYERS: What instantly signals risk/scam to this audience?

OUTPUT JSON (be specific, data-driven, actionable):
{
  "likes": ["specific behavioral pattern from data", "specific pattern 2"],
  "hates": ["specific rejection trigger", "trigger 2"],
  "wants": ["latent desire driven by data", "desire 2"],
  "ignores": ["marketing waste pattern this audience ignores"],
  "buys": ["specific conversion trigger", "trigger 2"],
  "rejects": ["last-second cognitive blocker", "blocker 2"],
  "emotional_triggers": {
    "primary": "the strongest emotional driver right now based on data",
    "secondary": ["supporting emotion", "another emotion"],
    "negative": ["emotion that kills conversion for this category"],
    "emotional_arc": "curiosity → trust → desire → urgency → satisfaction"
  },
  "timing_patterns": {
    "peak_engagement_hours": [7, 12, 20],
    "peak_days": ["tuesday", "thursday", "sunday"],
    "decision_velocity": "impulsive"
  },
  "share_drivers": ["specific share trigger from data", "trigger 2"],
  "trust_signals": ["specific trust builder that works for this audience"],
  "rejection_signals": ["specific trust destroyer to avoid"],
  "confidence": 0.92
}
`;

    const response = await this.ai.generateStrategy({}, prompt);
    const profile = response.parsedJson;

    if (!profile) return null;

    await this.supabase.from('psychologist_profiles').upsert({
      category: product.category,
      product_id: product.product_id,
      user_id: product.user_id,
      behavioral_profile: {
        likes: profile.likes || [],
        hates: profile.hates || [],
        wants: profile.wants || [],
        ignores: profile.ignores || [],
        buys: profile.buys || [],
        rejects: profile.rejects || [],
      },
      emotional_triggers: profile.emotional_triggers || {},
      timing_patterns: profile.timing_patterns || {},
      share_drivers: profile.share_drivers || [],
      trust_signals: profile.trust_signals || [],
      rejection_signals: profile.rejection_signals || [],
      raw_intelligence: {
        social_count: socialData.length,
        emotional_count: emotionalData.length,
        platform_count: platformData.length,
        geo_count: geoData.length,
        analyzed_at: new Date().toISOString(),
      },
      confidence_score: profile.confidence || 0.75,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' });

    console.log(`[PsychologistEngine] Profile updated for "${product.product_name}" — confidence: ${profile.confidence}`);

    return {
      category: product.category,
      likes: profile.likes || [],
      hates: profile.hates || [],
      wants: profile.wants || [],
      ignores: profile.ignores || [],
      buys: profile.buys || [],
      rejects: profile.rejects || [],
      emotional_triggers: profile.emotional_triggers || { primary: '', secondary: [], negative: [], emotional_arc: '' },
      timing_patterns: profile.timing_patterns || { peak_engagement_hours: [], peak_days: [], decision_velocity: 'considered' },
      share_drivers: profile.share_drivers || [],
      trust_signals: profile.trust_signals || [],
      rejection_signals: profile.rejection_signals || [],
      confidence: profile.confidence || 0.75,
    };
  }

  /**
   * Retrieve the latest behavioral profile for a product or category.
   * Returns null if no profile has been generated yet.
   */
  async getProfileForProduct(productId: string, category?: string): Promise<BehavioralProfile | null> {
    if (productId) {
      const { data } = await this.supabase
        .from('psychologist_profiles')
        .select('*')
        .eq('product_id', productId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      if (data) return this.mapToProfile(data);
    }

    if (category) {
      const { data } = await this.supabase
        .from('psychologist_profiles')
        .select('*')
        .eq('category', category)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      if (data) return this.mapToProfile(data);
    }

    return null;
  }

  private mapToProfile(data: any): BehavioralProfile {
    const bp = data.behavioral_profile || {};
    return {
      category: data.category,
      likes: bp.likes || [],
      hates: bp.hates || [],
      wants: bp.wants || [],
      ignores: bp.ignores || [],
      buys: bp.buys || [],
      rejects: bp.rejects || [],
      emotional_triggers: data.emotional_triggers || { primary: '', secondary: [], negative: [], emotional_arc: '' },
      timing_patterns: data.timing_patterns || { peak_engagement_hours: [], peak_days: [], decision_velocity: 'considered' },
      share_drivers: data.share_drivers || [],
      trust_signals: data.trust_signals || [],
      rejection_signals: data.rejection_signals || [],
      confidence: data.confidence_score || 0.7,
      data_freshness: data.updated_at,
    };
  }
}
