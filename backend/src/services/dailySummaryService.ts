import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';

function normalizeSummaryStrategy(strategy: any, memory: any = null): any {
  const selectedAccounts = Array.isArray(strategy?.selected_accounts) && strategy.selected_accounts.length > 0
    ? strategy.selected_accounts
    : Array.isArray(strategy?.platforms) && strategy.platforms.length > 0
      ? strategy.platforms
      : memory?.platform_data?.platforms || [];

  return {
    ...(memory || {}),
    ...(strategy || {}),
    strategy_id: strategy?.strategy_id || strategy?.id || memory?.strategy_id,
    strategy_name: strategy?.strategy_name || strategy?.title || memory?.strategy_name || 'Active campaign',
    goal: strategy?.goal || memory?.goal || 'marketing',
    platforms: selectedAccounts,
    total_impressions: strategy?.total_impressions ?? memory?.total_impressions ?? 0,
    total_clicks: strategy?.total_clicks ?? memory?.total_clicks ?? 0,
    total_conversions: strategy?.total_conversions ?? memory?.total_conversions ?? 0,
    days_active: strategy?.days_active ?? memory?.days_active ?? 1,
  };
}

export class DailySummaryService {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async generateSummaryForStrategy(userId: string, strategy: any): Promise<void> {
    try {
      const strategyId = strategy?.strategy_id || strategy?.id;
      if (!strategyId) throw new Error('Strategy ID is missing.');

      const { data: memory, error: memoryError } = await this.supabase
        .from('strategy_memory')
        .select('strategy_id, strategy_name, goal, platform_data, total_impressions, total_clicks, total_conversions')
        .eq('strategy_id', strategyId)
        .eq('user_id', userId)
        .maybeSingle();
      if (memoryError) {
        console.warn(`[DailySummary] Could not load optional strategy memory for ${strategyId}: ${memoryError.message}`);
      }

      const summaryStrategy = normalizeSummaryStrategy(strategy, memory);
      console.log(`[DailySummary] Generating for strategy ${summaryStrategy.strategy_id}`);

      const today = new Date().toISOString().split('T')[0];

      const { data: existing } = await this.supabase
        .from('strategy_daily_reports')
        .select('id')
        .eq('strategy_id', summaryStrategy.strategy_id)
        .eq('report_date', today)
        .single();

      if (existing) {
        console.log(`[DailySummary] Report already exists for ${summaryStrategy.strategy_id} on ${today}`);
        return;
      }

      const { data: tasks } = await this.supabase
        .from('agent_tasks')
        .select('*')
        .eq('strategy_id', summaryStrategy.strategy_id)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      const { data: radarIntel } = await this.supabase
        .from('radar_intel')
        .select('*')
        .eq('strategy_id', summaryStrategy.strategy_id)
        .order('scanned_at', { ascending: false })
        .limit(3);

      const tasksCompleted = tasks?.filter(t => t.status === 'completed').length ?? 0;
      const tasksFailed = tasks?.filter(t => t.status === 'failed').length ?? 0;
      const tasksPending = tasks?.filter(t => t.status === 'pending').length ?? 0;

      const prompt = `
    You are Adirum AI's Daily Strategy Analyst. Generate a concise, truthful daily progress summary for the campaign owner.

STRATEGY:
- Name: ${summaryStrategy.strategy_name}
- Goal: ${summaryStrategy.goal}
- Platforms: ${JSON.stringify(summaryStrategy.platforms)}
- Total Impressions: ${summaryStrategy.total_impressions || 0}
- Total Clicks: ${summaryStrategy.total_clicks || 0}
- Total Conversions: ${summaryStrategy.total_conversions || 0}
- Days Active: ${summaryStrategy.days_active || 1}

LAST 24H AGENT ACTIVITY:
- Tasks completed: ${tasksCompleted}
- Tasks failed: ${tasksFailed}
- Tasks pending: ${tasksPending}
- Work completed: ${JSON.stringify((tasks || []).filter((t: any) => t.status === 'completed').map((t: any) => t.content?.headline || t.content?.body || t.task_type).slice(0, 10))}

RADAR INTEL (latest):
${JSON.stringify(radarIntel?.slice(0, 2) || [], null, 2)}

Generate a JSON summary:
{
  "headline": "One compelling headline about today's performance (max 80 chars)",
  "performance_score": 0-100,
  "highlights": ["up to 3 key wins or positive metrics from today"],
  "insights": ["up to 3 actionable insights based on data"],
  "next_actions": ["up to 3 things the AI will focus on tomorrow"],
  "push_title": "Short push notification title (max 50 chars)",
  "push_body": "Push notification body summarizing the day (max 120 chars)"
}

Be encouraging but honest. Focus on measurable progress and user-relevant outcomes. Never mention agents, AI systems, internal tools, prompts, orchestration, models, pipelines, task types, or implementation methods. Do not claim work that is not supported by the supplied data.
      `;

      const result = await this.ai.generateStrategy({}, prompt);
      const summary = result.parsedJson;

      if (!summary) throw new Error('AI did not return a valid summary.');

      await this.supabase.from('strategy_daily_reports').insert({
        user_id: userId,
        strategy_id: summaryStrategy.strategy_id,
        report_date: today,
        headline: summary.headline,
        performance_score: summary.performance_score,
        highlights: summary.highlights,
        insights: summary.insights,
        next_actions: summary.next_actions,
        tasks_completed: tasksCompleted,
        tasks_failed: tasksFailed,
        impressions_today: summaryStrategy.total_impressions || 0,
        clicks_today: summaryStrategy.total_clicks || 0,
        conversions_today: summaryStrategy.total_conversions || 0,
        raw_data: {
          strategy: summaryStrategy,
          tasks_sample: tasks?.slice(0, 10),
          radar: radarIntel?.slice(0, 1),
        },
      });

      await pushService.send(userId, {
        title: summary.push_title || `Daily report: ${summaryStrategy.strategy_name}`,
        body: summary.push_body || `Today's progress score: ${summary.performance_score}/100.`,
        data: {
          type: 'daily_report',
          strategy_id: summaryStrategy.strategy_id,
          report_date: today,
          score: summary.performance_score,
        },
        sound: 'default',
        channelId: 'reports',
      });

      console.log(`[DailySummary] Report generated and notification sent for ${summaryStrategy.strategy_id}`);
    } catch (e: any) {
      console.error(`[DailySummary] Failed for ${strategy?.strategy_id || strategy?.id || 'unknown strategy'}:`, e.message);
    }
  }

  async runDailyRound(): Promise<void> {
    console.log('[DailySummary] Running daily summary round...');

    try {
      const { data: activeStrategies, error } = await this.supabase
        .from('strategies')
        .select('id, user_id, title, goal, selected_accounts, platforms, created_at')
        .eq('is_active', true)
        .eq('status', 'active')
        .order('updated_at', { ascending: false });
      if (error) throw new Error(`Could not load active strategies: ${error.message}`);

      if (!activeStrategies?.length) {
        console.log('[DailySummary] No active strategies.');
        return;
      }

      for (const strategy of activeStrategies) {
        await this.generateSummaryForStrategy(strategy.user_id, strategy);
      }

      console.log(`[DailySummary] Round complete. Processed ${activeStrategies.length} strategies.`);
    } catch (e: any) {
      console.error('[DailySummary] Round error:', e.message);
    }
  }
}
