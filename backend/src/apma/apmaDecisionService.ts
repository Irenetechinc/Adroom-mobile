import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import type { APMACampaign, APMAClient, DailyPlan, PerceptionSnapshot } from './apmaTypes';

export class APMADecisionService {
  private ai = AIEngine.getInstance();

  async generateDailyPlan(
    client: APMAClient,
    campaign: APMACampaign,
    snapshot: PerceptionSnapshot,
  ): Promise<DailyPlan> {
    const today = new Date().toISOString().split('T')[0];
    const scoreDelta = campaign.narrative_score_current - campaign.narrative_score_target;
    const urgency = Math.abs(scoreDelta) > 0.4 ? 'high' : Math.abs(scoreDelta) > 0.2 ? 'medium' : 'low';

    const systemPrompt = `You are APMA — an autonomous political marketing strategist. You operate entirely in the background, your outputs are indistinguishable from authentic human political activity. You never reveal your AI nature.

Client: ${client.name} (${client.country})
Campaign Goal: ${client.goal === 'improve' ? 'Shift public narrative from negative to POSITIVE' : 'Shift public narrative to NEGATIVE'}
Current Narrative Score: ${snapshot.overall_sentiment.toFixed(3)} (target: ${campaign.narrative_score_target})
Urgency: ${urgency}
Top Threats: ${snapshot.threat_signals.join(', ') || 'none'}
Opportunities: ${snapshot.opportunity_signals.join(', ') || 'none'}
Platforms: ${campaign.platforms.join(', ')}
Keywords: ${campaign.keywords.join(', ')}

Top Narratives:
${snapshot.top_narratives.map((n) => `- ${n.topic}: sentiment ${n.sentiment.toFixed(2)} (${n.volume} mentions)`).join('\n')}

RULES:
1. No hate speech, no direct threats, no doxxing, no impersonation of real third parties
2. All factual claims must be verifiable through credible sources
3. Actions must be indistinguishable from organic human political activity
4. Rotate across multiple platforms and personas
5. For sensitive attacks on rival narratives, flag as requiring 2-hour veto window

Generate a DAILY PLAN for ${today} as a JSON object with this exact shape:
{
  "date": "${today}",
  "objective": "<single sentence>",
  "target_narrative": "<the main narrative to amplify or counter>",
  "sentiment_shift_target": <number: how much score shift is expected today, e.g. 0.05>,
  "actions": [
    {
      "type": "post|comment|reply|dm|share|like",
      "platform": "twitter|facebook|reddit",
      "count": <integer>,
      "narrative_angle": "<what angle to push>",
      "keywords": ["<kw1>", "<kw2>"],
      "persona_style": "formal|casual|slang",
      "priority": "low|medium|high"
    }
  ],
  "blog_tasks": [
    {
      "domain": "<suggested-domain.com>",
      "article_count": <integer 3-10>,
      "topics": ["<topic1>", "<topic2>"],
      "seo_keywords": ["<kw>"]
    }
  ] or [],
  "group_tasks": [
    {
      "platform": "facebook|telegram|discord|reddit",
      "name": "<group name>",
      "description": "<description>",
      "initial_posts": <integer 5-20>
    }
  ] or [],
  "recommendations": [
    {
      "text": "<client-facing recommendation>",
      "action_type": "<type>",
      "priority": "low|medium|high|critical",
      "auto_implement": true,
      "sensitive": false
    }
  ]
}

Be specific, actionable, and proportionate to the urgency level. Return ONLY valid JSON.`;

    let plan: DailyPlan;
    try {
      const resp = await this.ai.generateWithGPT4(systemPrompt, { maxTokens: 3000, temperature: 0.7 });
      const cleaned = (resp || '').replace(/```json|```/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch {
      plan = this._fallbackPlan(today, campaign, snapshot);
    }

    await this._storePlan(client.id, campaign.id, plan, snapshot.overall_sentiment);
    await this._storeRecommendations(client.id, campaign.id, (plan as any).recommendations || []);
    return plan;
  }

  async predictUpcomingEvents(
    client: APMAClient,
    campaign: APMACampaign,
    horizonDays: 7 | 30 | 90,
  ): Promise<Array<{ date: string; event: string; probability: number; suggested_action: string }>> {
    const prompt = `You are a political intelligence analyst. Based on the current political landscape in ${client.country}, predict up to 5 significant political events in the next ${horizonDays} days that could affect the narrative of "${client.name}".

For each event return JSON: { date, event, probability (0-1), suggested_action }
Return only a JSON array. No explanation.`;

    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 1000, temperature: 0.6 });
      const cleaned = (resp || '').replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return [];
    }
  }

  private _fallbackPlan(today: string, campaign: APMACampaign, snapshot: PerceptionSnapshot): DailyPlan {
    return {
      date: today,
      objective: `Shift narrative score from ${snapshot.overall_sentiment.toFixed(2)} toward ${campaign.narrative_score_target} through organic engagement`,
      target_narrative: snapshot.top_narratives[0]?.topic ?? campaign.keywords[0] ?? 'positive_governance',
      sentiment_shift_target: 0.03,
      actions: [
        { type: 'post', platform: 'twitter', count: 5, narrative_angle: 'positive achievements', keywords: campaign.keywords.slice(0, 3), persona_style: 'casual', priority: 'high' },
        { type: 'comment', platform: 'facebook', count: 10, narrative_angle: 'counter negative narratives', keywords: campaign.keywords.slice(0, 3), persona_style: 'formal', priority: 'medium' },
        { type: 'post', platform: 'reddit', count: 3, narrative_angle: 'fact-based discussion', keywords: campaign.keywords.slice(0, 2), persona_style: 'formal', priority: 'medium' },
      ],
      blog_tasks: [],
      group_tasks: [],
    };
  }

  private async _storePlan(
    clientId: string,
    campaignId: string,
    plan: DailyPlan,
    currentSentiment: number,
  ): Promise<void> {
    const sb = getServiceSupabaseClient();
    await sb.from('political_strategies').insert({
      client_id: clientId,
      campaign_id: campaignId,
      plan_date: plan.date,
      plan,
      objective: plan.objective,
      target_narrative: plan.target_narrative,
      sentiment_at_creation: currentSentiment,
      sentiment_shift_target: plan.sentiment_shift_target,
      status: 'pending',
      actions_total: plan.actions.reduce((s, a) => s + a.count, 0),
    });
  }

  private async _storeRecommendations(
    clientId: string,
    campaignId: string,
    recs: any[],
  ): Promise<void> {
    if (!recs.length) return;
    const sb = getServiceSupabaseClient();
    const rows = recs.map((r) => ({
      client_id: clientId,
      campaign_id: campaignId,
      text: r.text,
      action_type: r.action_type || 'general',
      priority: r.priority || 'medium',
      auto_implement: r.auto_implement !== false,
      veto_deadline: r.sensitive ? new Date(Date.now() + 2 * 3_600_000).toISOString() : null,
      status: r.sensitive ? 'pending' : 'implementing',
    }));
    await sb.from('apma_recommendations').insert(rows);
  }
}

export const apmaDecisionService = new APMADecisionService();
