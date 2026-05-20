/**
 * APMA Decision Layer
 * LLM-based dynamic planner that reads real-time perception data and
 * produces daily action plans with 7/30/90-day predictions.
 * Zero hard-coded rules — all decisions derived from live data + client goal.
 */

import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaCycleLog } from './apmaCycleLogger';
import { apmaPerception, type NarrativeSnapshot } from './apmaPerceptionService';

const supabase = () => getServiceSupabaseClient();

export interface DailyPlan {
  id?: string;
  client_id: string;
  plan_date: string;
  sentiment_snapshot: number;
  top_narratives: TopNarrative[];
  actions: PlannedAction[];
  predictions: Predictions;
}

export interface PlannedAction {
  type: ActionType;
  priority: 'critical' | 'high' | 'medium' | 'low';
  platform: string;
  target_narrative: string;
  content_hint: string;
  persona_style?: string;
  timing_minutes_from_now: number;
  status: 'pending' | 'executing' | 'done' | 'failed';
}

export type ActionType =
  | 'post_content'
  | 'reply_comment'
  | 'create_blog_post'
  | 'publish_blog'
  | 'create_social_group'
  | 'send_group_message'
  | 'generate_image'
  | 'generate_video'
  | 'boost_narrative'
  | 'counter_narrative'
  | 'flood_comments'
  | 'dm_influencer'
  | 'traffic_push';

export interface TopNarrative {
  topic: string;
  sentiment: number;
  count: number;
  action_needed: 'amplify' | 'counter' | 'ignore';
}

export interface Predictions {
  day_7: string;
  day_30: string;
  day_90: string;
  risk_events: string[];
  opportunity_events: string[];
}

export class ApmaDecisionService {
  private ai = AIEngine.getInstance();

  async runDecisionCycle(clientId: string, userId: string): Promise<DailyPlan> {
    const start = Date.now();
    await apmaCycleLog(clientId, userId, 'decision', 'cycle_start', 'running', { clientId });

    const client = await this.getClient(clientId);
    if (!client) throw new Error('Political client not found');

    // Get latest perception snapshot (last 3 days)
    const snapshot = await apmaPerception.getNarrativeSnapshot(clientId, 3);

    // Get previous plans for context
    const { data: previousPlans } = await supabase()
      .from('political_strategies')
      .select('actions, narrative_score_before, narrative_score_after, plan_date')
      .eq('client_id', clientId)
      .order('plan_date', { ascending: false })
      .limit(3);

    await apmaCycleLog(clientId, userId, 'decision', 'context_gathered', 'success', {
      snapshotItems: snapshot.totalItems,
      prevPlans: previousPlans?.length ?? 0,
    });

    // Build dynamic prompt — no hard-coded rules
    const plan = await this.generatePlan(client, snapshot, previousPlans ?? []);

    // Persist plan
    const { data: savedPlan } = await supabase()
      .from('political_strategies')
      .insert({
        client_id: clientId,
        user_id: userId,
        plan_date: plan.plan_date,
        sentiment_snapshot: plan.sentiment_snapshot,
        top_narratives: plan.top_narratives,
        actions: plan.actions,
        predictions: plan.predictions,
        narrative_score_before: snapshot.avgSentiment,
        executed: false,
      })
      .select()
      .single();

    await apmaCycleLog(clientId, userId, 'decision', 'plan_generated', 'success', {
      actions: plan.actions.length,
      sentiment: snapshot.avgSentiment,
      durationMs: Date.now() - start,
    }, Date.now() - start);

    return { ...plan, id: savedPlan?.id };
  }

