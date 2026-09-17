import { getServiceSupabaseClient } from '../config/supabase';
import { conversationAgent } from './conversationAgent';
import { dataCollectionAgent } from './dataCollectionAgent';
import { AgentOrchestrator } from '../agents/agentOrchestrator';

const MIN_CONVERSATION_GAP_MS = 5 * 60 * 1000;
const MIN_COLLECTION_GAP_MS = 20 * 60 * 1000;
const MIN_OPTIMIZATION_GAP_MS = 2 * 60 * 60 * 1000;

function ageMs(value?: string | null): number {
  return value ? Math.max(0, Date.now() - new Date(value).getTime()) : Number.POSITIVE_INFINITY;
}

function normalizePlatforms(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((platform) => String(platform || '').trim().toLowerCase())
    .filter(Boolean)));
}

/**
 * Coordinates existing agents and engines around active strategies.
 * This service decides when collaboration is useful; it does not publish or
 * bypass the orchestrator's claims, critic gates, energy checks, or schedules.
 */
export class StrategyCoordinator {
  private readonly supabase = getServiceSupabaseClient();
  private readonly orchestrator = new AgentOrchestrator(this.supabase);
  private running = new Set<string>();

  async runCycle(): Promise<{ inspected: number; collaborated: number; skipped: number }> {
    const { data: strategies, error } = await this.supabase
      .from('strategies')
      .select('id, user_id, title, goal, agent_type, platforms, selected_accounts, product_id, product_memory(name, category, description)')
      .eq('is_active', true)
      .eq('status', 'active')
      .limit(50);

    if (error) throw new Error(`Strategy coordination query failed: ${error.message}`);

    let collaborated = 0;
    let skipped = 0;
    for (const strategy of strategies || []) {
      if (this.running.has(strategy.id)) {
        skipped++;
        continue;
      }
      this.running.add(strategy.id);
      try {
        const result = await this.coordinate(strategy);
        if (result) collaborated++;
      } catch (error: any) {
        console.error(`[StrategyCoordinator] strategy=${strategy.id} failed: ${error.message}`);
        await this.log(strategy.id, strategy.user_id, 'failed', { error: error.message });
      } finally {
        this.running.delete(strategy.id);
      }
    }

    console.log(`[StrategyCoordinator] cycle complete inspected=${strategies?.length || 0} collaborated=${collaborated} skipped=${skipped}`);
    return { inspected: strategies?.length || 0, collaborated, skipped };
  }

  private async coordinate(strategy: any): Promise<boolean> {
    const [conversation, collection, activity, performance] = await Promise.all([
      this.supabase.from('strategy_conversation_runs').select('created_at, identified, high_potential, engaged').eq('strategy_id', strategy.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      this.supabase.from('agent_tasks').select('created_at').eq('strategy_id', strategy.id).eq('agent_type', 'DATA_COLLECTION').eq('task_type', 'WEB_RESEARCH').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      this.supabase.from('agent_tasks').select('status, task_type, created_at, executed_at, error_message').eq('strategy_id', strategy.id).order('created_at', { ascending: false }).limit(30),
      this.supabase.from('agent_performance').select('reach, likes, comments, shares, fetched_at').eq('strategy_id', strategy.id).order('fetched_at', { ascending: false }).limit(10),
    ]);

    const tasks = activity.data || [];
    const failures = tasks.filter((task: any) => task.status === 'failed').length;
    const pending = tasks.filter((task: any) => ['pending', 'executing', 'scheduled'].includes(task.status)).length;
    const product = Array.isArray(strategy.product_memory) ? strategy.product_memory[0] || {} : strategy.product_memory || {};
    const platforms = normalizePlatforms(strategy.selected_accounts || strategy.platforms);
    const actions: string[] = [];

    if (ageMs(conversation.data?.created_at) >= MIN_CONVERSATION_GAP_MS) {
      const result = await conversationAgent.runForStrategy(strategy);
      actions.push(`conversation:${result.identified}/${result.highPotential}/${result.engaged}`);
    }

    if (ageMs(collection.data?.created_at) >= MIN_COLLECTION_GAP_MS) {
      const result = await dataCollectionAgent.collectForStrategy({
        strategyId: strategy.id,
        userId: strategy.user_id,
        strategyGoal: strategy.goal || 'active strategy improvement',
        productName: product.name || strategy.title || 'active product',
        category: product.category || 'general',
        dataNeed: failures > 0 ? 'fresh evidence to diagnose failed agent work and improve the active strategy' : 'fresh market and audience evidence for the active strategy',
        audience: 'current target audience',
        marketContext: product.description || strategy.title || 'active strategy',
        sourceHints: platforms.length ? platforms : ['search', 'social', 'news'],
        timeWindowHours: 24,
      });
      actions.push(`evidence:${result.evidence.verified.length}`);
    }

    if (failures >= 2 && ageMs(tasks.find((task: any) => task.task_type === 'OPTIMIZATION')?.created_at) >= MIN_OPTIMIZATION_GAP_MS) {
      const agentType = strategy.agent_type || 'AWARENESS';
      const agent = this.orchestrator.getAgentForCoordination(agentType);
      await agent.optimizeStrategy(strategy.id, strategy.user_id);
      actions.push(`optimization:failures=${failures}`);
    }

    if (!actions.length && pending === 0 && (performance.data || []).length === 0) {
      console.log(`[StrategyCoordinator] strategy=${strategy.id} stable but awaiting first measurable result`);
    }

    if (actions.length) {
      console.log(`[StrategyCoordinator] strategy=${strategy.id} collaborated ${actions.join(' | ')}`);
      await this.log(strategy.id, strategy.user_id, 'completed', { actions, failures, pending, performanceRows: performance.data?.length || 0 });
      return true;
    }
    return false;
  }

  private async log(strategyId: string, userId: string, status: string, details: Record<string, any>): Promise<void> {
    await this.supabase.from('agent_supervisor_runs').insert({
      operation: 'strategy_coordination',
      status,
      duration_ms: 0,
      details: { strategy_id: strategyId, user_id: userId, ...details },
    });
  }
}

export const strategyCoordinator = new StrategyCoordinator();
