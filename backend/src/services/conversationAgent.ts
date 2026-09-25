import { Annotation, END, StateGraph } from '@langchain/langgraph';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';
import { agentReachAdapter, ReachResult } from './agentReachAdapter';
import { normalizeSelectedPlatforms } from './platformIdentity';

export type StrategyGoal = 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH';

export const GOAL_OUTCOMES: Record<StrategyGoal, { target: string; signal: string; action: string }> = {
  SALESMAN: { target: 'qualified conversations and conversions', signal: 'buying intent, requests for price, availability, or next steps', action: 'prioritize direct, helpful replies and sales follow-up' },
  AWARENESS: { target: 'relevant reach and brand conversation', signal: 'people discussing, sharing, or asking about the brand or category', action: 'prioritize useful public engagement and shareable responses' },
  PROMOTION: { target: 'offer engagement and timely action', signal: 'people asking about the offer, timing, price, or availability', action: 'prioritize clear offer replies and urgency without pressure' },
  LAUNCH: { target: 'launch discovery and early demand', signal: 'people reacting to the announcement, product, or launch topic', action: 'prioritize excitement-building replies and early-access conversations' },
};

type Signal = ReachResult & { strategyId: string; userId: string; goal: StrategyGoal; intentScore: number; status: 'identified' | 'high_potential' | 'engaged' };
type WorkflowState = { strategy: any; signals: Signal[]; identified: number; highPotential: number; engaged: number; routed: number };
const PERSONAL_PLATFORMS = new Set(['telegram', 'whatsapp_personal', 'signal_personal', 'bluesky', 'delta_chat']);

function signalRecipient(signal: Signal): string | undefined {
  const recipient = signal.metadata?.recipient || signal.authorId;
  if (!recipient || recipient === signal.externalId || recipient === signal.url) return undefined;
  return String(recipient).trim() || undefined;
}

interface OfferContext {
  name: string;
  brand: string;
  category: string;
  description: string;
  targetAudience: string;
  searchableTerms: string[];
}

