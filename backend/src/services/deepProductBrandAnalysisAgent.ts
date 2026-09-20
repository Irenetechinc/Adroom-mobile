import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { dataCollectionAgent, rankAndVerifyCollectedData } from './dataCollectionAgent';

export interface DeepBrandAnalysisInput {
  productName?: string;
  category?: string;
  description?: string;
  socialSignals?: Array<Record<string, any>>;
  platformIntel?: Record<string, any>;
  emotionSignals?: Array<Record<string, any>>;
  geoSignals?: Array<Record<string, any>>;
  marketSignals?: Array<Record<string, any>>;
}

export interface DeepBrandAction {
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  owner?: string;
}

export interface DeepBrandAnalysis {
  summary: string;
  audienceSegments: string[];
  unmetNeeds: string[];
  competitiveEdges: string[];
  riskFlags: string[];
  nextActions: DeepBrandAction[];
  confidence: number;
}

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = toText(item).trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, 8);
}

function normalizeNextActions(value: unknown): DeepBrandAction[] {
  if (!Array.isArray(value)) return [];

  const actions: DeepBrandAction[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;

    const candidate = item as Record<string, any>;
    const action = toText(candidate.action || candidate.title || candidate.next_action || '').trim();
    const reason = toText(candidate.reason || candidate.rationale || '').trim();
    const priorityValue = String(candidate.priority || 'medium').toLowerCase();
    const priority = priorityValue === 'high' || priorityValue === 'medium' || priorityValue === 'low'
      ? (priorityValue as 'high' | 'medium' | 'low')
      : 'medium';
    const owner = toText(candidate.owner || candidate.owner_role || '').trim();

    if (!action) continue;

    actions.push({
      action,
      reason: reason || 'Based on the latest live intelligence signals.',
      priority,
      owner: owner || undefined,
    });
  }

  return actions.slice(0, 6);
}

export function buildDeepBrandAnalysisPrompt(input: DeepBrandAnalysisInput): string {
  const productName = input.productName || 'This product';
  const category = input.category || 'general';
  const description = input.description || 'No description provided';
  const socialSignals = JSON.stringify(input.socialSignals || [], null, 2).slice(0, 3000);
  const platformIntel = JSON.stringify(input.platformIntel || {}, null, 2).slice(0, 2000);
  const emotionSignals = JSON.stringify(input.emotionSignals || [], null, 2).slice(0, 2000);
  const geoSignals = JSON.stringify(input.geoSignals || [], null, 2).slice(0, 2000);
  const marketSignals = JSON.stringify(input.marketSignals || [], null, 2).slice(0, 2000);

  return `You are the AdRoom Deep Product & Brand Analysis Agent.
Your responsibility is to analyze the product from live intelligence and produce a concise but high-grade market readout.

MISSION:
- Use the LIVE INTELLIGENCE only.
- Do not invent facts, references, or unsupported claims.
- Extract the real audience signals, unmet needs, competitive edges, and product risks.
- Recommend the next highest-value actions, with priority labels and reasons grounded in the data.

PRODUCT:
Name: ${productName}
Category: ${category}
Description: ${description}

LIVE INTELLIGENCE:
SOCIAL SIGNALS:
${socialSignals}

PLATFORM INTELLIGENCE:
${platformIntel}

EMOTIONAL SIGNALS:
${emotionSignals}

GEO / SEARCH / NARRATIVE SIGNALS:
${geoSignals}

MARKET SIGNALS:
${marketSignals}

Return JSON only with this exact shape:
{
  "summary": "2-4 sentence summary of current brand signal and positioning opportunity",
  "audienceSegments": ["segment 1", "segment 2"],
  "unmetNeeds": ["need 1", "need 2"],
  "competitiveEdges": ["edge 1", "edge 2"],
  "riskFlags": ["risk 1", "risk 2"],
  "nextActions": [
    {
      "action": "specific next action",
      "reason": "why this matters based on the live data",
      "priority": "high|medium|low",
      "owner": "marketing|product|creative|ops"
    }
  ],
  "confidence": 0.82
}

Rules:
- Keep the language factual and operational.
- Use no markdown fences.
- Prefer concrete, scenario-specific actions over generic advice.
- If there is weak evidence, lower confidence and keep the summary conservative.`;
}

