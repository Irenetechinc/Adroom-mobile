import { Annotation, END, StateGraph } from '@langchain/langgraph';
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';
import { agentReachAdapter, normalizePublicAuthorName, ReachResult } from './agentReachAdapter';
import { normalizeSelectedPlatforms } from './platformIdentity';

export type StrategyGoal = 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';

export const GOAL_OUTCOMES: Record<StrategyGoal, { target: string; signal: string; action: string }> = {
  SALESMAN: { target: 'qualified conversations and conversions', signal: 'buying intent, requests for price, availability, or next steps', action: 'prioritize direct, helpful replies and sales follow-up' },
  AWARENESS: { target: 'relevant reach and brand conversation', signal: 'people discussing, sharing, or asking about the brand or category', action: 'prioritize useful public engagement and shareable responses' },
  PROMOTION: { target: 'offer engagement and timely action', signal: 'people asking about the offer, timing, price, or availability', action: 'prioritize clear offer replies and urgency without pressure' },
  LAUNCH: { target: 'launch discovery and early demand', signal: 'people reacting to the announcement, product, or launch topic', action: 'prioritize excitement-building replies and early-access conversations' },
};

type Signal = ReachResult & { strategyId: string; userId: string; goal: StrategyGoal; intentScore: number; status: 'identified' | 'high_potential' | 'engaged' };
type WorkflowState = { strategy: any; product: OfferContext; signals: Signal[]; identified: number; highPotential: number; engaged: number; routed: number };
const PERSONAL_PLATFORMS = new Set(['telegram', 'whatsapp_personal', 'signal_personal', 'bluesky', 'delta_chat']);

function signalRecipient(signal: Signal): string | undefined {
  const recipient = signal.metadata?.recipient || signal.authorId;
  if (!recipient || recipient === signal.externalId || recipient === signal.url) return undefined;
  return String(recipient).trim() || undefined;
}

export interface OfferContext {
  name: string;
  brand: string;
  category: string;
  description: string;
  targetAudience: string;
  imageUrls: string[];
  searchableTerms: string[];
}

