import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { agentReachAdapter } from './agentReachAdapter';

export interface CollectionRequest {
  strategyId?: string;
  strategyGoal?: string;
  productName?: string;
  category?: string;
  dataNeed?: string;
  audience?: string;
  marketContext?: string;
  userId?: string;
  sourceHints?: string[];
  platformHints?: string[];
  timeWindowHours?: number;
  requiredEvidence?: string[];
  extraContext?: Record<string, any>;
}

export interface CollectedEvidenceItem {
  title: string;
  source: string;
  snippet: string;
  url?: string;
  capturedAt: string;
  trustScore: number;
  kind?: string;
  metadata?: Record<string, any>;
}

export interface VerificationResult {
  verified: Array<CollectedEvidenceItem & { rank: number; verification: string; freshnessHours: number }>;
  rejected: Array<{ item: CollectedEvidenceItem; reason: string }>;
  summary: string;
  confidence: number;
}

export interface SharedResearchContext {
  summary: string;
  confidence: number;
  verified: Array<{
    title: string;
    source: string;
    snippet: string;
    url?: string;
    kind?: string;
    rank: number;
    freshnessHours: number;
  }>;
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

export function buildDynamicCollectionPrompt(request: CollectionRequest): string {
  const strategyId = request.strategyId || 'active_strategy';
  const productName = request.productName || 'this product';
  const category = request.category || 'general';
  const goal = request.strategyGoal || 'business growth';
  const dataNeed = request.dataNeed || 'recent market, user, and competitor signals';
  const marketContext = request.marketContext || 'current demand and audience behavior';
  const audience = request.audience || 'relevant target audience';
  const sourceHints = Array.isArray(request.sourceHints) && request.sourceHints.length
    ? request.sourceHints
    : ['web search', 'reddit', 'youtube', 'linkedin', 'forum', 'news', 'social'];

  return `You are the Adirum's Data Collection Agent. Your job is to gather the freshest, highest-signal evidence for the current strategy and return it in a format that can be consumed by any tool, engine, or agent without hardcoded assumptions.

This request is for strategy: ${strategyId}
Goal: ${goal}
Product: ${productName}
Category: ${category}
Audience: ${audience}
Data needed: ${dataNeed}
Market context: ${marketContext}
Preferred sources: ${sourceHints.join(', ')}

You must:
- Search for recent, relevant, real evidence available on the open web and public platforms.
- Prefer sources that are fresh, specific, and credible.
- Ignore stale or generic information unless it is the only evidence available.
- Focus on evidence that changes decisions, tactics, or content strategy.
- Suggest a ranked set of sources, with clear reasoning and freshness.

Return JSON only with this shape:
{
  "needs": [
    {
      "type": "pricing|reviews|pain_points|competition|market_shift|audience_signal|channel_signal",
      "query": "specific search query",
      "reason": "why this data matters to the strategy"
    }
  ],
  "sources": [
    {
      "name": "source name",
      "type": "search|social|news|review|reddit|youtube|linkedin|forum|market",
      "priority": "high|medium|low",
      "why": "why this source is useful and current"
    }
  ],
  "execution_plan": [
    {
      "step": 1,
      "action": "search or scrape the specific source group",
      "purpose": "what decision this supports"
    }
  ],
  "results": [
    {
      "title": "evidence title",
      "source": "publisher or platform",
      "snippet": "verbatim or closely bounded evidence",
      "url": "public source URL",
      "capturedAt": "ISO timestamp",
      "trustScore": 0.0,
      "kind": "search|social|news|review|reddit|youtube|linkedin|forum|market"
    }
  ]
}

Do not use any fixed template. Build the query strategy dynamically from the product, audience, and market condition.`;
}

export function rankAndVerifyCollectedData(
  items: CollectedEvidenceItem[],
  options: { maxAgeHours?: number; minTrust?: number } = {},
): VerificationResult {
  const maxAgeHours = options.maxAgeHours ?? 24;
  const minTrust = options.minTrust ?? 0.55;

  const verified: VerificationResult['verified'] = [];
  const rejected: VerificationResult['rejected'] = [];

  for (const item of items) {
    const capturedAt = new Date(item.capturedAt || new Date().toISOString()).getTime();
    const ageHours = (Date.now() - capturedAt) / (1000 * 60 * 60);
    const freshnessPenalty = ageHours > maxAgeHours ? Math.min(1, (ageHours - maxAgeHours) / 24) : 0;
    const trust = Number(item.trustScore ?? 0.5);
    const score = clamp((trust * 0.8) - freshnessPenalty * 0.6, 0, 1);

    if (score >= minTrust && ageHours <= maxAgeHours * 1.5) {
      verified.push({
        ...item,
        rank: Number((score * 100).toFixed(2)),
        verification: ageHours <= maxAgeHours ? 'fresh and relevant' : 'slightly aged but still within tolerance',
        freshnessHours: Number(ageHours.toFixed(2)),
      });
    } else {
      const reason = ageHours > maxAgeHours
        ? `stale evidence older than ${maxAgeHours} hours`
        : 'low trust or weak evidence quality';
      rejected.push({ item, reason });
    }
  }

  const sorted = verified.sort((a, b) => b.rank - a.rank);
  const confidence = sorted.length
    ? clamp(sorted.reduce((sum, item) => sum + item.rank, 0) / (sorted.length * 100), 0, 1)
    : 0;

  return {
    verified: sorted,
    rejected,
    summary: sorted.length
      ? `Verified ${sorted.length} fresh evidence points out of ${items.length} candidates.`
      : 'No fresh evidence met the verification threshold.',
    confidence,
  };
}

export class DataCollectionAgent {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient> | null;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = this.createSupabaseClient();
  }

