import { AgentOrchestrator } from '../agents/agentOrchestrator';
import { getServiceSupabaseClient } from '../config/supabase';

type CycleResult = { executed: number; failed: number };

/** Stable control surface for scheduler-owned agent loops. */
export class AgentSupervisor {
    private readonly orchestrator: AgentOrchestrator;
    private readonly supabase = getServiceSupabaseClient();

    constructor(orchestrator = new AgentOrchestrator()) {
        this.orchestrator = orchestrator;
    }

    private async run<T>(operation: string, work: () => Promise<T>): Promise<T> {
        const startedAt = Date.now();
        try {
            const result = await work();
            await this.log(operation, 'completed', Date.now() - startedAt, result);
            return result;
        } catch (error: any) {
            await this.log(operation, 'failed', Date.now() - startedAt, { error: error.message });
            throw error;
        }
    }

    private async log(operation: string, status: string, durationMs: number, details: any): Promise<void> {
        try {
            await this.supabase.from('agent_supervisor_runs').insert({
                operation,
                status,
                duration_ms: durationMs,
                details: details || {},
            });
        } catch (error: any) {
            console.error(`[AgentSupervisor] Failed to log ${operation}:`, error.message);
        }
    }

    activateAgent(params: Parameters<AgentOrchestrator['activateAgent']>[0]) {
        return this.run('activate_agent', () => this.orchestrator.activateAgent(params));
    }

    executeDueTasks(): Promise<CycleResult> {
        return this.run('execute_due_tasks', () => this.orchestrator.executeDueTasks());
    }

    executeSpecialTasks(): Promise<void> {
        return this.run('execute_special_tasks', () => this.orchestrator.executeSpecialTasks());
    }

    monitorPerformance(): Promise<void> {
        return this.run('monitor_performance', () => this.orchestrator.monitorPerformance());
    }

    optimizeActiveStrategies(): Promise<void> {
        return this.run('optimize_active_strategies', () => this.orchestrator.optimizeActiveStrategies());
    }

    getAgentStatus(strategyId: string) {
        return this.orchestrator.getAgentStatus(strategyId);
    }
}

export const agentSupervisor = new AgentSupervisor();