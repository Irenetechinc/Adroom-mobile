import { SupabaseClient } from '@supabase/supabase-js';
import { SalesmanAgent } from './salesmanAgent';
import { AwarenessAgent } from './awarenessAgent';
import { PromotionAgent } from './promotionAgent';
import { LaunchAgent } from './launchAgent';
import { getServiceSupabaseClient } from '../config/supabase';
import { creditManagementAgent } from '../services/creditManagementAgent';
import { energyService } from '../services/energyService';

type GoalType = 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH' | string;

const GOAL_MAP: Record<string, 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH'> = {
    sales: 'SALESMAN',
    salesman: 'SALESMAN',
    conversion: 'SALESMAN',
    awareness: 'AWARENESS',
    reach: 'AWARENESS',
    brand: 'AWARENESS',
    promotion: 'PROMOTION',
    promotional: 'PROMOTION',
    offer: 'PROMOTION',
    discount: 'PROMOTION',
    launch: 'LAUNCH',
    product_launch: 'LAUNCH',
    new_product: 'LAUNCH'
};

function resolveGoal(goal: string): 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH' {
    const normalized = (goal || '').toLowerCase().trim().replace(/\s+/g, '_');
    return GOAL_MAP[normalized] || 'AWARENESS';
}

export class AgentOrchestrator {
    private supabase: SupabaseClient;

    constructor(supabase?: SupabaseClient) {
        this.supabase = supabase || getServiceSupabaseClient();
    }

    private getAgent(agentType: 'SALESMAN' | 'AWARENESS' | 'PROMOTION' | 'LAUNCH') {
        switch (agentType) {
            case 'SALESMAN': return new SalesmanAgent(this.supabase);
            case 'AWARENESS': return new AwarenessAgent(this.supabase);
            case 'PROMOTION': return new PromotionAgent(this.supabase);
            case 'LAUNCH': return new LaunchAgent(this.supabase);
        }
    }

