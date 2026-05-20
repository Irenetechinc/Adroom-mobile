import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaGeoService } from './apmaGeoService';
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

    // Get geo-specific context — makes APMA truly adaptive to any country
    const geoCtx = await apmaGeoService.getCountryContext(client.country);

    const systemPrompt = `You are APMA — an autonomous political marketing strategist specialising in ${geoCtx.countryName}.

CLIENT CONTEXT:
- Client: ${client.name} (${geoCtx.countryName}, ${geoCtx.politicalSystem})
- Goal: ${client.goal === 'improve' ? 'Shift public narrative POSITIVE' : 'Shift public narrative NEGATIVE about targets'}
- Targets to counter: ${(client.target_entities || []).join(', ') || 'N/A'}
- Current Narrative Score: ${snapshot.overall_sentiment.toFixed(3)} → Target: ${campaign.narrative_score_target}
- Urgency: ${urgency}

COUNTRY INTELLIGENCE (${geoCtx.countryName}):
- Dominant platforms: ${geoCtx.majorPlatforms.join(', ')}
- Cultural tone: ${geoCtx.culturalTone}
- Salient political topics: ${geoCtx.majorTopics.join(', ')}
- Content guidelines: ${geoCtx.contentGuidelines}

PERCEPTION DATA:
- Top threats: ${snapshot.threat_signals.join(', ') || 'none'}
- Opportunities: ${snapshot.opportunity_signals.join(', ') || 'none'}
- Top narratives: ${snapshot.top_narratives.map((n) => `${n.topic} (sentiment ${n.sentiment.toFixed(2)}, ${n.volume} mentions)`).join('; ')}

ACTIVE PLATFORMS: ${campaign.platforms.join(', ')}
CAMPAIGN KEYWORDS: ${campaign.keywords.join(', ')}

OPERATIONAL RULES:
1. All actions must be indistinguishable from organic political engagement
2. No hate speech, direct threats, doxxing, or impersonation
3. All factual claims must be verifiable through credible sources
4. Rotate across multiple platforms and personas
5. Tailor ALL content to ${geoCtx.countryName}'s political culture and issues
6. Sensitive counter-narrative actions require a 2-hour veto window

Generate a DAILY PLAN for ${today}. Return ONLY valid JSON with this structure:
{
  "date": "${today}",
  "objective": "<single sentence objective specific to ${geoCtx.countryName}>",
  "target_narrative": "<dominant narrative to amplify or counter>",
  "sentiment_shift_target": <how much score shift expected today, e.g. 0.04>,
  "actions": [
    {
      "type": "post|comment|reply|dm|share|like",
      "platform": "${campaign.platforms[0]}",
      "count": <integer 3-15>,
      "narrative_angle": "<specific angle relevant to ${geoCtx.countryName}>",
      "keywords": ["<keyword from campaign>"],
      "persona_style": "formal|casual|slang|academic",
      "priority": "low|medium|high"
    }
  ],
  "blog_tasks": [
    {
      "site_name": "<credible-sounding news blog name for ${geoCtx.countryName}>",
      "article_count": <3-8>,
      "topics": ["<specific topic>"],
      "seo_keywords": ["<keyword>"]
    }
  ],
  "group_tasks": [
    {
      "platform": "facebook|telegram|discord|reddit",
      "name": "<group name culturally appropriate for ${geoCtx.countryName}>",
      "description": "<purpose>",
      "initial_posts": <5-20>
    }
  ],
  "recommendations": [
    {
      "text": "<client-facing recommendation in English>",
      "action_type": "<type>",
      "priority": "low|medium|high|critical",
      "auto_implement": true,
      "sensitive": false
    }
  ]
}

Be specific, actionable, and culturally calibrated to ${geoCtx.countryName}. Return ONLY valid JSON.`;

    let plan: DailyPlan;
    try {
      const resp = await this.ai.generateWithGPT4(systemPrompt, { maxTokens: 3500, temperature: 0.7 });
      const cleaned = (resp || '').replace(/```json|```/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch {
      plan = this._fallbackPlan(today, campaign, snapshot, geoCtx.majorTopics);
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
    const geoCtx = await apmaGeoService.getCountryContext(client.country);

    const prompt = `You are a political intelligence analyst specialising in ${geoCtx.countryName}.

Based on ${geoCtx.countryName}'s current political landscape (political system: ${geoCtx.politicalSystem}), predict up to 5 significant political events in the next ${horizonDays} days that could affect the public narrative around "${client.name}".

Topics currently salient: ${geoCtx.majorTopics.join(', ')}

For each event return:
{ "date": "YYYY-MM-DD", "event": "<event description>", "probability": <0-1>, "suggested_action": "<what APMA should do if this happens>" }

Return ONLY a JSON array. No explanation.`;

    try {
      const resp = await this.ai.generateWithGPT4(prompt, { maxTokens: 1000, temperature: 0.6 });
      return JSON.parse((resp || '').replace(/```json|```/g, '').trim());
    } catch {
      return [];
    }
  }

  private _fallbackPlan(today: string, campaign: APMACampaign, snapshot: PerceptionSnapshot, majorTopics: string[]): DailyPlan {
    return {
      date: today,
      objective: `Shift narrative from ${snapshot.overall_sentiment.toFixed(2)} toward ${campaign.narrative_score_target} through authentic organic engagement`,
      target_narrative: snapshot.top_narratives[0]?.topic ?? majorTopics[0] ?? campaign.keywords[0] ?? 'positive_governance',
      sentiment_shift_target: 0.03,
      actions: [
        { type: 'post', platform: campaign.platforms[0] ?? 'twitter', count: 5, narrative_angle: 'constructive positive achievements', keywords: campaign.keywords.slice(0, 3), persona_style: 'casual', priority: 'high' },
        { type: 'comment', platform: campaign.platforms[1] ?? 'facebook', count: 10, narrative_angle: 'fact-based counter of negative narratives', keywords: campaign.keywords.slice(0, 3), persona_style: 'formal', priority: 'medium' },
        { type: 'post', platform: campaign.platforms[2] ?? 'reddit', count: 3, narrative_angle: 'balanced policy discussion', keywords: campaign.keywords.slice(0, 2), persona_style: 'academic', priority: 'medium' },
      ],
      blog_tasks: [],
      group_tasks: [],
    };
  }

  private async _storePlan(clientId: string, campaignId: string, plan: DailyPlan, currentSentiment: number): Promise<void> {
    const sb = getServiceSupabaseClient();
    const totalActions = plan.actions.reduce((s, a) => s + (a.count ?? 0), 0);

    // Prevent duplicate plans for the same date
    const { count } = await sb
      .from('political_strategies')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('plan_date', plan.date);
    if ((count ?? 0) > 0) return;

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
      actions_total: totalActions,
    });
  }

  private async _storeRecommendations(clientId: string, campaignId: string, recs: any[]): Promise<void> {
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
