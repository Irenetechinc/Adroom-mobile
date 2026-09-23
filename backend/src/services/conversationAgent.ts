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
const PERSONAL_PLATFORMS = new Set(['telegram', 'whatsapp_personal', 'signal_personal', 'delta_chat']);

function signalRecipient(signal: Signal): string | undefined {
  const recipient = signal.metadata?.recipient || signal.authorId;
  if (!recipient || recipient === signal.externalId || recipient === signal.url) return undefined;
  return String(recipient).trim() || undefined;
}

const State = Annotation.Root({
  strategy: Annotation<any>,
  signals: Annotation<Signal[]>({ reducer: (_, next) => next, default: () => [] }),
  identified: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  highPotential: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  engaged: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  routed: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
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
  const intentTerms = goal === 'SALESMAN' || goal === 'PROMOTION'
    ? ['price', 'cost', 'buy', 'available', 'order', 'discount', 'how much', 'where can']
    : goal === 'LAUNCH' ? ['launch', 'release', 'when', 'early access', 'available'] : ['recommend', 'looking for', 'best', 'share', 'love'];
  const intentHits = intentTerms.filter((term) => value.includes(term)).length;
  return Math.min(1, 0.25 + termHits * 0.15 + intentHits * 0.2);
}

export class ConversationAgent {
  private readonly supabase = getServiceSupabaseClient();
  private readonly graph = new StateGraph(State)
    .addNode('discover', async (state: WorkflowState) => {
      const strategy = state.strategy;
      console.log(`[ConversationAgent] discover start strategy=${strategy.id} goal=${strategy.goal}`);
      const goal = normalizeGoal(strategy.goal);
      const product = strategy.product_memory || {};
      const productName = product.name || strategy.title || 'product';
      const brandName = product.brand || product.name || strategy.title || 'brand';
      const serviceSummary = product.description || strategy.title || 'service';
      const terms = [productName, brandName, serviceSummary]
        .filter(Boolean).join(' ')
        .split(/[\s,]+/)
        .map((term: string) => term.trim())
        .filter((term: string) => term.length > 3)
        .slice(0, 16);

      const intentVariants = [
        `${productName} ${brandName} ${goal.toLowerCase()} people asking for product`,
        `${brandName} ${serviceSummary} reviews complaints needs`,
        `${productName} ${brandName} social mentions buying intent`,
        `${productName} ${brandName} people asking where to buy`,
        `${brandName} ${productName} needs service recommendation`,
      ];

       const selectedPlatforms = normalizeSelectedPlatforms(strategy.selected_accounts || strategy.platforms || []);
       const discovered = await Promise.all(
         intentVariants.map((query) => agentReachAdapter.searchAcrossSources(query, selectedPlatforms))
       );

      const results = discovered.flat();
      console.log(`[ConversationAgent] discover complete strategy=${strategy.id} results=${results.length}`);
      const signals = results.filter((item) => item.text.trim()).map((item) => {
        const intentScore = scoreSignal(item.text, goal, terms);
        return { ...item, strategyId: strategy.id, userId: strategy.user_id, goal, intentScore, status: intentScore >= 0.65 ? 'high_potential' : 'identified' } as Signal;
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
         const { data: leadRows } = await this.supabase
           .from('agent_leads')
           .upsert(leadPayloads, { onConflict: 'user_id,platform,platform_user_id' })
           .select('id, platform, platform_user_id');

         // Build a shared, privacy-scoped profile from the public signal and
         // any user-owned conversation evidence. Sales, psychology, messaging,
         // and tool agents can all consume the same lead_sales_profiles record.
         const { leadProfileBuilder } = await import('./leadProfileBuilder');
         await Promise.all((state.signals.filter((signal) => signal.status === 'high_potential')).map(async (signal) => {
           const recipient = signalRecipient(signal);
           const platformUserId = recipient || `discovery:${signal.externalId}`;
           const lead = (leadRows || []).find((row: any) =>
             row.platform === signal.platform && row.platform_user_id === platformUserId);
           if (lead?.id) {
             await leadProfileBuilder.buildForLead(signal.userId, lead.id).catch((error: any) => {
               console.warn(`[ConversationAgent] lead profile enrichment skipped: ${error.message}`);
               return null;
             });
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
        await this.supabase.from('agent_tasks').insert({
          strategy_id: signal.strategyId,
          user_id: signal.userId,
          agent_type: signal.goal,
          task_type: 'CONVERSATION_ENGAGE',
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

  async runForStrategy(strategy: any): Promise<{ identified: number; highPotential: number; engaged: number; routed: number }> {
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
    return this.graph.invoke({ strategy, signals: [], identified: 0, highPotential: 0, engaged: 0, routed: 0 }) as Promise<any>;
  }

  async runOnDemand(strategy: any): Promise<{ identified: number; highPotential: number; engaged: number; routed: number }> {
    return this.graph.invoke({ strategy, signals: [], identified: 0, highPotential: 0, engaged: 0, routed: 0 }) as Promise<any>;
  }
}

export const conversationAgent = new ConversationAgent();