    /**
     * ACTIVATE: Called once when user approves a strategy.
     * Resolves which specialized agent to use and generates full execution plan.
     */
    async activateAgent(params: {
        strategyId: string;
        userId: string;
        goal: string;
        platforms: string[];
        strategy: any;
    }): Promise<{
        agentType: string;
        tasksScheduled: number;
        activatedAt: string;
    }> {
        const agentType = resolveGoal(params.goal);
        const agent = this.getAgent(agentType);

        console.log(`[Orchestrator] Activating ${agentType} agent for strategy ${params.strategyId}`);

        // Fetch product details for planning
        const productId = params.strategy?.product_id;
        let product = null;
        if (productId) {
            const { data } = await this.supabase
                .from('product_memory')
                .select('*')
                .eq('product_id', productId)
                .single();
            product = data;
        }

        // Fall back to strategy content if no product memory
        if (!product) {
            const { data } = await this.supabase
                .from('product_memory')
                .select('*')
                .eq('user_id', params.userId)
                .order('last_scraped_at', { ascending: false })
                .limit(1)
                .single();
            product = data;
        }

        const durationDays = params.strategy?.duration || 30;

        await agent.plan({
            strategyId: params.strategyId,
            userId: params.userId,
            strategy: params.strategy,
            product,
            platforms: params.platforms,
            durationDays
        });

        // Count scheduled tasks
        const { count } = await this.supabase
            .from('agent_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('strategy_id', params.strategyId);

        const tasksScheduled = count || 0;
        const activatedAt = new Date().toISOString();

        // Record in goal_progress
        await this.supabase.from('goal_progress').upsert({
            strategy_id: params.strategyId,
            user_id: params.userId,
            goal: params.goal,
            agent_type: agentType,
            status: 'active',
            activated_at: activatedAt,
            execution_plan: { tasks_scheduled: tasksScheduled },
            success_metrics: params.strategy?.estimated_outcomes || {}
        }, { onConflict: 'strategy_id' });

        console.log(`[Orchestrator] ${agentType} activated — ${tasksScheduled} tasks scheduled`);

        return { agentType, tasksScheduled, activatedAt };
    }

    /**
     * EXECUTE DUE TASKS: Scheduler calls this every 5 minutes.
     * Finds tasks due now and executes them with the right agent.
     */
    async executeDueTasks(): Promise<{ executed: number; failed: number }> {
        const now = new Date().toISOString();

        const { data: dueTasks, error } = await this.supabase
            .from('agent_tasks')
            .select('id, agent_type, strategy_id, user_id, task_type, platform')
            .eq('status', 'pending')
            .lte('scheduled_at', now)
            .neq('task_type', 'LEAD_SCAN')       // Lead scans handled separately
            .neq('task_type', 'PERFORMANCE_CHECK')
            .neq('task_type', 'GMAPS_OUTREACH')  // Google Maps outreach handled by executeSpecialTasks
            .order('scheduled_at', { ascending: true })
            .limit(20); // Process max 20 tasks per cycle

        if (error) {
            console.error('[Orchestrator] Error fetching due tasks:', error.message);
            return { executed: 0, failed: 0 };
        }

        if (!dueTasks?.length) return { executed: 0, failed: 0 };

        console.log(`[Orchestrator] Processing ${dueTasks.length} due tasks`);

        let executed = 0;
        let failed = 0;

        for (const task of dueTasks) {
            try {
                // CMA pre-check for this user's autonomous task
                const cma = await creditManagementAgent.evaluate(task.user_id, 'agent_task');
                if (cma.decision === 'deny_cap') {
                    console.log(`[Orchestrator] Task ${task.id} skipped — daily cap reached for user ${task.user_id}`);
                    await this.supabase.from('agent_tasks').update({ status: 'skipped', error_message: cma.reason }).eq('id', task.id);
                    continue;
                }
                // Check user balance
                const account = await energyService.getAccount(task.user_id);
                const balance = parseFloat(account?.balance_credits ?? '0');
                if (balance < cma.credits) {
                    console.log(`[Orchestrator] Task ${task.id} skipped — insufficient credits for user ${task.user_id}`);
                    await this.supabase.from('agent_tasks').update({ status: 'skipped', error_message: 'Insufficient credits' }).eq('id', task.id);
                    continue;
                }

                const agent = this.getAgent(task.agent_type as any);
                await agent.executeTask(task.id);

                // Deduct agent_task credit after successful execution
                await energyService.deductEnergyWithRouting(task.user_id, 'agent_task', {
                    task_id: task.id,
                    platform: task.platform,
                    agent_type: task.agent_type,
                }).catch((e: any) => console.error(`[Orchestrator] Energy deduction failed for task ${task.id}:`, e.message));

                executed++;
            } catch (err: any) {
                console.error(`[Orchestrator] Task ${task.id} execution error: ${err.message}`);
                failed++;
            }
        }

        console.log(`[Orchestrator] Cycle complete — ${executed} executed, ${failed} failed`);
        return { executed, failed };
    }

    /**
     * EXECUTE SPECIAL TASKS: Lead scans, performance checks, etc.
     */
    async executeSpecialTasks(): Promise<void> {
        const now = new Date().toISOString();

        const { data: tasks } = await this.supabase
            .from('agent_tasks')
            .select('*')
            .eq('status', 'pending')
            .in('task_type', ['LEAD_SCAN', 'PERFORMANCE_CHECK', 'GMAPS_OUTREACH'])
            .lte('scheduled_at', now)
            .limit(10);

        for (const task of tasks || []) {
            await this.supabase.from('agent_tasks').update({ status: 'executing' }).eq('id', task.id);

            try {
                if (task.task_type === 'LEAD_SCAN' && task.agent_type === 'SALESMAN') {
                    const agent = new SalesmanAgent(this.supabase);
                    const tokens = await agent.getTokens(task.user_id);
                    await agent.scanForLeads({
                        strategyId: task.strategy_id,
                        userId: task.user_id,
                        platform: task.platform,
                        postId: task.content?.post_id,
                        tokens
                    });
                    await agent.followUpLeads(task.user_id);
                }

                // GMAPS_OUTREACH is owned by SalesmanAgent regardless of which agent
                // scheduled it (AWARENESS, PROMOTION, LAUNCH all use the same outreach engine).
                if (task.task_type === 'GMAPS_OUTREACH') {
                    const salesAgent = new SalesmanAgent(this.supabase);
                    const c = task.content || {};
                    const result = await salesAgent.discoverAndOutreachLocalBusinesses({
                        userId: task.user_id,
                        strategyId: task.strategy_id,
                        location: c.location || '',
                        targetCategory: c.keyword || 'local business',
                        outreachChannel: c.outreach_channel || 'whatsapp',
                        senderName: c.sender_name || 'the team',
                        productOrService: c.product_or_service || c.keyword || 'our service',
                        maxTargets: 10,
                    });
                    console.log(`[Orchestrator] GMAPS_OUTREACH task ${task.id} — ${result.reached} businesses reached (strategy: ${task.strategy_id})`);
                }

                await this.supabase.from('agent_tasks').update({
                    status: 'done',
                    executed_at: now
                }).eq('id', task.id);

            } catch (err: any) {
                await this.supabase.from('agent_tasks').update({
                    status: 'failed',
                    error_message: err.message
                }).eq('id', task.id);
            }
        }
    }

    /**
     * MONITOR PERFORMANCE: Runs every hour.
     * Fetches real metrics from platforms for recently published posts.
     */
    async monitorPerformance(): Promise<void> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data: doneTasks } = await this.supabase
            .from('agent_tasks')
            .select('id, user_id, strategy_id, agent_type, platform, result')
            .eq('status', 'done')
            .gte('executed_at', oneDayAgo)
            .not('result->platform_post_id', 'is', null);