  private createSupabaseClient() {
    try {
      return getServiceSupabaseClient();
    } catch (error: any) {
      console.warn('[DataCollectionAgent] Supabase not ready; collection service will operate in stateless mode.', error?.message || error);
      return null;
    }
  }

  async collectForStrategy(request: CollectionRequest): Promise<{ evidence: VerificationResult; raw?: any; generatedPrompt?: string }> {
    const prompt = buildDynamicCollectionPrompt(request);
    let data: any = {};
    let aiCollectionError: string | undefined;
    try {
      const response = await this.ai.generateStrategyEconomy({}, prompt);
      data = response.parsedJson || response.text || {};
    } catch (error: any) {
      aiCollectionError = error?.message || 'AI collection unavailable';
      console.warn(`[DataCollectionAgent] AI collection unavailable; using AgentReach web fallback: ${aiCollectionError}`);
    }

    let rawResults = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.evidence)
        ? data.evidence
        : [];
    let collectionSource = 'ai';

    // AgentReach is the credential-free public research path. It keeps
    // collection useful when the free AI provider is busy or returns a plan
    // without evidence, and gives downstream agents real URLs/snippets.
    if (!rawResults.length) {
      const product = request.productName || request.marketContext || 'current market';
      const audience = request.audience || 'target audience';
      const need = request.dataNeed || 'recent demand and market signals';
      const queries = Array.from(new Set([
        `${product} ${need} ${audience}`,
        `${product} customer demand reviews recommendations`,
        `${product} current competitors pricing audience discussion`,
      ])).slice(0, 3);
      const sources = Array.isArray(request.platformHints) ? request.platformHints : [];
      const reachResults = (await Promise.all(
        queries.map((query) => agentReachAdapter.searchAcrossSources(query, sources).catch((error: any) => {
          console.warn(`[DataCollectionAgent] AgentReach fallback query failed: ${error?.message || error}`);
          return [];
        })),
      )).flat();
      rawResults = reachResults.map((result) => ({
        title: result.authorName || `${result.platform} public signal`,
        source: result.platform || 'web',
        snippet: result.text,
        url: result.url,
        capturedAt: result.capturedAt,
        trustScore: result.platform === 'web' ? 0.72 : 0.68,
        kind: result.kind || 'search',
        metadata: {
          ...(result.metadata || {}),
          externalId: result.externalId,
          authorId: result.authorId,
          collectionQuery: queries.find((query) => result.text.toLowerCase().includes(product.toLowerCase())) || queries[0],
        },
      }));
      collectionSource = 'agent-reach';
    }
    const evidenceCandidates: CollectedEvidenceItem[] = rawResults.map((result: any) => ({
          title: String(result.title || 'Evidence item'),
          source: String(result.source || 'web'),
          snippet: String(result.snippet || result.summary || ''),
          url: result.url || undefined,
          capturedAt: result.capturedAt || new Date().toISOString(),
          trustScore: Number(result.trustScore ?? 0.7),
          kind: result.kind || 'search',
          metadata: result.metadata || {},
        }));

    const evidence = rankAndVerifyCollectedData(evidenceCandidates, {
      maxAgeHours: request.timeWindowHours || 24,
      minTrust: 0.55,
    });

    if (this.supabase && request.strategyId) {
      try {
        const sharedResearch: SharedResearchContext = {
          summary: evidence.summary,
          confidence: evidence.confidence,
          verified: evidence.verified.slice(0, 20).map((item) => ({
            title: item.title,
            source: item.source,
            snippet: item.snippet.slice(0, 1200),
            url: item.url,
            kind: item.kind,
            rank: item.rank,
            freshnessHours: item.freshnessHours,
          })),
        };

        await this.supabase.from('agent_tasks').insert({
          user_id: request.userId || null,
          agent_type: 'DATA_COLLECTION',
          task_type: 'WEB_RESEARCH',
          platform: 'internal',
          status: 'completed',
          scheduled_at: new Date().toISOString(),
          executed_at: new Date().toISOString(),
          content: { strategy_id: request.strategyId, request },
          result: { evidence, sharedResearch, prompt, collectionSource, aiCollectionError },
        });

        if (evidence.verified.length > 0) {
          await this.supabase.from('agent_data_collection_evidence').insert(
            evidence.verified.map((item, index) => ({
            strategy_id: request.strategyId,
            user_id: request.userId || null,
            source: item.source,
            source_type: item.kind || 'search',
            title: item.title,
            snippet: item.snippet,
            url: item.url || null,
            captured_at: item.capturedAt,
            trust_score: item.trustScore,
            is_verified: true,
            verification_reason: item.verification,
            freshness_hours: item.freshnessHours,
            metadata: { rank: item.rank, index, verification: item.verification },
            created_at: new Date().toISOString(),
            }))
          );
        }

        // Keep fresh, sanitized research beside the active execution plan so
        // psychology, messaging, creative, and publishing agents can consume
        // the same evidence without re-running an independent search.
        const { data: strategyRow } = await this.supabase
          .from('strategies')
          .select('current_execution_plan')
          .eq('id', request.strategyId)
          .eq('user_id', request.userId || '')
          .maybeSingle();
        const currentPlan = strategyRow?.current_execution_plan || {};
        await this.supabase.from('strategies').update({
          current_execution_plan: {
            ...currentPlan,
            shared_research: {
              ...sharedResearch,
              updated_at: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        }).eq('id', request.strategyId);
      } catch {
        // Non-blocking: collection must never break agent execution.
      }
    }

    return { evidence, raw: data, generatedPrompt: prompt };
  }

  async collectForAgentTool(request: CollectionRequest): Promise<VerificationResult> {
    return (await this.collectForStrategy(request)).evidence;
  }
}

export const dataCollectionAgent = new DataCollectionAgent();
