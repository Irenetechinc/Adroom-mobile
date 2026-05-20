import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';
import { apmaGeoService } from './apmaGeoService';
import type { APMAClient, APMACampaign } from './apmaTypes';

export interface ClientProfile {
  client_id: string;
  campaign_id: string;
  public_perception_summary: string;
  win_probability: number;
  win_probability_rationale: string;
  key_strengths: string[];
  key_weaknesses: string[];
  key_threats: string[];
  key_opportunities: string[];
  target_demographics: Array<{ group: string; lean: 'for' | 'against' | 'undecided'; size_estimate: string }>;
  key_issues: Array<{ issue: string; stance: string; importance: 'high' | 'medium' | 'low' }>;
  competitor_analysis: Array<{ name: string; threat_level: 'high' | 'medium' | 'low'; notes: string }>;
  narrative_health_rating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  recommended_focus_areas: string[];
  generated_at: string;
}

export class APMAClientProfileService {
  private ai = AIEngine.getInstance();

  async buildClientProfile(client: APMAClient, campaign: APMACampaign): Promise<ClientProfile> {
    const sb = getServiceSupabaseClient();
    const geoCtx = await apmaGeoService.getCountryContext(client.country);

    // Pull recent perception + action data to enrich the profile
    const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [sentimentRows, recentActions, recentRecs] = await Promise.all([
      sb.from('apma_sentiment_history')
        .select('score, recorded_at')
        .eq('campaign_id', campaign.id)
        .gte('recorded_at', since30d)
        .order('recorded_at', { ascending: true }),
      sb.from('apma_actions')
        .select('action_type, platform, success')
        .eq('campaign_id', campaign.id)
        .gte('executed_at', since30d),
      sb.from('apma_recommendations')
        .select('text, priority, status')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const sentimentTrend = (sentimentRows.data ?? []).map((r: any) => r.score);
    const avgSentiment = sentimentTrend.length
      ? sentimentTrend.reduce((s: number, v: number) => s + v, 0) / sentimentTrend.length
      : campaign.narrative_score_current;
    const sentimentDirection =
      sentimentTrend.length >= 2
        ? sentimentTrend[sentimentTrend.length - 1] > sentimentTrend[0] ? 'improving' : 'declining'
        : 'stable';

    const actionSuccessRate = (() => {
      const acts = recentActions.data ?? [];
      if (!acts.length) return 0;
      return acts.filter((a: any) => a.success).length / acts.length;
    })();

    const prompt = `You are APMA — a senior political intelligence analyst specialising in ${geoCtx.countryName}.

SUBJECT: ${client.name}
COUNTRY: ${geoCtx.countryName} (${geoCtx.politicalSystem})
CAMPAIGN TYPE: ${campaign.campaign_type} — ${campaign.campaign_subtype}
CAMPAIGN GOAL: ${campaign.goal === 'get_votes' ? 'Win Election / Maximise Vote Count' : campaign.goal === 'improve' ? 'Build Positive Narrative' : 'Damage Opposition Narrative'}
CAMPAIGN DURATION: ${campaign.duration_months} months (started ${campaign.start_date})
KEYWORDS: ${(campaign.keywords ?? []).join(', ')}
PLATFORMS: ${(campaign.platforms ?? []).join(', ')}

PERFORMANCE METRICS:
- Current Narrative Score: ${campaign.narrative_score_current.toFixed(3)} / 1.0 (target: ${campaign.narrative_score_target})
- Score Direction: ${sentimentDirection}
- 30-day Avg Sentiment: ${avgSentiment.toFixed(3)}
- Action Success Rate: ${(actionSuccessRate * 100).toFixed(0)}%

COUNTRY INTELLIGENCE:
- Political system: ${geoCtx.politicalSystem}
- Dominant platforms: ${geoCtx.majorPlatforms.join(', ')}
- Cultural tone: ${geoCtx.culturalTone}
- Salient topics: ${geoCtx.majorTopics.join(', ')}

TARGET ENTITIES (opposition/competitors): ${(client.target_entities ?? []).join(', ') || 'none specified'}

Build a comprehensive intelligence profile for ${client.name}. Return ONLY valid JSON:
{
  "public_perception_summary": "<2-3 sentences describing current public perception in ${geoCtx.countryName}>",
  "win_probability": <0.0-1.0, estimated probability of achieving campaign goal>,
  "win_probability_rationale": "<2 sentences explaining the estimate>",
  "key_strengths": ["<strength>"],
  "key_weaknesses": ["<weakness>"],
  "key_threats": ["<external threat>"],
  "key_opportunities": ["<exploitable opportunity>"],
  "target_demographics": [
    { "group": "<demographic>", "lean": "for|against|undecided", "size_estimate": "<% of relevant population>" }
  ],
  "key_issues": [
    { "issue": "<political issue>", "stance": "<client's position>", "importance": "high|medium|low" }
  ],
  "competitor_analysis": [
    { "name": "<competitor/target>", "threat_level": "high|medium|low", "notes": "<brief analysis>" }
  ],
  "narrative_health_rating": "excellent|good|fair|poor|critical",
  "recommended_focus_areas": ["<specific area to focus campaign energy>"]
}`;

    let profile: Omit<ClientProfile, 'client_id' | 'campaign_id' | 'generated_at'>;
    try {
      const resp = await this.ai.generateText(prompt);
      profile = JSON.parse((resp || '').replace(/```json|```/g, '').trim());
    } catch {
      profile = this._fallbackProfile(client, campaign, avgSentiment);
    }

    const result: ClientProfile = {
      ...profile,
      client_id: client.id,
      campaign_id: campaign.id,
      generated_at: new Date().toISOString(),
    };

    await sb.from('apma_client_profiles').upsert({
      client_id: client.id,
      campaign_id: campaign.id,
      profile: result,
      generated_at: result.generated_at,
    }, { onConflict: 'client_id,campaign_id' });

    return result;
  }

  async getLatestProfile(clientId: string, campaignId: string): Promise<ClientProfile | null> {
    const sb = getServiceSupabaseClient();
    const { data } = await sb
      .from('apma_client_profiles')
      .select('profile, generated_at')
      .eq('client_id', clientId)
      .eq('campaign_id', campaignId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();
    return data ? (data.profile as ClientProfile) : null;
  }

  private _fallbackProfile(
    client: APMAClient,
    campaign: APMACampaign,
    avgSentiment: number,
  ): Omit<ClientProfile, 'client_id' | 'campaign_id' | 'generated_at'> {
    const score = avgSentiment;
    return {
      public_perception_summary: `${client.name} has a current narrative score of ${score.toFixed(2)} in ${client.country}. The campaign is in ${campaign.status} status targeting a score of ${campaign.narrative_score_target}.`,
      win_probability: Math.min(0.95, Math.max(0.05, score)),
      win_probability_rationale: `Based on current narrative score of ${score.toFixed(2)} vs target of ${campaign.narrative_score_target}. Trend analysis indicates continued progress is needed.`,
      key_strengths: ['Active digital presence', 'Consistent messaging across platforms'],
      key_weaknesses: ['Narrative score below target', 'Limited organic reach data'],
      key_threats: ['Opposition counter-narratives', 'Negative media cycles'],
      key_opportunities: ['Undecided voter segments', 'Policy achievement amplification'],
      target_demographics: [
        { group: 'Young voters (18-35)', lean: 'undecided', size_estimate: '30%' },
        { group: 'Urban professionals', lean: 'for', size_estimate: '25%' },
      ],
      key_issues: campaign.keywords.slice(0, 3).map((k) => ({ issue: k, stance: 'Strong position', importance: 'high' as const })),
      competitor_analysis: (client.target_entities ?? []).slice(0, 2).map((e) => ({ name: e, threat_level: 'medium' as const, notes: 'Monitor closely' })),
      narrative_health_rating: score >= 0.7 ? 'good' : score >= 0.5 ? 'fair' : score >= 0.3 ? 'poor' : 'critical',
      recommended_focus_areas: ['Increase positive content volume', 'Engage undecided demographics', 'Counter opposition narratives'],
    };
  }
}

export const apmaClientProfileService = new APMAClientProfileService();