        for (const task of doneTasks || []) {
            const platformPostId = task.result?.platform_post_id;
            if (!platformPostId) continue;

            try {
                const agent = this.getAgent(task.agent_type as any);
                const tokens = await agent.getTokens(task.user_id);

                let metrics: Record<string, number> = {};
                if (task.platform === 'facebook' && tokens.facebook) {
                    metrics = await agent.fetchFacebookPostMetrics(platformPostId, tokens.facebook.access_token);
                }

                if (Object.keys(metrics).length > 0) {
                    await agent.recordPerformance({
                        strategyId: task.strategy_id,
                        userId: task.user_id,
                        taskId: task.id,
                        platform: task.platform,
                        platformPostId,
                        metrics
                    });
                }
            } catch (err: any) {
                console.error(`[Orchestrator] Performance monitoring error for task ${task.id}: ${err.message}`);
            }
        }
    }

    /**
     * OPTIMIZE ALL ACTIVE STRATEGIES: Runs every 2 hours.
     * Each agent checks its performance and self-adjusts.
     */
    async optimizeActiveStrategies(): Promise<void> {
        const { data: activeStrategies } = await this.supabase
            .from('strategies')
            .select('id, user_id, goal, agent_type')
            .eq('is_active', true);

        console.log(`[Orchestrator] Optimizing ${activeStrategies?.length || 0} active strategies`);

        for (const strategy of activeStrategies || []) {
            try {
                const agentType = (strategy.agent_type as any) || resolveGoal(strategy.goal);
                const agent = this.getAgent(agentType);
                await agent.optimizeStrategy(strategy.id, strategy.user_id);
            } catch (err: any) {
                console.error(`[Orchestrator] Optimization error for strategy ${strategy.id}: ${err.message}`);
            }
        }
    }

    /**
     * STATUS: Get current agent status for a strategy
     */
    async getAgentStatus(strategyId: string): Promise<{
        agentType: string;
        tasksTotal: number;
        tasksDone: number;
        tasksPending: number;
        tasksFailed: number;
        paidEquivalentUsd: number;
        totalReach: number;
        lastActivity: string | null;
        interventions: number;
    }> {
        const [tasksResult, perfResult, interventionsResult] = await Promise.all([
            this.supabase
                .from('agent_tasks')
                .select('id, status')
                .eq('strategy_id', strategyId),
            this.supabase
                .from('agent_performance')
                .select('reach, paid_equivalent_usd')
                .eq('strategy_id', strategyId),
            this.supabase
                .from('agent_interventions')
                .select('id', { count: 'exact', head: true })
                .eq('strategy_id', strategyId)
        ]);

        const tasks = tasksResult.data || [];
        const perf = perfResult.data || [];

        const { data: strategy } = await this.supabase
            .from('strategies')
            .select('agent_type, updated_at')
            .eq('id', strategyId)
            .single();

        return {
            agentType: strategy?.agent_type || 'UNKNOWN',
            tasksTotal: tasks.length,
            tasksDone: tasks.filter(t => t.status === 'done').length,
            tasksPending: tasks.filter(t => t.status === 'pending').length,
            tasksFailed: tasks.filter(t => t.status === 'failed').length,
            totalReach: perf.reduce((sum, p) => sum + (p.reach || 0), 0),
            paidEquivalentUsd: perf.reduce((sum, p) => sum + (p.paid_equivalent_usd || 0), 0),
            lastActivity: strategy?.updated_at || null,
            interventions: interventionsResult.count || 0
        };
    }
}
