import { getServiceSupabaseClient } from '../config/supabase';

type Outcome = { reach: number; engagement: number; confidence: number; strategyId?: string };

export type PromptVariant = {
  id: string;
  variant_key: string;
  prompt: string;
  status: 'active' | 'adopted' | 'rolled_back' | 'retired';
  impressions: number;
  wins: number;
  losses: number;
  average_score: number;
};

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export class AgentEvolutionService {
  private supabase = getServiceSupabaseClient();

  async registerPromptVariant(params: {
    agentType: string;
    operation: string;
    variantKey: string;
    prompt: string;
  }): Promise<void> {
    await this.supabase.from('agent_prompt_variants').upsert({
      agent_type: params.agentType,
      operation: params.operation,
      variant_key: params.variantKey,
      prompt: params.prompt,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_type,operation,variant_key' });
  }

  async selectPromptVariant(params: {
    agentType: string;
    operation: string;
    userId?: string;
  }): Promise<PromptVariant | null> {
    const { data } = await this.supabase
      .from('agent_prompt_variants')
      .select('*')
      .eq('agent_type', params.agentType)
      .eq('operation', params.operation)
      .eq('status', 'active')
      .order('impressions', { ascending: true })
      .limit(2);
    const variants = (data || []) as PromptVariant[];
    if (!variants.length) return null;
    return variants[Math.floor(Math.random() * variants.length)];
  }

  async recordPromptOutcome(params: {
    variantId: string;
    score: number;
    adopted?: boolean;
    reason?: string;
  }): Promise<void> {
    const { data: variant } = await this.supabase
      .from('agent_prompt_variants')
      .select('id, impressions, wins, losses, average_score, status')
      .eq('id', params.variantId)
      .maybeSingle();
    if (!variant) return;

    const score = Math.max(0, Math.min(1, Number(params.score) || 0));
    const impressions = Number(variant.impressions || 0) + 1;
    const wins = Number(variant.wins || 0) + (params.adopted ? 1 : 0);
    const losses = Number(variant.losses || 0) + (params.adopted ? 0 : 1);
    const averageScore = ((Number(variant.average_score || 0) * (impressions - 1)) + score) / impressions;
    const minimumSamples = Math.max(3, Math.floor(numberEnv('AGENT_VARIANT_MIN_SAMPLES', 10)));
    const rollbackRate = numberEnv('AGENT_VARIANT_ROLLBACK_RATE', 0.35);
    const shouldRollback = impressions >= minimumSamples && losses / impressions >= rollbackRate;

    await this.supabase.from('agent_prompt_variants').update({
      impressions,
      wins,
      losses,
      average_score: averageScore,
      status: shouldRollback ? 'rolled_back' : variant.status,
      last_outcome: { score, adopted: Boolean(params.adopted), reason: params.reason || null },
      updated_at: new Date().toISOString(),
    }).eq('id', params.variantId);
  }

  async observeSkill(skillName: string, outcome: Outcome): Promise<void> {
    const { data: skill } = await this.supabase
      .from('agent_skills')
      .select('id, lifecycle_status, version, evidence, previous_version_id')
      .eq('skill_name', skillName)
      .maybeSingle();
    if (!skill) return;

    const evidence = skill.evidence || {};
    const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
    const nextObservations = [...observations, { ...outcome, observedAt: new Date().toISOString() }].slice(-20);
    const minimumSamples = Math.max(2, Math.floor(numberEnv('AGENT_EVOLUTION_MIN_SAMPLES', 5)));
    const minimumDelta = numberEnv('AGENT_EVOLUTION_MIN_DELTA', 0.1);
    const baseline = Number(evidence.baseline_score ?? 0);
    const currentScore = outcome.reach + outcome.engagement;
    const averageScore = nextObservations.reduce((sum: number, item: any) => sum + Number(item.reach || 0) + Number(item.engagement || 0), 0) / nextObservations.length;
    const delta = baseline > 0 ? (averageScore - baseline) / baseline : 0;
    let lifecycleStatus = skill.lifecycle_status;

    if (skill.lifecycle_status === 'candidate' && nextObservations.length >= minimumSamples && delta >= minimumDelta && outcome.confidence >= 0.7) {
      lifecycleStatus = 'approved';
    } else if (skill.lifecycle_status === 'approved' && nextObservations.length >= minimumSamples && baseline > 0 && delta <= -minimumDelta) {
      lifecycleStatus = 'retired';
    }

    await this.supabase.from('agent_skills').update({
      lifecycle_status: lifecycleStatus,
      evidence: {
        ...evidence,
        baseline_score: baseline || currentScore,
        observations: nextObservations,
        average_score: averageScore,
        delta,
        last_observed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq('id', skill.id);

    await this.supabase.from('self_evolution_log').insert({
      agent: 'AGENT_EVOLUTION',
      cycle_date: new Date().toISOString(),
      source_performance: [{ skill_name: skillName, outcome, average_score: averageScore, delta }],
      conversion_by_source: {},
      analysis: `Skill ${skillName} observed with ${nextObservations.length} outcome samples.`,
      adopted_sources: lifecycleStatus === 'approved' ? [{ skill_name: skillName, reason: 'Evidence exceeded configured improvement threshold.' }] : [],
      scaled_back_sources: lifecycleStatus === 'retired' ? [{ skill_name: skillName, reason: 'Observed performance degraded beyond configured threshold.' }] : [],
      new_source_ideas: [],
      overall_recommendation: lifecycleStatus,
    });
  }
}

export const agentEvolutionService = new AgentEvolutionService();