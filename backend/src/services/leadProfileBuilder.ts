import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import * as featureFlags from './featureFlagService';

export interface LeadProfile {
  leadId: string;
  communicationStyle: string;
  statedNeeds: string[];
  observedPainPoints: string[];
  buyingSignals: string[];
  decisionBlockers: string[];
  preferredTopics: string[];
  observedTiming: { activeHours: number[]; responsePattern: string };
  recommendedTone: string;
  confidence: number;
  evidenceCount: number;
  privacyScope: 'public_and_user_owned_evidence';
  generatedAt: string;
}

/**
 * Builds a sales-useful profile from evidence the user already owns or that is
 * explicitly public. It should discover identities, infer sensitive traits,
 * score ideology, and enrich private contact information.
 */
export class LeadProfileBuilder {
  private ai = AIEngine.getInstance();
  private supabase = getServiceSupabaseClient();

  async buildForLead(userId: string, leadId: string): Promise<LeadProfile | null> {
    const enabled = await featureFlags.isEnabled('lead_profile_builder', userId);
    if (!enabled) {
      console.warn(`[LeadProfileBuilder] disabled by feature flag user=${userId} lead=${leadId}`);
      return null;
    }

    const [leadResult, messagesResult, mentionsResult] = await Promise.all([
      // Keep this projection limited to columns guaranteed by the core
      // agent_leads migration. conversation_history is optional and is not
      // needed to build a profile from public discovery evidence.
      this.supabase.from('agent_leads').select('id, platform, platform_username, first_interaction, intent_signals, created_at').eq('id', leadId).eq('user_id', userId).maybeSingle(),
      this.supabase.from('lead_dm_messages').select('direction, message, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(30),
      (await featureFlags.isEnabled('lead_profile_public_mentions', userId))
        ? this.supabase.from('public_prospect_mentions').select('source, content_excerpt, intent_score, buying_signals, collected_at').eq('user_id', userId).limit(20)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (leadResult.error) {
      throw new Error(`lead lookup failed: ${leadResult.error.message}`);
    }
    if (messagesResult.error) {
      console.warn(`[LeadProfileBuilder] conversation evidence unavailable lead=${leadId}: ${messagesResult.error.message}`);
    }
    if (mentionsResult.error) {
      console.warn(`[LeadProfileBuilder] public mention evidence unavailable lead=${leadId}: ${mentionsResult.error.message}`);
    }

    const lead = leadResult.data;
    if (!lead) return null;

    const messages = (messagesResult.data || []).filter((row: any) => row.direction !== 'outbound');
    const evidence = [
      lead.first_interaction ? { source: 'lead_record', text: String(lead.first_interaction).slice(0, 1200) } : null,
      lead.intent_signals ? { source: 'public_signal_metadata', text: JSON.stringify(lead.intent_signals).slice(0, 2400) } : null,
      ...messages.map((row: any) => ({ source: 'conversation', text: String(row.message || '').slice(0, 1200), created_at: row.created_at })),
      ...(mentionsResult.data || []).map((row: any) => ({ source: 'public_mention', text: String(row.content_excerpt || '').slice(0, 1200), buying_signals: row.buying_signals })),
    ].filter(Boolean);
    if (!evidence.length) return null;

    // AI enrichment is best effort. Store a useful evidence-only profile when
    // the configured provider is unavailable or returns malformed JSON, so
    // profile generation never prevents the conversation workflow from using
    // the lead.
    const profile = (await this.generateProfile(lead, evidence)) || this.fallbackProfile(evidence);
    const result: LeadProfile = {
      leadId,
      communicationStyle: String(profile.communicationStyle || 'clear and professional').slice(0, 300),
      statedNeeds: this.cleanList(profile.statedNeeds),
      observedPainPoints: this.cleanList(profile.observedPainPoints),
      buyingSignals: this.cleanList(profile.buyingSignals),
      decisionBlockers: this.cleanList(profile.decisionBlockers),
      preferredTopics: this.cleanList(profile.preferredTopics),
      observedTiming: {
        activeHours: Array.isArray(profile.observedTiming?.activeHours) ? profile.observedTiming.activeHours.filter((n: any) => Number.isInteger(n) && n >= 0 && n <= 23).slice(0, 8) : [],
        responsePattern: String(profile.observedTiming?.responsePattern || '').slice(0, 300),
      },
      recommendedTone: String(profile.recommendedTone || 'helpful and concise').slice(0, 300),
      confidence: Math.max(0, Math.min(1, Number(profile.confidence) || 0.4)),
      evidenceCount: evidence.length,
      privacyScope: 'public_and_user_owned_evidence',
      generatedAt: new Date().toISOString(),
    };

    const { error: profileError } = await this.supabase.from('lead_sales_profiles').upsert({
      user_id: userId,
      lead_id: leadId,
      profile: result,
      evidence_count: result.evidenceCount,
      confidence_score: result.confidence,
      privacy_scope: result.privacyScope,
      updated_at: result.generatedAt,
    }, { onConflict: 'user_id,lead_id' });
    if (profileError) {
      throw new Error(`profile save failed: ${profileError.message}`);
    }
    return result;
  }

  async getLatest(userId: string, leadId: string): Promise<LeadProfile | null> {
    if (!(await featureFlags.isEnabled('lead_profile_builder', userId))) return null;
    const { data } = await this.supabase.from('lead_sales_profiles').select('profile').eq('user_id', userId).eq('lead_id', leadId).maybeSingle();
    return (data?.profile as LeadProfile) || null;
  }

  private async generateProfile(lead: any, evidence: any[]): Promise<any> {
    const response = await this.ai.generateJson(`Create a sales preparation profile using ONLY the observed evidence below.
Do not identify the person, search for accounts, infer health, race, religion, political views, sexuality, precise location, income, or other sensitive traits.
Do not state guesses as facts. Use empty arrays when evidence is absent.
Return JSON with exactly: communicationStyle, statedNeeds, observedPainPoints, buyingSignals, decisionBlockers, preferredTopics, observedTiming {activeHours, responsePattern}, recommendedTone, confidence.
The profile is for respectful product-help conversations, not automated targeting or eligibility decisions.
LEAD PLATFORM: ${lead.platform || 'unknown'}
EVIDENCE: ${JSON.stringify(evidence).slice(0, 18000)}`);
    return response && typeof response === 'object' ? response : null;
  }

  private fallbackProfile(evidence: any[]): any {
    return {
      communicationStyle: 'unknown; use a clear and respectful tone',
      statedNeeds: [],
      observedPainPoints: [],
      buyingSignals: [],
      decisionBlockers: [],
      preferredTopics: [],
      observedTiming: { activeHours: [], responsePattern: '' },
      recommendedTone: 'helpful and concise',
      confidence: Math.min(0.35, Math.max(0.1, evidence.length * 0.05)),
    };
  }

  private cleanList(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean).slice(0, 12) : [];
  }
}

export const leadProfileBuilder = new LeadProfileBuilder();