function firstText(...values: unknown[]): string {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function normalizeOfferContext(raw: any): OfferContext {
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

  return { name, brand, category, description, targetAudience, searchableTerms };
}

function quoteSearchTerm(value: string): string {
  return `"${value.replace(/"/g, '').trim()}"`;
}

function demandQueries(context: OfferContext, goal: StrategyGoal): string[] {
  const anchor = context.name || context.brand || context.category;
  const identity = [context.brand, context.name].filter(Boolean).map(quoteSearchTerm).join(' ');
  const category = context.category ? quoteSearchTerm(context.category) : '';
  const audience = context.targetAudience ? quoteSearchTerm(context.targetAudience) : '';
  const intent = goal === 'PROMOTION'
    ? '(discount OR offer OR price OR available OR order OR buy)'
    : goal === 'LAUNCH'
      ? '(launch OR release OR "early access" OR available OR preorder)'
      : '(need OR "looking for" OR recommend OR "where can I find" OR "where can I buy" OR "can anyone suggest")';

  if (!anchor) return [];
  return Array.from(new Set([
    `${identity || quoteSearchTerm(anchor)} ${intent}`,
    `${quoteSearchTerm(anchor)} ("I need" OR "looking for" OR "can anyone recommend")`,
    `${quoteSearchTerm(anchor)} (price OR cost OR available OR order OR book OR hire)`,
    `${category || quoteSearchTerm(anchor)} ${audience} ("does anyone know" OR recommend OR "where can I find")`,
    `${quoteSearchTerm(anchor)} (question OR discussion OR forum OR comment OR review) ${intent}`,
  ].map((query) => query.replace(/\s+/g, ' ').trim()))).slice(0, 5);
}

function hasDemandLanguage(text: string): boolean {
  return /\b(i need|need a|need an|looking for|want to buy|where can i (buy|find|get)|can anyone (recommend|suggest)|does anyone know|recommend(ation)?|suggest(ion)?|how much|price|cost|available|order|book|hire|preorder|early access)\b/i.test(text);
}

const State = Annotation.Root({
  strategy: Annotation<any>,
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

function scoreSignal(text: string, goal: StrategyGoal, terms: string[]): number {
  const value = text.toLowerCase();
  const termHits = terms.filter((term) => term && value.includes(term.toLowerCase())).length;
  const demandTerms = [
    'i need', 'need a', 'need an', 'looking for', 'want to buy',
    'where can i', 'can anyone recommend', 'does anyone know',
    'recommend', 'suggest', 'price', 'cost', 'available', 'order',
    'book', 'hire', 'preorder', 'early access',
  ];
  const demandHits = demandTerms.filter((term) => value.includes(term)).length;
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
  private readonly runningStrategies = new Set<string>();
  private readonly graph = new StateGraph(State)
    .addNode('discover', async (state: WorkflowState) => {
      const strategy = state.strategy;
      console.log(`[ConversationAgent] discover start strategy=${strategy.id} goal=${strategy.goal}`);
      const goal = normalizeGoal(strategy.goal);
      const product = await this.resolveOfferContext(strategy);
      if (!product.name && !product.brand && !product.category) {
        console.warn(`[ConversationAgent] discover skipped strategy=${strategy.id}: no product, brand, or service context was found; strategy title is not used for discovery`);
        return { signals: [], identified: 0, highPotential: 0 };
      }

      const queries = demandQueries(product, goal);
      const selectedPlatforms = normalizeSelectedPlatforms(strategy.selected_accounts || strategy.platforms || []);
      console.log(`[ConversationAgent] demand discovery strategy=${strategy.id} offer=${product.name || product.brand || product.category} queries=${queries.length} platforms=${selectedPlatforms.join(',') || 'web'}`);
      const discovered = await Promise.all(
        queries.map((query) => agentReachAdapter.searchAcrossSources(query, selectedPlatforms)),
      );

      const results = discovered.flat();
      console.log(`[ConversationAgent] discover complete strategy=${strategy.id} results=${results.length}`);
      const signals = results
        .filter((item) => item.text.trim())
        .filter((item) => {
          const text = item.text.toLowerCase();
          const identityMatch = product.searchableTerms.some((term) => text.includes(term.toLowerCase()));
          return identityMatch && hasDemandLanguage(item.text);
        })
        .map((item) => {
          const intentScore = scoreSignal(item.text, goal, product.searchableTerms);
          return {
            ...item,
            strategyId: strategy.id,
            userId: strategy.user_id,
            goal,
            intentScore,
            status: intentScore >= 0.65 ? 'high_potential' : 'identified',
          } as Signal;
        });

      return { signals, identified: signals.length, highPotential: signals.filter((signal) => signal.status === 'high_potential').length };
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
          author_name: signal.authorName,
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
           platform_username: signal.authorName,
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
             author_name: signal.authorName,
             recipient,
             public_context: { platform: signal.platform, text: signal.text.slice(0, 2000), url: signal.url || null, kind: signal.kind },
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

  private async resolveOfferContext(strategy: any): Promise<OfferContext> {
    const embedded = normalizeOfferContext(strategy.product_memory);
    if ((embedded.name || embedded.brand || embedded.category) && !strategy.product_id) {
      return embedded;
    }

    if (!strategy.product_id) return embedded;

    const { data, error } = await this.supabase
      .from('product_memory')
      .select('product_id, product_name, brand, category, product_type, description, enhanced_description, target_audience')
      .eq('product_id', strategy.product_id)
      .eq('user_id', strategy.user_id)
      .maybeSingle();
    if (error) {
      console.warn(`[ConversationAgent] product context lookup failed strategy=${strategy.id} product=${strategy.product_id}: ${error.message}`);
      return embedded;
    }

    const resolved = normalizeOfferContext(data);
    return resolved.name || resolved.brand || resolved.category ? resolved : embedded;
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
      return await this.graph.invoke({ strategy, signals: [], identified: 0, highPotential: 0, engaged: 0, routed: 0 }) as any;
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
      return await this.graph.invoke({ strategy, signals: [], identified: 0, highPotential: 0, engaged: 0, routed: 0 }) as any;
    } finally {
      this.runningStrategies.delete(strategy.id);
    }
  }
}

export const conversationAgent = new ConversationAgent();
