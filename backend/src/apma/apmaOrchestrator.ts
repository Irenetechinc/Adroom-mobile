import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaPerceptionService } from './apmaPerceptionService';
import { apmaDecisionService } from './apmaDecisionService';
import { apmaActionService } from './apmaActionService';
import { apmaHumanizerService } from './apmaHumanizerService';
import type { APMAClient, APMACampaign, ClientDashboardData } from './apmaTypes';

export class APMAOrchestrator {
  private ai = AIEngine.getInstance();
  private running = false;

  // ─── Main autonomous cycle (called by scheduler every 15 min) ────────────
  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const campaigns = await this._getActiveCampaigns();
      for (const { client, campaign } of campaigns) {
        await this._processCampaign(client, campaign).catch((err) =>
          console.error(`[APMA] Campaign ${campaign.id} error:`, err?.message),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async _processCampaign(client: APMAClient, campaign: APMACampaign): Promise<void> {
    // 1. Perception — gather political conversations
    const snapshot = await apmaPerceptionService.runPerceptionCycle(
      client.id, campaign.id, campaign.keywords, campaign.platforms,
    );

    // 2. Update live narrative score
    const score = await apmaPerceptionService.computeNarrativeScore(client.id, campaign.id, 24);
    await this._updateNarrativeScore(client.id, campaign.id, score);

    // 3. Record sentiment history
    const sb = getServiceSupabaseClient();
    await sb.from('apma_sentiment_history').insert({
      client_id: client.id,
      campaign_id: campaign.id,
      score,
      sample_size: snapshot.sample_size,
      dominant_topic: snapshot.dominant_topic,
    });

    // 4. Decision — only generate a new daily plan once per day
    const hasPlannedToday = await this._hasPlannedToday(campaign.id);
    if (!hasPlannedToday) {
      const plan = await apmaDecisionService.generateDailyPlan(client, campaign, snapshot);

      // 5. Action — execute the plan
      const strategy = await this._getLatestStrategy(campaign.id);
      if (strategy) {
        await apmaActionService.executePlan(client, campaign, plan, strategy.id);
      }
    } else {
      // Mid-cycle: execute any pending actions from today's existing strategy
      const strategy = await this._getPendingStrategy(campaign.id);
      if (strategy) {
        await apmaActionService.executePlan(client, campaign, strategy.plan, strategy.id);
      }
    }

    // 6. Self-improvement check (every 6 hours)
    await this._runSelfImprovementCheck(client, campaign, snapshot);

    // 7. Auto-implement non-sensitive recommendations
    await this._implementPendingRecommendations(client.id, campaign.id);
  }

  private async _runSelfImprovementCheck(
    client: APMAClient,
    campaign: APMACampaign,
    snapshot: any,
  ): Promise<void> {
    const sb = getServiceSupabaseClient();
    const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const { count } = await sb
      .from('apma_self_improvement_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sixHoursAgo);
    if ((count ?? 0) > 0) return;

    const prompt = `You are APMA's self-improvement module. Review the following performance snapshot and suggest ONE new tactical skill or optimisation.

Campaign sentiment: ${snapshot.overall_sentiment}
Top narratives: ${JSON.stringify(snapshot.top_narratives)}
Threat signals: ${snapshot.threat_signals.join(', ')}

Identify ONE specific improvement (e.g. "monitor YouTube comment sections for viral political videos", "create counter-narrative memes", "add Nairaland forum monitoring").

Return JSON: { skill_name, description, code_snippet (pseudocode), expected_performance_delta (0-1) }
Only JSON.`;

    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 600, temperature: 0.6 });
      const parsed = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
      await sb.from('apma_self_improvement_logs').insert({
        skill_name: parsed.skill_name || 'optimisation',
        description: parsed.description || '',
        code_snippet: parsed.code_snippet || null,
        performance_delta: parsed.expected_performance_delta ?? 0,
        deployed: false,
      });
    } catch {}
  }

  private async _implementPendingRecommendations(clientId: string, campaignId: string): Promise<void> {
    const sb = getServiceSupabaseClient();
    const { data: recs } = await sb
      .from('apma_recommendations')
      .select('*')
      .eq('client_id', clientId)
      .eq('campaign_id', campaignId)
      .eq('status', 'implementing')
      .eq('auto_implement', true);

    if (!recs?.length) return;

    for (const rec of recs) {
      await sb.from('apma_recommendations').update({
        status: 'done',
        implemented_at: new Date().toISOString(),
      }).eq('id', rec.id);
    }
  }

