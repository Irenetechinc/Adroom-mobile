import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaPerceptionService } from './apmaPerceptionService';
import { apmaDecisionService } from './apmaDecisionService';
import { apmaActionService } from './apmaActionService';
import { broadcast } from '../events/sseBroadcast';
import type { APMAClient, APMACampaign, ClientDashboardData } from './apmaTypes';

function apmaBroadcast(step: string, campaignId: string, data: Record<string, unknown>) {
  broadcast('apma_cycle', { step, campaign_id: campaignId, ts: new Date().toISOString(), ...data });
}

export class APMAOrchestrator {
  private ai = AIEngine.getInstance();
  private running = false;

  // ─── Main autonomous cycle (called by scheduler every 15 min) ────────────
  async runCycle(): Promise<void> {
    if (this.running) {
      console.log('[APMA] Cycle already running — skipping');
      return;
    }
    this.running = true;
    try {
      const campaigns = await this._getActiveCampaigns();
      if (!campaigns.length) {
        console.log('[APMA] No active campaigns — cycle skipped');
        return;
      }
      console.log(`[APMA] Processing ${campaigns.length} active campaign(s)...`);
      for (const { client, campaign } of campaigns) {
        await this._processCampaign(client, campaign).catch((err) =>
          console.error(`[APMA] Campaign ${campaign.id} (${campaign.name}) error:`, err?.message),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async _processCampaign(client: APMAClient, campaign: APMACampaign): Promise<void> {
    const cid = campaign.id;
    console.log(`[APMA] Processing: ${client.name} — ${campaign.name} (${client.country})`);
    apmaBroadcast('start', cid, { client: client.name, campaign: campaign.name, country: client.country });

    // 1. Perception — gather political sentiment from the internet
    apmaBroadcast('perception_start', cid, { keywords: campaign.keywords });
    const snapshot = await apmaPerceptionService.runPerceptionCycle(
      client.id,
      campaign.id,
      campaign.keywords,
      campaign.platforms,
      client.country,
    );
    console.log(`[APMA] Perception: ${snapshot.sample_size} conversations, sentiment ${snapshot.overall_sentiment.toFixed(3)}`);
    apmaBroadcast('perception_done', cid, {
      sample_size: snapshot.sample_size,
      overall_sentiment: snapshot.overall_sentiment,
      dominant_topic: snapshot.dominant_topic,
      threats: snapshot.threat_signals.slice(0, 3),
      opportunities: snapshot.opportunity_signals.slice(0, 3),
    });

    // 2. Update live narrative score
    const score = await apmaPerceptionService.computeNarrativeScore(client.id, campaign.id, 24);
    await this._updateNarrativeScore(client.id, campaign.id, score);
    apmaBroadcast('score_updated', cid, { narrative_score: score, target: campaign.narrative_score_target });

    // 3. Record sentiment history
    const sb = getServiceSupabaseClient();
    await sb.from('apma_sentiment_history').insert({
      client_id: client.id,
      campaign_id: campaign.id,
      score,
      sample_size: snapshot.sample_size,
      dominant_topic: snapshot.dominant_topic,
    });

    // 4. Decision — generate daily plan once per day, then execute
    const hasPlannedToday = await this._hasPlannedToday(campaign.id);

    if (!hasPlannedToday) {
      console.log('[APMA] Generating daily plan...');
      apmaBroadcast('decision_start', cid, { message: 'Generating daily plan...' });
      const plan = await apmaDecisionService.generateDailyPlan(client, campaign, snapshot);
      apmaBroadcast('decision_done', cid, {
        objective: plan.objective,
        action_batches: plan.actions.length,
        blog_tasks: plan.blog_tasks?.length ?? 0,
        group_tasks: plan.group_tasks?.length ?? 0,
      });

      const strategy = await this._getLatestStrategy(campaign.id);
      if (strategy) {
        console.log(`[APMA] Executing plan: ${plan.actions.length} action batches`);
        apmaBroadcast('action_start', cid, { strategy_id: strategy.id, total_actions: plan.actions.reduce((s, a) => s + a.count, 0) });
        const { executed, failed } = await apmaActionService.executePlan(client, campaign, plan, strategy.id);
        console.log(`[APMA] Execution complete: ${executed} succeeded, ${failed} failed`);
        apmaBroadcast('action_done', cid, { executed, failed });
      }
    } else {
      // Mid-cycle: resume any pending actions
      const pending = await this._getPendingStrategy(campaign.id);
      if (pending && pending.actions_done < pending.actions_total) {
        console.log('[APMA] Resuming pending strategy...');
        apmaBroadcast('action_resume', cid, { actions_done: pending.actions_done, actions_total: pending.actions_total });
        const { executed, failed } = await apmaActionService.executePlan(client, campaign, pending.plan, pending.id);
        apmaBroadcast('action_done', cid, { executed, failed });
      }
    }

    // 5. Self-improvement (every 6 hours)
    await this._runSelfImprovementCheck(client, campaign, snapshot);

    // 6. Auto-implement non-sensitive recommendations
    await this._implementPendingRecommendations(client.id, campaign.id);

    apmaBroadcast('cycle_complete', cid, { narrative_score: score });
  }

  private async _runSelfImprovementCheck(client: APMAClient, campaign: APMACampaign, snapshot: any): Promise<void> {
    const sb = getServiceSupabaseClient();
    const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const { count } = await sb
      .from('apma_self_improvement_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sixHoursAgo);
    if ((count ?? 0) > 0) return;

    const prompt = `You are APMA's self-improvement module. Review this performance and suggest ONE new tactical skill.

Country: ${client.country}
Campaign sentiment: ${snapshot.overall_sentiment.toFixed(3)}
Top narratives: ${JSON.stringify(snapshot.top_narratives.slice(0, 3))}
Threat signals: ${snapshot.threat_signals.join(', ') || 'none'}

Suggest ONE specific, implementable improvement relevant to political marketing in ${client.country}.
Return JSON: { "skill_name": "", "description": "", "code_snippet": "<pseudocode>", "expected_performance_delta": 0.05 }
Only JSON.`;

    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 500, temperature: 0.6 });
      const parsed = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
      await sb.from('apma_self_improvement_logs').insert({
        skill_name: parsed.skill_name || 'general_optimisation',
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
      .select('id, veto_deadline')
      .eq('client_id', clientId)
      .eq('campaign_id', campaignId)
      .eq('status', 'implementing')
      .eq('auto_implement', true);

    if (!recs?.length) return;

    for (const rec of recs as any[]) {
      // If veto window still open, skip
      if (rec.veto_deadline && new Date(rec.veto_deadline) > new Date()) continue;
      await sb.from('apma_recommendations').update({
        status: 'done',
        implemented_at: new Date().toISOString(),
      }).eq('id', rec.id);
    }
  }

  // ─── Client dashboard data for desktop app ─────────────────────────────
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

    const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const since24h = new Date(Date.now() - 86_400_000).toISOString();

    const [sentimentHistory, actions24h, topThemesRaw, recs] = await Promise.all([
      sb.from('apma_sentiment_history').select('score, recorded_at').eq('campaign_id', campaign.id).order('recorded_at', { ascending: true }).limit(168),
      sb.from('apma_actions').select('action_type').eq('campaign_id', campaign.id).gte('executed_at', since24h),
      sb.from('political_conversations').select('narrative_cluster, sentiment').eq('campaign_id', campaign.id).gte('created_at', since7d),
      sb.from('apma_recommendations').select('id, text, priority, status, created_at').eq('campaign_id', campaign.id).order('created_at', { ascending: false }).limit(10),
    ]);

    const actionCounts = { posts: 0, comments: 0, blog_articles: 0, group_engagements: 0 };
    for (const a of (actions24h.data ?? []) as any[]) {
      if (a.action_type === 'post') actionCounts.posts++;
      else if (['comment', 'reply'].includes(a.action_type)) actionCounts.comments++;
      else if (['blog_create', 'blog_article'].includes(a.action_type)) actionCounts.blog_articles++;
      else if (['group_create', 'group_post'].includes(a.action_type)) actionCounts.group_engagements++;
    }

    const themeMap: Record<string, { total: number; count: number }> = {};
    for (const t of (topThemesRaw.data ?? []) as any[]) {
      const c = t.narrative_cluster ?? 'general';
      if (!themeMap[c]) themeMap[c] = { total: 0, count: 0 };
      themeMap[c].total += t.sentiment ?? 0;
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
      sentiment_trend: (sentimentHistory.data ?? []).map((s: any) => ({ date: s.recorded_at, score: s.score })),
      top_themes: topThemes,
      actions_24h: { ...actionCounts, total: actions24h.data?.length ?? 0 },
      recommendations: (recs.data ?? []) as any[],
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────
  private async _getActiveCampaigns(): Promise<Array<{ client: APMAClient; campaign: APMACampaign }>> {
    const sb = getServiceSupabaseClient();
    const { data } = await sb
      .from('apma_campaigns')
      .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
      .eq('status', 'active');
    return (data ?? []).map((row: any) => ({
      client: row.apma_clients as APMAClient,
      campaign: { ...row, apma_clients: undefined } as APMACampaign,
    })).filter((r) => r.client && r.client.status === 'active');
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
    await Promise.all([
      sb.from('apma_campaigns').update({ narrative_score_current: score, updated_at: new Date().toISOString() }).eq('id', campaignId),
      sb.from('apma_clients').update({ narrative_score: score, updated_at: new Date().toISOString() }).eq('id', clientId),
    ]);
  }
}

export const apmaOrchestrator = new APMAOrchestrator();