export function normalizeDeepBrandAnalysis(input: any): DeepBrandAnalysis {
  const summary = toText(input?.summary || input?.analysis || '').trim();
  const audienceSegments = normalizeStringArray(input?.audienceSegments || input?.audience_segments || input?.segments);
  const unmetNeeds = normalizeStringArray(input?.unmetNeeds || input?.unmet_needs || input?.needs);
  const competitiveEdges = normalizeStringArray(input?.competitiveEdges || input?.competitive_edges || input?.edges);
  const riskFlags = normalizeStringArray(input?.riskFlags || input?.risk_flags || input?.risks);
  const nextActions = normalizeNextActions(input?.nextActions || input?.next_actions || input?.actions);

  const normalizedSummary = summary
    ? summary
    : `The current brand signal is still emerging; the strongest opportunity is to tighten positioning, reinforce the product's value, and reduce ambiguity around the audience and promise.`;

  const confidence = clamp(
    Number(input?.confidence ?? (nextActions.length > 0 ? 0.74 : 0.68)),
    0,
    1,
  );

  return {
    summary: normalizedSummary,
    audienceSegments: audienceSegments.length ? audienceSegments : ['Early adopters in the target category'],
    unmetNeeds: unmetNeeds.length ? unmetNeeds : ['The audience needs clearer proof of product value'],
    competitiveEdges: competitiveEdges.length ? competitiveEdges : ['There is room to sharpen differentiation and customer proof'],
    riskFlags: riskFlags.length ? riskFlags : ['Positioning is still too broad or ambiguous to win decisively'],
    nextActions: nextActions.length ? nextActions : [{
      action: 'Refine the product positioning and proof points using current live audience data',
      reason: 'The data suggests the audience still needs stronger clarity and stronger value validation before conversion peaks.',
      priority: 'high',
      owner: 'marketing',
    }],
    confidence: Number.isFinite(confidence) ? confidence : 0.72,
  };
}