  // ─── Dashboard data for desktop client ───────────────────────────────────
  async getClientDashboard(clientId: string): Promise<ClientDashboardData | null> {
    const sb = getServiceSupabaseClient();

    const { data: client } = await sb.from('apma_clients').select('*').eq('id', clientId).single();
    if (!client) return null;

    const { data: campaign } = await sb
      .from('apma_campaigns')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!campaign) return null;

    const { data: sentimentHistory } = await sb
      .from('apma_sentiment_history')
      .select('score, recorded_at')
      .eq('campaign_id', campaign.id)
      .order('recorded_at', { ascending: true })
      .limit(168);

    const since24h = new Date(Date.now() - 86_400_000).toISOString();
    const { data: actions24h } = await sb
      .from('apma_actions')
      .select('action_type')
      .eq('campaign_id', campaign.id)
      .gte('executed_at', since24h);

    const actionCounts = { posts: 0, comments: 0, blog_articles: 0, group_engagements: 0 };
    for (const a of (actions24h ?? []) as any[]) {
      if (a.action_type === 'post') actionCounts.posts++;
      else if (['comment', 'reply'].includes(a.action_type)) actionCounts.comments++;
      else if (['blog_create', 'blog_article'].includes(a.action_type)) actionCounts.blog_articles++;
      else if (['group_create', 'group_post'].includes(a.action_type)) actionCounts.group_engagements++;
    }

    const { data: topThemesRaw } = await sb
      .from('political_conversations')
      .select('narrative_cluster, sentiment')
      .eq('campaign_id', campaign.id)
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString());

    const themeMap: Record<string, { total: number; count: number }> = {};
    for (const t of (topThemesRaw ?? []) as any[]) {
      const c = t.narrative_cluster ?? 'general';
      if (!themeMap[c]) themeMap[c] = { total: 0, count: 0 };
      themeMap[c].total += t.sentiment;
      themeMap[c].count++;
    }
    const topThemes = Object.entries(themeMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([theme, v]) => ({
        theme,
        sentiment: v.total / v.count >= 0 ? ('positive' as const) : ('negative' as const),
        volume: v.count,
      }));

    const { data: recs } = await sb
      .from('apma_recommendations')
      .select('id, text, priority, status, created_at')
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const currentScore = campaign.narrative_score_current ?? 0;
    const startScore   = campaign.narrative_score_start  ?? 0;

    return {
      client: { name: client.name, goal: client.goal, status: client.status },
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        start_date: campaign.start_date,
        narrative_score_current: currentScore,
        narrative_score_target: campaign.narrative_score_target,
        score_delta: parseFloat((currentScore - startScore).toFixed(4)),
      },
      sentiment_trend: (sentimentHistory ?? []).map((s: any) => ({
        date: s.recorded_at,
        score: s.score,
      })),
      top_themes: topThemes,
      actions_24h: {
        ...actionCounts,
        total: (actions24h?.length ?? 0),
      },
      recommendations: (recs ?? []) as any[],
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private async _getActiveCampaigns(): Promise<Array<{ client: APMAClient; campaign: APMACampaign }>> {
    const sb = getServiceSupabaseClient();
    const { data } = await sb
      .from('apma_campaigns')
      .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
      .eq('status', 'active');
    return (data ?? []).map((row: any) => ({
      client: row.apma_clients as APMAClient,
      campaign: { ...row, apma_clients: undefined } as APMACampaign,
    })).filter((r) => r.client);
  }

  private async _hasPlannedToday(campaignId: string): Promise<boolean> {
    const sb = getServiceSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const { count } = await sb
      .from('political_strategies')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('plan_date', today);
    return (count ?? 0) > 0;
  }

  private async _getLatestStrategy(campaignId: string): Promise<any | null> {
    const sb = getServiceSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const { data } = await sb
      .from('political_strategies')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('plan_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data ?? null;
  }

  private async _getPendingStrategy(campaignId: string): Promise<any | null> {
    const sb = getServiceSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const { data } = await sb
      .from('political_strategies')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('plan_date', today)
      .in('status', ['pending', 'executing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data ?? null;
  }

  private async _updateNarrativeScore(clientId: string, campaignId: string, score: number): Promise<void> {
    const sb = getServiceSupabaseClient();
    await sb.from('apma_campaigns').update({
      narrative_score_current: score,
      updated_at: new Date().toISOString(),
    }).eq('id', campaignId);
    await sb.from('apma_clients').update({
      narrative_score: score,
      updated_at: new Date().toISOString(),
    }).eq('id', clientId);
  }
}

export const apmaOrchestrator = new APMAOrchestrator();
