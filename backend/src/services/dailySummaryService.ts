import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';

export class DailySummaryService {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async generateSummaryForStrategy(userId: string, strategy: any): Promise<void> {
    console.log(`[DailySummary] Generating for strategy ${strategy.strategy_id}`);

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data: existing } = await this.supabase
        .from('strategy_daily_reports')
        .select('id')
        .eq('strategy_id', strategy.strategy_id)
        .eq('report_date', today)
        .single();

      if (existing) {
        console.log(`[DailySummary] Report already exists for ${strategy.strategy_id} on ${today}`);
        return;
      }

      const { data: tasks } = await this.supabase
        .from('agent_tasks')
        .select('*')
        .eq('strategy_id', strategy.strategy_id)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      const { data: radarIntel } = await this.supabase
        .from('radar_intel')
        .select('*')
        .eq('strategy_id', strategy.strategy_id)
        .order('scanned_at', { ascending: false })
        .limit(3);

      const tasksCompleted = tasks?.filter(t => t.status === 'completed').length ?? 0;
      const tasksFailed = tasks?.filter(t => t.status === 'failed').length ?? 0;
      const tasksPending = tasks?.filter(t => t.status === 'pending').length ?? 0;

      const prompt = `
You are AdRoom AI's Daily Strategy Analyst. Generate a concise, insightful daily performance summary.

STRATEGY:
- Name: ${strategy.strategy_name}
- Goal: ${strategy.goal}
- Platforms: ${JSON.stringify(strategy.platforms)}
- Total Impressions: ${strategy.total_impressions || 0}
- Total Clicks: ${strategy.total_clicks || 0}
- Total Conversions: ${strategy.total_conversions || 0}
- Days Active: ${strategy.days_active || 1}

LAST 24H AGENT ACTIVITY:
- Tasks completed: ${tasksCompleted}
- Tasks failed: ${tasksFailed}
- Tasks pending: ${tasksPending}
- Task types: ${JSON.stringify([...new Set(tasks?.map((t: any) => t.agent_type) || [])])}

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

Be encouraging but honest. Focus on what matters most for the user's goal.
      `;

      const result = await this.ai.generateStrategy({}, prompt);
      const summary = result.parsedJson;

      if (!summary) throw new Error('AI did not return a valid summary.');

      await this.supabase.from('strategy_daily_reports').insert({
        user_id: userId,
        strategy_id: strategy.strategy_id,
        report_date: today,
        headline: summary.headline,
        performance_score: summary.performance_score,
        highlights: summary.highlights,
        insights: summary.insights,
        next_actions: summary.next_actions,
        tasks_completed: tasksCompleted,
        tasks_failed: tasksFailed,
        impressions_today: strategy.total_impressions || 0,
        clicks_today: strategy.total_clicks || 0,
        conversions_today: strategy.total_conversions || 0,
        raw_data: {
          strategy,
          tasks_sample: tasks?.slice(0, 10),
          radar: radarIntel?.slice(0, 1),
        },
      });

      await pushService.send(userId, {
        title: summary.push_title || `Daily Report: ${strategy.strategy_name}`,
        body: summary.push_body || `Score: ${summary.performance_score}/100 · ${tasksCompleted} tasks done today`,
        data: {
          type: 'daily_report',
          strategy_id: strategy.strategy_id,
          report_date: today,
          score: summary.performance_score,
        },
        sound: 'default',
        channelId: 'reports',
      });

      console.log(`[DailySummary] Report generated and notification sent for ${strategy.strategy_id}`);
    } catch (e: any) {
      console.error(`[DailySummary] Failed for ${strategy.strategy_id}:`, e.message);
    }
  }

  async runDailyRound(): Promise<void> {
    console.log('[DailySummary] Running daily summary round...');

    try {
      const { data: activeStrategies } = await this.supabase
        .from('strategy_memory')
        .select('*')
        .eq('status', 'active');

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