export class DeepProductBrandAnalysisAgent {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient> | null;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = this.createSupabaseClient();
  }

  private createSupabaseClient(): ReturnType<typeof getServiceSupabaseClient> | null {
    try {
      return getServiceSupabaseClient();
    } catch (error: any) {
      console.warn('[DeepProductBrandAnalysis] Supabase config is not ready yet; runtime analysis will be skipped until env is configured.', error?.message || error);
      return null;
    }
  }

  async runCycle(): Promise<void> {
    if (!this.supabase) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing; deep product analysis is unavailable until the backend env is configured.');
    }

    console.log('[DeepProductBrandAnalysis] Running live product and brand analysis cycle...');

    const { data: activeStrategies, error: strategyError } = await this.supabase
      .from('strategies')
      .select('id, user_id, product_id, title, goal, status, is_active')
      .eq('is_active', true)
      .eq('status', 'active')
      .not('product_id', 'is', null)
      .limit(25);
    if (strategyError) throw new Error(`Active strategy query failed: ${strategyError.message}`);
    const productIds = Array.from(new Set((activeStrategies || []).map((strategy: any) => strategy.product_id).filter(Boolean)));
    if (!productIds.length) {
      console.log('[DeepProductBrandAnalysis] No active approved strategies with products available for deep analysis.');
      return;
    }
    const { data: products, error: productError } = await this.supabase
      .from('product_memory')
      .select('*')
      .in('product_id', productIds);
    if (productError) throw new Error(`Active strategy product query failed: ${productError.message}`);

    if (!products?.length) {
      console.log('[DeepProductBrandAnalysis] No products available for deep analysis.');
      return;
    }

    for (const product of products || []) {
      try {
        const strategy = (activeStrategies || []).find((item: any) => item.product_id === product.product_id);
        await this.analyzeProduct({ ...product, strategy_id: strategy?.id, strategy_status: strategy?.status });
      } catch (error: any) {
        console.error('[DeepProductBrandAnalysis] Product analysis failed:', error?.message || error);
      }
    }
  }

  async analyzeProduct(product: any): Promise<DeepBrandAnalysis> {
    if (!this.supabase) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing; deep product analysis is unavailable until the backend env is configured.');
    }

    const productName = product.product_name || product.name || 'Unknown product';
    const category = product.category || 'general';
    const description = product.description || product.tagline || 'No description available';
    const userId = product.user_id;

    const [social, platform, emotional, geo] = await Promise.all([
      this.supabase
        .from('social_conversations')
        .select('content, sentiment, intent, topics, behavior')
        .eq('category', category)
        .order('collected_at', { ascending: false })
        .limit(15),
      this.supabase
        .from('platform_intelligence')
        .select('platform, algorithm_priorities, trending_formats, optimal_times, predictions')
        .order('captured_at', { ascending: false })
        .limit(10),
      this.supabase
        .from('emotional_ownership')
        .select('emotion, ownership_percentage, confidence, owner_brand')
        .eq('category', category)
        .limit(15),
      this.supabase
        .from('narrative_snapshots')
        .select('query, sentiment, claims, missing_claims, competitors')
        .eq('category', category)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const liveCollection = await dataCollectionAgent.collectForStrategy({
      strategyId: product.id ? `product:${product.id}` : undefined,
      strategyGoal: `deep analysis for ${productName}`,
      productName,
      category,
      dataNeed: 'fresh audience demand, competitor framing, price pressure, and user pain points',
      audience: 'current target audience and likely buyers',
      marketContext: description,
      userId: userId || undefined,
      timeWindowHours: 24,
      sourceHints: ['reddit', 'search', 'news', 'review', 'social'],
      extraContext: { productDescription: description },
    }).catch(() => ({ evidence: { verified: [], rejected: [], summary: 'Collection unavailable', confidence: 0 } }));

    const verifiedEvidence = liveCollection.evidence.verified.map((item) => ({
      title: item.title,
      source: item.source,
      snippet: item.snippet,
      capturedAt: item.capturedAt,
      trustScore: item.trustScore,
      verification: item.verification,
      freshnessHours: item.freshnessHours,
    }));

    const prompt = buildDeepBrandAnalysisPrompt({
      productName,
      category,
      description,
      socialSignals: social.data || [],
      platformIntel: platform.data || [],
      emotionSignals: emotional.data || [],
      geoSignals: geo.data || [],
      marketSignals: verifiedEvidence.length ? verifiedEvidence : ((social.data || []).slice(0, 10)),
    });

    const response = await this.ai.generateDeepProductBrandAnalysis(prompt);
    const raw = response.parsedJson || {};
    const analysis = normalizeDeepBrandAnalysis(raw);

    await this.supabase.from('product_memory').update({
      brand_analysis: analysis,
      brand_analysis_updated_at: new Date().toISOString(),
    }).eq('id', product.id);

    await this.supabase.from('self_evolution_log').insert({
      agent: 'DEEP_PRODUCT_BRAND_ANALYSIS',
      cycle_date: new Date().toISOString(),
      source_performance: [],
      conversion_by_source: {},
      analysis: analysis.summary,
      adopted_sources: analysis.nextActions.map((item) => ({ source: 'brand_positioning', reason: item.reason, action: item.action, priority: item.priority })),
      scaled_back_sources: analysis.riskFlags.map((flag) => ({ source: 'brand_risk', reason: flag })),
      new_source_ideas: analysis.audienceSegments.map((segment) => ({ name: segment, description: segment, rationale: 'Audience pattern identified from live intelligence' })),
      overall_recommendation: analysis.nextActions[0]?.action || analysis.summary,
    });

    await this.supabase.from('agent_tasks').insert({
      user_id: userId,
      agent_type: 'DEEP_PRODUCT_ANALYSIS',
      task_type: 'BRAND_ANALYSIS',
      platform: 'internal',
      status: 'completed',
      scheduled_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      content: { product_name: productName, summary: analysis.summary },
      result: { analysis },
    });

    try {
      const { criticAgentService } = await import('./criticAgentService');
      criticAgentService.analyze({
        output: JSON.stringify(analysis),
        agentType: 'DEEP_PRODUCT_ANALYSIS',
        taskType: 'brand_analysis',
        userId,
        operation: 'deep_brand_analysis',
        platform: 'internal',
      });
    } catch {
      // Non-blocking; quality scoring should never stop the agent from learning.
    }

    try {
      const { adminBroadcast } = await import('../admin/adminRouter');
      adminBroadcast('deep_product_brand_analysis', {
        user_id: userId,
        product_id: product.id,
        product_name: productName,
        summary: analysis.summary,
        audienceSegments: analysis.audienceSegments,
        riskFlags: analysis.riskFlags,
        nextActions: analysis.nextActions,
        confidence: analysis.confidence,
        ts: new Date().toISOString(),
      });
    } catch {
      // admin SSE may not be available during some boot states; this should never block product learning.
    }

    console.log(`[DeepProductBrandAnalysis] Completed for ${productName}: ${analysis.summary}`);
    return analysis;
  }
}

export const deepProductBrandAnalysisAgent = new DeepProductBrandAnalysisAgent();