function firstText(...values: unknown[]): string {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function normalizeImageUrls(source: any): string[] {
  const values = [
    ...(Array.isArray(source?.images) ? source.images : []),
    source?.image_url,
    source?.imageUrl,
  ];
  return Array.from(new Set(values
    .map((value) => typeof value === 'object' ? value?.url || value?.uri : value)
    .map((value) => String(value || '').trim())
    .filter((value) => /^https?:\/\//i.test(value)))).slice(0, 5);
}

export function normalizeOfferContext(raw: any): OfferContext {
  const source = Array.isArray(raw) ? raw[0] || {} : raw || {};
  const name = firstText(source.name, source.product_name, source.productName, source.service_name, source.serviceName);
  const brand = firstText(source.brand, source.brand_name, source.brandName);
  const category = firstText(source.category, source.product_type, source.service_type);
  const description = firstText(source.description, source.enhanced_description, source.enhancedDescription);
  const targetAudience = firstText(source.target_audience, source.targetAudience);
  const searchableTerms = Array.from(new Set(
    [name, brand, category, targetAudience, description]
      .join(' ')
      .split(/[\s,.;:!?/()[\]{}]+/)
      .map((term) => term.replace(/^["'`]+|["'`]+$/g, '').trim())
      .filter((term) => term.length >= 4
        && !/^(this|that|with|from|your|their|about|product|service|brand)$/i.test(term)),
  )).slice(0, 24);

  return { name, brand, category, description, targetAudience, imageUrls: normalizeImageUrls(source), searchableTerms };
}

/**
 * Product context can be embedded in a strategy as well as loaded from
 * product_memory.  Prefer the fullest value when those two snapshots
 * disagree; a one-character stale database value must never replace a real
 * offer identity that is still present in the strategy.
 */
export function mergeOfferContexts(...contexts: OfferContext[]): OfferContext {
  const longest = (field: keyof Pick<OfferContext, 'name' | 'brand' | 'category' | 'description' | 'targetAudience'>): string =>
    contexts
      .map((context) => String(context?.[field] || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || '';
  const merged = {
    name: longest('name'),
    brand: longest('brand'),
    category: longest('category'),
    description: longest('description'),
    targetAudience: longest('targetAudience'),
    imageUrls: Array.from(new Set(contexts.flatMap((context) => context?.imageUrls || []))).slice(0, 5),
  };
  return normalizeOfferContext(merged);
}

function quoteSearchTerm(value: string): string {
  return `"${value.replace(/"/g, '').trim()}"`;
}

export interface DiscoveryQueryPlan {
  queries: string[];
  demandTerms: string[];
  exclusions: string[];
}

const GENERIC_DEMAND_TERMS = [
  'need', 'looking for', 'want to buy', 'where can i find', 'where can i buy',
  'recommend', 'suggest', 'how much', 'price', 'cost', 'available', 'order',
  'book', 'hire', 'preorder', 'early access',
];

function safeSearchValue(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d/i.test(text)) return '';
  return text.slice(0, maxLength);
}

export function normalizeDiscoveryQueryPlan(raw: any, context: OfferContext): DiscoveryQueryPlan {
  const rawQueries = Array.isArray(raw?.queries)
    ? raw.queries.map((value: unknown) => safeSearchValue(value, 280)).filter(Boolean)
    : [];
  // A one-character name is not a meaningful identity anchor and commonly
  // indicates an upstream truncation.  Do not let it make a query such as
  // `"L"` appear anchored merely because it occurs in another word.
  const identityAnchors = [context.name, context.brand, context.category]
    .filter((value) => value.trim().length > 1)
    .map((value) => value.toLowerCase())
    .filter(Boolean);
  const primaryAnchor = [context.name, context.brand, context.category]
    .find((value) => value.trim().length > 1) || '';
  const queries = rawQueries
    .map((query: string) => {
      if (!primaryAnchor || identityAnchors.some((anchor) => query.toLowerCase().includes(anchor))) {
        return query;
      }
      const prefix = quoteSearchTerm(primaryAnchor);
      const suffix = safeSearchValue(query, Math.max(0, 280 - prefix.length - 1));
      // Keep the complete identity even when the model returns an unusually
      // long query.  The demand suffix is the part that may be shortened.
      return suffix ? `${prefix} ${suffix}` : prefix;
    })
    .filter(Boolean);
  const demandTerms = Array.isArray(raw?.demandTerms)
    ? raw.demandTerms.map((value: unknown) => safeSearchValue(value, 100).toLowerCase()).filter((value: string) => value.length >= 3)
    : [];
  const exclusions = Array.isArray(raw?.exclusions)
    ? raw.exclusions.map((value: unknown) => safeSearchValue(value, 100).toLowerCase()).filter((value: string) => value.length >= 3)
    : [];
  const anchor = [context.name, context.brand, context.category]
    .find((value) => value.trim().length > 1) || '';
  const fallbackQueries = anchor ? [quoteSearchTerm(anchor)] : [];
  return {
    queries: Array.from(new Set<string>(queries)).slice(0, 5).concat(
      queries.length ? [] : fallbackQueries,
    ),
    demandTerms: Array.from(new Set<string>(demandTerms)).slice(0, 24),
    exclusions: Array.from(new Set<string>(exclusions)).slice(0, 16),
  };
}

function hasDemandLanguage(text: string, demandTerms: string[] = []): boolean {
  const value = text.toLowerCase();
  const terms = demandTerms.length ? demandTerms : GENERIC_DEMAND_TERMS;
  return terms.some((term) => value.includes(term.toLowerCase()));
}

function resultKey(item: ReachResult): string {
  return [
    item.platform,
    item.externalId,
    item.url,
    item.text.slice(0, 240),
  ].map((value) => String(value || '').trim().toLowerCase()).join('|');
}

/**
 * Search providers often return a useful title/snippet that omits the exact
 * product term or the demand phrase used in the query. Do not turn that
 * provider formatting difference into a zero-result campaign.
 *
 * We prefer results passing both checks, then results passing either check.
 * If the provider omitted both from every snippet, the query itself is still
 * offer-anchored, so retain the bounded result set for later scoring and
 * enrichment rather than silently discarding it.
 */
export function selectConversationResults(results: ReachResult[], product: OfferContext, demandTerms: string[] = []): {
  results: ReachResult[];
  strict: number;
  relaxed: number;
  fallback: boolean;
} {
  const unique = Array.from(new Map(
    results
      .filter((item) => String(item.text || '').trim().length > 12)
      .map((item) => [resultKey(item), item]),
  ).values());
  const strict: ReachResult[] = [];
  const relaxed: ReachResult[] = [];

  for (const item of unique) {
    const text = item.text.toLowerCase();
    const identityMatch = product.searchableTerms.some((term) => text.includes(term.toLowerCase()));
    const demandMatch = hasDemandLanguage(item.text, demandTerms);
    if (identityMatch && demandMatch) strict.push(item);
    else if (identityMatch || demandMatch) relaxed.push(item);
  }

  if (strict.length) return { results: strict, strict: strict.length, relaxed: relaxed.length, fallback: false };
  if (relaxed.length) return { results: relaxed, strict: 0, relaxed: relaxed.length, fallback: true };
  return { results: unique.slice(0, 24), strict: 0, relaxed: 0, fallback: unique.length > 0 };
}

const State = Annotation.Root({
  strategy: Annotation<any>,
  product: Annotation<OfferContext>({
    reducer: (_: OfferContext, next: OfferContext) => next,
    default: () => normalizeOfferContext({}),
  }),
  signals: Annotation<Signal[]>({ reducer: (_: Signal[], next: Signal[]) => next, default: () => [] }),
  identified: Annotation<number>({ reducer: (_: number, next: number) => next, default: () => 0 }),
  highPotential: Annotation<number>({ reducer: (_: number, next: number) => next, default: () => 0 }),
  engaged: Annotation<number>({ reducer: (_: number, next: number) => next, default: () => 0 }),
  routed: Annotation<number>({ reducer: (_: number, next: number) => next, default: () => 0 }),
});

function normalizeGoal(goal: string): StrategyGoal {
  const value = String(goal || '').toLowerCase();
  if (value.includes('sale') || value.includes('conversion') || value.includes('lead')) return 'SALESMAN';
  if (value.includes('promotion') || value.includes('offer') || value.includes('discount')) return 'PROMOTION';
  if (value.includes('launch')) return 'LAUNCH';
  return 'AWARENESS';
}

function scoreSignal(text: string, goal: StrategyGoal, terms: string[], demandTerms: string[] = []): number {
  const value = text.toLowerCase();
  const termHits = terms.filter((term) => term && value.includes(term.toLowerCase())).length;
  const activeDemandTerms = demandTerms.length ? demandTerms : GENERIC_DEMAND_TERMS;
  const demandHits = activeDemandTerms.filter((term) => value.includes(term.toLowerCase())).length;
  const goalTerms = goal === 'PROMOTION'
    ? ['discount', 'offer', 'deal']
    : goal === 'LAUNCH'
      ? ['launch', 'release', 'early access', 'preorder']
      : goal === 'SALESMAN'
        ? ['buy', 'order', 'price', 'cost', 'available']
        : ['best', 'recommend', 'share', 'love'];
  const goalHits = goalTerms.filter((term) => value.includes(term)).length;
  return Math.min(1, 0.1 + Math.min(termHits, 3) * 0.2 + Math.min(demandHits, 3) * 0.2 + Math.min(goalHits, 2) * 0.1);
}

export class ConversationAgent {
  private readonly supabase = getServiceSupabaseClient();
  private readonly ai = AIEngine.getInstance();
  private readonly runningStrategies = new Set<string>();
  private readonly graph = new StateGraph(State)
    .addNode('discover', async (state: WorkflowState) => {
      const strategy = state.strategy;
      console.log(`[ConversationAgent] discover start strategy=${strategy.id} goal=${strategy.goal}`);
      const goal = normalizeGoal(strategy.goal);
      const product = await this.resolveOfferContext(strategy);
      if (!product.name && !product.brand && !product.category) {
        console.warn(`[ConversationAgent] discover skipped strategy=${strategy.id}: no product, brand, or service context was found; strategy title is not used for discovery`);
        return { product, signals: [], identified: 0, highPotential: 0 };
      }

      const plan = await this.buildDiscoveryQueryPlan(product, goal);
      const selectedPlatforms = normalizeSelectedPlatforms(strategy.selected_accounts || strategy.platforms || []);
      console.log(`[ConversationAgent] demand discovery strategy=${strategy.id} offer=${product.name || product.brand || product.category} queries=${plan.queries.length} platforms=${selectedPlatforms.join(',') || 'web'}`);
      const discovered = await Promise.all(
        plan.queries.map((query) => agentReachAdapter.searchAcrossSources(query, selectedPlatforms)),
      );

      const results = discovered.flat();
      console.log(`[ConversationAgent] discover complete strategy=${strategy.id} results=${results.length}`);
      const selected = selectConversationResults(results, product, plan.demandTerms);
      if (selected.fallback) {
        console.warn(
          `[ConversationAgent] relaxed result matching strategy=${strategy.id} strict=${selected.strict} ` +
          `relaxed=${selected.relaxed} retained=${selected.results.length}`,
        );
      } else {
        console.log(`[ConversationAgent] strict result matching strategy=${strategy.id} retained=${selected.results.length}`);
      }
      const signals = selected.results
        .map((item) => {
          const intentScore = scoreSignal(item.text, goal, product.searchableTerms, plan.demandTerms);
          return {
            ...item,
            strategyId: strategy.id,
            userId: strategy.user_id,
            goal,
            intentScore,
            status: intentScore >= 0.65 ? 'high_potential' : 'identified',
          } as Signal;
        });

      return { product, signals, identified: signals.length, highPotential: signals.filter((signal) => signal.status === 'high_potential').length };
    })
    .addNode('persist', async (state: WorkflowState) => {
      console.log(`[ConversationAgent] persist strategy=${state.strategy.id} signals=${state.signals.length}`);
      if (state.signals.length) {
        await this.supabase.from('strategy_conversation_signals').upsert(state.signals.map((signal) => ({
          strategy_id: signal.strategyId,
          user_id: signal.userId,
          goal: signal.goal,
          platform: signal.platform,
          external_id: signal.externalId,
          author_name: normalizePublicAuthorName(signal.authorName) || null,
          author_id: signal.authorId || null,
          text: signal.text.slice(0, 4000),
          url: signal.url || null,
          kind: signal.kind,
          intent_score: signal.intentScore,
          status: signal.status,
          captured_at: signal.capturedAt,
          metadata: signal.metadata || {},
          updated_at: new Date().toISOString(),
        })), { onConflict: 'strategy_id,platform,external_id' });

         // Keep the user-facing lead list in sync with discovery. Only public
         // identity and the public interaction preview are persisted here.
         // Personal channels are never treated as reachable unless discovery
         // produced a real platform recipient, not a search-result URL.
         const leadPayloads = state.signals.map((signal) => {
           const recipient = signalRecipient(signal);
           return {
           strategy_id: signal.strategyId,
           user_id: signal.userId,
           platform: signal.platform,
           platform_user_id: recipient || `discovery:${signal.externalId}`,
            platform_username: normalizePublicAuthorName(signal.authorName) || null,
           first_interaction: signal.text.slice(0, 1000),
           intent_score: signal.intentScore,
           intent_signals: [{ source: signal.kind, url: signal.url || null, recipient: recipient || null, contact_ready: !PERSONAL_PLATFORMS.has(signal.platform) || Boolean(recipient) }],
           stage: signal.status === 'high_potential' ? 'identified' : 'identified',
           };
         });
         const { data: leadRows, error: leadUpsertError } = await this.supabase
           .from('agent_leads')
           .upsert(leadPayloads, { onConflict: 'user_id,platform,platform_user_id' })
           .select('id, platform, platform_user_id');
         if (leadUpsertError) {
           throw new Error(`lead persistence failed: ${leadUpsertError.message}`);
         }

          // Queue a shared, privacy-scoped profile enrichment pass from the
          // public signal and any user-owned conversation evidence. The queue
          // write is deliberately fast: tool execution belongs to the
          // backend worker and must never block conversation discovery.
          const { leadProfileBuilder } = await import('./leadProfileBuilder');
          await Promise.all(state.signals.map(async (signal) => {
           const recipient = signalRecipient(signal);
           const platformUserId = recipient || `discovery:${signal.externalId}`;
           const lead = (leadRows || []).find((row: any) =>
             row.platform === signal.platform && row.platform_user_id === platformUserId);
             if (lead?.id) {
              try {
                 await leadProfileBuilder.enqueueForLead(signal.userId, lead.id);
                 console.log(`[ConversationAgent] lead profile queued lead=${lead.id}`);
              } catch (error: any) {
                const message = error instanceof Error
                  ? error.message
                  : typeof error === 'string'
                    ? error
                    : JSON.stringify(error) || 'unknown error';
                 console.warn(`[ConversationAgent] lead profile queue skipped lead=${lead.id}: ${message}`);
              }
            } else {
               console.warn(`[ConversationAgent] lead profile queue skipped platform=${signal.platform} external=${signal.externalId}: lead row was not returned`);
           }
         }));
      }
      return {};
    })
    .addNode('route', async (state: WorkflowState) => {
      const selectedPlatforms = normalizeSelectedPlatforms(state.strategy.selected_accounts || state.strategy.platforms || []);
      // Web is a discovery fallback, not an outbound channel. Only create
      // engagement tasks for a platform the user selected for this strategy.
      const topSignals = state.signals
        .filter((signal) => signal.status === 'high_potential')
        .filter((signal) => !selectedPlatforms.length || selectedPlatforms.includes(signal.platform))
         .filter((signal) => !PERSONAL_PLATFORMS.has(signal.platform) || Boolean(signalRecipient(signal)))
        .slice(0, 5);
      for (const signal of topSignals) {
         const recipient = signalRecipient(signal);
         const platformUserId = recipient || `discovery:${signal.externalId}`;
         const { data: lead } = await this.supabase
           .from('agent_leads')
           .select('id')
           .eq('user_id', signal.userId)
           .eq('platform', signal.platform)
           .eq('platform_user_id', platformUserId)
           .maybeSingle();
         const { data: sharedProfile } = lead?.id
           ? await this.supabase.from('lead_sales_profiles').select('profile').eq('user_id', signal.userId).eq('lead_id', lead.id).maybeSingle()
           : { data: null };
         const isPersonal = PERSONAL_PLATFORMS.has(signal.platform);
         await this.supabase.from('agent_tasks').insert({
          strategy_id: signal.strategyId,
          user_id: signal.userId,
          agent_type: signal.goal,
           // Personal channels are explicit recipient actions. Public
           // channels retain the conversation-engagement task contract.
           task_type: isPersonal ? 'SEND_PERSONAL_MESSAGE' : 'CONVERSATION_ENGAGE',
          action_type: isPersonal ? 'send_personal_message' : 'public_engagement',
          selected_account_id: signal.platform,
          recipient_id: recipient || null,
          conversation_id: signal.metadata?.conversation_id || null,
          media: null,
          platform: signal.platform,
          scheduled_at: new Date().toISOString(),
          status: 'pending',
           content: {
             signal_id: signal.externalId,
             lead_id: lead?.id || null,
              author_name: normalizePublicAuthorName(signal.authorName) || null,
             recipient,
              public_context: { platform: signal.platform, text: signal.text.slice(0, 2000), url: signal.url || null, kind: signal.kind },
              product_context: {
                name: state.product.name || null,
                brand: state.product.brand || null,
                category: state.product.category || null,
                description: state.product.description || null,
                target_audience: state.product.targetAudience || null,
                image_urls: state.product.imageUrls,
              },
             lead_profile: sharedProfile?.profile || null,
             share_with: ['psychology', 'messaging', 'tools', 'salesman'],
             text: signal.text,
             url: signal.url,
             goal: signal.goal,
             action_type: isPersonal ? 'send_personal_message' : 'public_engagement',
              provider: signal.platform,
              selected_account: signal.platform,
              conversation_id: signal.metadata?.conversation_id || null,
              media: null,
           },
        });
      }
      console.log(`[ConversationAgent] route strategy=${state.strategy.id} routed=${topSignals.length}`);
      return { routed: topSignals.length, engaged: topSignals.length };
    })
    .addNode('notify', async (state: WorkflowState) => {
      const { data: previous } = await this.supabase.from('strategy_conversation_runs').select('identified, high_potential, engaged').eq('strategy_id', state.strategy.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const engaged = Math.min(state.routed || 0, state.highPotential || 0);
      const changed = !previous || previous.identified !== state.identified || previous.high_potential !== state.highPotential || previous.engaged !== engaged;
      if (changed && (state.identified > 0 || state.highPotential > 0)) {
        await pushService.notifyConversationMilestone(state.strategy.user_id, {
          strategyId: state.strategy.id,
          strategyTitle: state.strategy.title || 'Active strategy',
          identified: state.identified,
          highPotential: state.highPotential,
          engaged,
          goal: state.strategy.goal,
        });
      }
      await this.supabase.from('strategy_conversation_runs').insert({ strategy_id: state.strategy.id, user_id: state.strategy.user_id, identified: state.identified, high_potential: state.highPotential, engaged, routed: state.routed, goal: state.strategy.goal });
      console.log(`[ConversationAgent] notify strategy=${state.strategy.id} changed=${changed} identified=${state.identified} highPotential=${state.highPotential} engaged=${engaged}`);
      return {};
    })
    .addEdge('__start__', 'discover')
    .addEdge('discover', 'persist')
    .addEdge('persist', 'route')
    .addEdge('route', 'notify')
    .addEdge('notify', END)
    .compile();

  private async buildDiscoveryQueryPlan(context: OfferContext, goal: StrategyGoal): Promise<DiscoveryQueryPlan> {
    const prompt = `Build a public conversation discovery plan for the actual offer below.

Search for public discussions where people express a need, ask for recommendations,
compare options, ask about price or availability, or show another natural buying
signal related to this offer. The wording can vary by audience, platform, language,
and category; do not rely on a fixed phrase or query template.

Return JSON only:
{
  "queries": ["up to five concise web/social search queries"],
  "demandTerms": ["phrases or short terms that indicate a relevant need or buying discussion"],
  "exclusions": ["terms that clearly describe unrelated intent"]
}

Rules:
- Anchor every query to the actual offer identity. Never use a campaign or strategy title.
- Use the full product/service name, brand, category, audience, and description when useful.
- The image URLs are context for identifying the offer; never put an image URL in a search query.
- Do not output personal data, credentials, contact details, or recipient identifiers.
- Prefer varied natural-language demand expressions over generic marketing terms.

OFFER CONTEXT:
${JSON.stringify({
  name: context.name,
  brand: context.brand,
  category: context.category,
  description: context.description,
  targetAudience: context.targetAudience,
  imageUrls: context.imageUrls,
})}
GOAL: ${goal}`;

    try {
      const response = await this.ai.generateJson(prompt);
      const plan = normalizeDiscoveryQueryPlan(response, context);
      if (plan.queries.length) return plan;
    } catch (error: any) {
      console.warn(`[ConversationAgent] dynamic discovery query generation failed: ${error.message}`);
    }
    return normalizeDiscoveryQueryPlan(null, context);
  }

  private async resolveOfferContext(strategy: any): Promise<OfferContext> {
    const embedded = normalizeOfferContext(strategy.product_memory);
    if ((embedded.name || embedded.brand || embedded.category) && !strategy.product_id) {
      return embedded;
    }

    if (!strategy.product_id) return embedded;

    const { data, error } = await this.supabase
      .from('product_memory')
      .select('product_id, product_name, brand, category, product_type, description, enhanced_description, target_audience, images')
      .eq('product_id', strategy.product_id)
      .eq('user_id', strategy.user_id)
      .maybeSingle();
    if (error) {
      console.warn(`[ConversationAgent] product context lookup failed strategy=${strategy.id} product=${strategy.product_id}: ${error.message}`);
      return embedded;
    }

    const resolved = normalizeOfferContext(data);
    return mergeOfferContexts(embedded, resolved);
  }

  async runForStrategy(strategy: any): Promise<{ identified: number; highPotential: number; engaged: number; routed: number }> {
    if (this.runningStrategies.has(strategy.id)) {
      console.log(`[ConversationAgent] sweep already running strategy=${strategy.id}; skipping concurrent request`);
      return { identified: 0, highPotential: 0, engaged: 0, routed: 0 };
    }
    const { data: latest } = await this.supabase
      .from('strategy_conversation_runs')
      .select('created_at')
      .eq('strategy_id', strategy.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.created_at && Date.now() - new Date(latest.created_at).getTime() < 24 * 60 * 60 * 1000) {
      console.log(`[ConversationAgent] daily sweep already completed strategy=${strategy.id}; skipping duplicate search`);
      return { identified: 0, highPotential: 0, engaged: 0, routed: 0 };
    }
    this.runningStrategies.add(strategy.id);
    try {
      return await this.graph.invoke({ strategy, product: normalizeOfferContext({}), signals: [], identified: 0, highPotential: 0, engaged: 0, routed: 0 }) as any;
    } finally {
      this.runningStrategies.delete(strategy.id);
    }
  }

  async runOnDemand(strategy: any): Promise<{ identified: number; highPotential: number; engaged: number; routed: number }> {
    if (this.runningStrategies.has(strategy.id)) {
      return { identified: 0, highPotential: 0, engaged: 0, routed: 0 };
    }
    this.runningStrategies.add(strategy.id);
    try {
      return await this.graph.invoke({ strategy, product: normalizeOfferContext({}), signals: [], identified: 0, highPotential: 0, engaged: 0, routed: 0 }) as any;
    } finally {
      this.runningStrategies.delete(strategy.id);
    }
  }
}

export const conversationAgent = new ConversationAgent();