  private async generatePlan(
    client: any,
    snapshot: NarrativeSnapshot,
    previousPlans: any[],
  ): Promise<DailyPlan> {
    const topicsJson = JSON.stringify(snapshot.topTopics.slice(0, 8));
    const prevSummary = previousPlans.map(p =>
      `Date: ${p.plan_date}, Before: ${p.narrative_score_before?.toFixed(2)}, After: ${p.narrative_score_after?.toFixed(2) ?? 'N/A'}, Actions: ${(p.actions ?? []).length}`
    ).join('\n');

    const systemPrompt = `You are APMA's Decision Intelligence — the strategic brain of an Autonomous Political Marketing Agent for Nigerian politics.
You make decisions PURELY based on real-time data. No hardcoded rules. Every decision must be justified by the data provided.
You understand Nigerian political dynamics, Nairaland discourse, Yoruba/Igbo/Hausa sentiment patterns, and election cycles.`;

    const userPrompt = `MISSION: ${client.campaign_goal} for client "${client.client_name}"
Campaign type: ${client.client_type} | Subtype: ${client.campaign_subtype ?? 'N/A'}
Duration: ${client.campaign_duration_months} months | Rivals: ${(client.rivals ?? []).join(', ') || 'none'}
Current narrative score: ${snapshot.avgSentiment.toFixed(3)} (-1=very negative, +1=very positive)
Baseline: ${client.narrative_baseline}
Data points analyzed: ${snapshot.totalItems}

TOP NARRATIVE TOPICS (real-time):
${topicsJson}

PREVIOUS PLAN PERFORMANCE:
${prevSummary || 'No previous plans (first cycle)'}

SENTIMENT TREND (last days):
${JSON.stringify(snapshot.trend)}

Based on this LIVE DATA, generate today's action plan. Decide:
1. Which narratives to AMPLIFY (positive ones if goal=improve, negative if goal=damage rival)
2. Which narratives to COUNTER (attacks on client if goal=defend, or defend rival's weakness if attacking)
3. What content types are most effective RIGHT NOW based on trending topics
4. Which platforms have the most conversation volume
5. Realistic 7, 30, 90-day sentiment predictions based on trajectory

Return a JSON object with this EXACT structure:
{
  "plan_date": "YYYY-MM-DD",
  "sentiment_snapshot": <float>,
  "top_narratives": [{"topic":"...","sentiment":<float>,"count":<int>,"action_needed":"amplify|counter|ignore"}],
  "actions": [
    {
      "type": "post_content|reply_comment|create_blog_post|publish_blog|create_social_group|send_group_message|generate_image|generate_video|boost_narrative|counter_narrative|flood_comments|dm_influencer|traffic_push",
      "priority": "critical|high|medium|low",
      "platform": "twitter|facebook|instagram|reddit|telegram|nairaland|blog|whatsapp|discord|youtube",
      "target_narrative": "...",
      "content_hint": "Brief description of what this content should say/do",
      "persona_style": "formal|casual|pidgin|academic",
      "timing_minutes_from_now": <int 0-480>,
      "status": "pending"
    }
  ],
  "predictions": {
    "day_7": "Based on current trajectory...",
    "day_30": "...",
    "day_90": "...",
    "risk_events": ["..."],
    "opportunity_events": ["..."]
  }
}

Generate 8-15 actions. Prioritize by impact. Be specific, be ruthless, be strategic. Base everything on the real-time data above.
Return ONLY the JSON object. No explanation.`;

    const res = await this.ai.generateText(userPrompt, 'gpt-4o', systemPrompt);
    try {
      const plan = JSON.parse(res.text.replace(/```json|```/g, '').trim());
      return {
        client_id: client.id,
        plan_date: plan.plan_date ?? new Date().toISOString().substring(0, 10),
        sentiment_snapshot: plan.sentiment_snapshot ?? snapshot.avgSentiment,
        top_narratives: plan.top_narratives ?? [],
        actions: (plan.actions ?? []).map((a: any) => ({ ...a, status: 'pending' })),
        predictions: plan.predictions ?? { day_7: '', day_30: '', day_90: '', risk_events: [], opportunity_events: [] },
      };
    } catch {
      // Fallback minimal plan
      return {
        client_id: client.id,
        plan_date: new Date().toISOString().substring(0, 10),
        sentiment_snapshot: snapshot.avgSentiment,
        top_narratives: snapshot.topTopics.map(t => ({
          topic: t.topic, sentiment: t.sentiment, count: t.count,
          action_needed: t.sentiment < 0 ? 'counter' : 'amplify',
        })),
        actions: [{
          type: 'post_content', priority: 'high', platform: 'twitter',
          target_narrative: snapshot.topTopics[0]?.topic ?? 'general',
          content_hint: `Positive narrative about ${client.client_name}`,
          persona_style: 'casual', timing_minutes_from_now: 30, status: 'pending',
        }],
        predictions: { day_7: 'Slight improvement expected', day_30: 'Momentum building', day_90: 'Significant shift possible', risk_events: [], opportunity_events: [] },
      };
    }
  }

  async getLatestPlan(clientId: string): Promise<DailyPlan | null> {
    const { data } = await supabase()
      .from('political_strategies')
      .select('*')
      .eq('client_id', clientId)
      .order('plan_date', { ascending: false })
      .limit(1)
      .single();
    return data ?? null;
  }

  async markActionDone(planId: string, actionIndex: number, success: boolean) {
    const { data } = await supabase()
      .from('political_strategies')
      .select('actions')
      .eq('id', planId)
      .single();

    if (!data) return;
    const actions = data.actions ?? [];
    if (actions[actionIndex]) {
      actions[actionIndex].status = success ? 'done' : 'failed';
    }
    await supabase()
      .from('political_strategies')
      .update({ actions })
      .eq('id', planId);
  }

  private async getClient(clientId: string) {
    const { data } = await supabase()
      .from('political_clients')
      .select('*')
      .eq('id', clientId)
      .single();
    return data;
  }
}

export const apmaDecision = new ApmaDecisionService();
