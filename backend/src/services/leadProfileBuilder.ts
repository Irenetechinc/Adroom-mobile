import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { agentReachAdapter, type ReachResult } from './agentReachAdapter';
import { normalizePlatform, normalizeSelectedPlatforms } from './platformIdentity';
import * as featureFlags from './featureFlagService';
import { pushService } from './pushService';
import { PsychologistEngine, type LeadPsychologyProfile } from './psychologistEngine';

type BuilderStatus =
  | 'queued'
  | 'identified'
  | 'discovering'
  | 'profile_ready'
  | 'psychology_complete'
  | 'completed'
  | 'failed';

export interface PublicSocialHandle {
  platform: string;
  handle: string;
  url: string;
  source: string;
}

export interface PublicLeadIdentity {
  displayName: string;
  bio: string;
  socialHandles: PublicSocialHandle[];
  interests: string[];
  publicConnections: string[];
}

export interface LeadProfile {
  leadId: string;
  publicIdentity: PublicLeadIdentity;
  selectedPlatformMatches: PublicSocialHandle[];
  evidence: Array<{ source: string; url: string; excerpt: string; capturedAt: string }>;
  toolsAttempted: string[];
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
  psychology?: LeadPsychologyProfile;
  privacyScope: 'public_and_user_owned_evidence';
  generatedAt: string;
}

interface DiscoveryPlan {
  tool: 'maigret_public_username' | 'deepkrak3n_public_search' | 'platform_profile_search' | 'web_public_profile';
  platform: string;
  query: string;
  reason: string;
}

interface LeadContext {
  id: string;
  strategyId: string | null;
  platform: string;
  platformUserId: string;
  platformUsername: string;
  firstInteraction: string;
  intentSignals: any;
  selectedPlatforms: string[];
}

const TOOL_NAMES = [
  'maigret_public_username',
  'deepkrak3n_public_search',
  'platform_profile_search',
  'web_public_profile',
] as const;

const PERSONAL_DATA_PATTERN = /\b(?:email|e-mail|phone|telephone|mobile|address|dob|date of birth|income|salary|religion|race|ethnicity|sexuality|political|health|diagnos|password|token|secret|api key)\b/i;

function safeText(value: unknown, max = 1200): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanList(value: unknown, maxItems = 12): string[] {
  return Array.isArray(value)
    ? value.map((item) => safeText(item, 180)).filter(Boolean).slice(0, maxItems)
    : [];
}

function extractPublicHandle(platform: string, result: ReachResult): string | undefined {
  const recipient = result.metadata?.recipient || result.authorId;
  if (recipient && String(recipient) !== result.externalId) return safeText(recipient, 160);
  if (!result.url) return undefined;
  try {
    const parsed = new URL(result.url);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
    const normalized = normalizePlatform(platform);
    if (normalized === 'telegram' && parsed.hostname.endsWith('t.me') && path && !path.startsWith('+')) return `@${path.split('/')[0]}`;
    if (normalized === 'bluesky' && parsed.hostname.endsWith('bsky.app') && path.startsWith('profile/')) return path.slice(8).split('/')[0];
    if (path && !['web', 'google_maps'].includes(normalized)) return `@${path.split('/')[0]}`;
  } catch {
    return undefined;
  }
  return undefined;
}

export class LeadProfileBuilder {
  private ai = AIEngine.getInstance();
  private supabase = getServiceSupabaseClient();
  private psychologist = new PsychologistEngine();
  private running = new Set<string>();
  private lastDiscoveryAt = 0;

  async buildForLead(userId: string, leadId: string): Promise<LeadProfile | null> {
    const enabled = await featureFlags.isEnabled('lead_profile_builder', userId);
    if (!enabled || this.running.has(leadId)) return null;
    this.running.add(leadId);

    try {
      const context = await this.loadContext(userId, leadId);
      if (!context) return null;

      const run = await this.startRun(userId, context);
      await this.setLeadStatus(context, 'identified');
      await this.updateRun(run.id, { status: 'identified' });

      const plan = await this.chooseDiscoveryPlan(context);
      await this.updateRun(run.id, {
        status: 'discovering',
        tools_attempted: Array.from(new Set(plan.map((step) => step.tool))),
      });
      await this.setLeadStatus(context, 'discovering');

      const results = await this.executePlan(plan);
      const publicEvidence = this.toPublicEvidence(results);
      const publicIdentity = await this.buildPublicIdentity(context, publicEvidence);
      const evidence = this.buildEvidence(context, publicEvidence);
      if (!evidence.length && !context.firstInteraction) {
        await this.finishRun(run.id, 'completed', { public_evidence_count: 0 });
        return null;
      }

      const behavior = (await this.generateProfile(context, evidence)) || this.fallbackProfile(evidence);
      const result: LeadProfile = {
        leadId,
        publicIdentity,
        selectedPlatformMatches: publicIdentity.socialHandles.filter((handle) =>
          context.selectedPlatforms.includes(normalizePlatform(handle.platform))),
        evidence: publicEvidence.slice(0, 20),
        toolsAttempted: Array.from(new Set(plan.map((step) => step.tool))),
        communicationStyle: safeText(behavior.communicationStyle || 'clear and professional', 300),
        statedNeeds: cleanList(behavior.statedNeeds),
        observedPainPoints: cleanList(behavior.observedPainPoints),
        buyingSignals: cleanList(behavior.buyingSignals),
        decisionBlockers: cleanList(behavior.decisionBlockers),
        preferredTopics: cleanList(behavior.preferredTopics),
        observedTiming: {
          activeHours: Array.isArray(behavior.observedTiming?.activeHours)
            ? behavior.observedTiming.activeHours.filter((n: any) => Number.isInteger(n) && n >= 0 && n <= 23).slice(0, 8)
            : [],
          responsePattern: safeText(behavior.observedTiming?.responsePattern, 300),
        },
        recommendedTone: safeText(behavior.recommendedTone || 'helpful and concise', 300),
        confidence: Math.max(0, Math.min(1, Number(behavior.confidence) || 0.35)),
        evidenceCount: evidence.length,
        privacyScope: 'public_and_user_owned_evidence',
        generatedAt: new Date().toISOString(),
      };

      await this.saveProfile(userId, context, result);
      await this.updateRun(run.id, {
        status: 'profile_ready',
        public_evidence_count: result.evidenceCount,
        public_profile: result,
      });
      await this.setLeadStatus(context, 'profile_ready');

      let psychology: LeadPsychologyProfile | null = null;
      try {
        psychology = await this.psychologist.analyzeForLead({
          userId,
          leadId,
          publicProfile: result,
        });
      } catch (error: any) {
        console.warn(`[LeadProfileBuilder] psychology handoff skipped lead=${leadId}: ${error.message}`);
      }
      if (psychology) {
        result.psychology = psychology;
        await this.saveProfile(userId, context, result);
        await this.updateRun(run.id, { status: 'psychology_complete', public_profile: result });
        await this.setLeadStatus(context, 'psychology_complete');
      }

      await this.finishRun(run.id, 'completed', {
        public_evidence_count: result.evidenceCount,
        public_profile: result,
      });
      await this.setLeadStatus(context, 'completed');
      await pushService.notifyLeadProfileMilestone(userId, {
        leadId,
        platform: context.platform,
        status: 'completed',
        evidenceCount: result.evidenceCount,
      });
      return result;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Profile builder failed';
      console.warn(`[LeadProfileBuilder] failed lead=${leadId}: ${message}`);
      await this.markFailed(userId, leadId, message);
      return null;
    } finally {
      this.running.delete(leadId);
    }
  }

  async getLatest(userId: string, leadId: string): Promise<LeadProfile | null> {
    if (!(await featureFlags.isEnabled('lead_profile_builder', userId))) return null;
    const { data } = await this.supabase
      .from('lead_sales_profiles')
      .select('profile')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle();
    return (data?.profile as LeadProfile) || null;
  }

  private async loadContext(userId: string, leadId: string): Promise<LeadContext | null> {
    const { data: lead, error } = await this.supabase
      .from('agent_leads')
      .select('id, strategy_id, platform, platform_user_id, platform_username, first_interaction, intent_signals')
      .eq('id', leadId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`lead lookup failed: ${error.message}`);
    if (!lead) return null;

    let selectedPlatforms: string[] = [];
    if (lead.strategy_id) {
      const { data: strategy } = await this.supabase
        .from('strategies')
        .select('selected_accounts, platforms')
        .eq('id', lead.strategy_id)
        .eq('user_id', userId)
        .maybeSingle();
      selectedPlatforms = normalizeSelectedPlatforms(strategy?.selected_accounts || strategy?.platforms || []);
    }
    if (!selectedPlatforms.length && lead.platform) selectedPlatforms = [normalizePlatform(lead.platform)];
    return {
      id: lead.id,
      strategyId: lead.strategy_id || null,
      platform: normalizePlatform(lead.platform),
      platformUserId: safeText(lead.platform_user_id, 180),
      platformUsername: safeText(lead.platform_username, 180),
      firstInteraction: safeText(lead.first_interaction, 1400),
      intentSignals: lead.intent_signals || [],
      selectedPlatforms,
    };
  }

  private async chooseDiscoveryPlan(context: LeadContext): Promise<DiscoveryPlan[]> {
    const identifiers = [context.platformUsername, context.platformUserId]
      .filter((value) => value && !value.startsWith('discovery:'));
    if (!identifiers.length) return [];

    let aiPlan: any = null;
    try {
      aiPlan = await this.ai.generateJson(`Choose a minimal public-profile discovery plan for this lead.
Use only the listed tools. Select at most 6 steps and only platforms in selectedPlatforms plus web.
The tools are public web-search adapters; they do not log in, bypass access controls, enumerate private data,
or collect email addresses, phone numbers, precise locations, health, religion, race, politics, sexuality, income,
or other sensitive traits. Prefer the user's selected platforms. Return JSON array only:
[{"tool":"one listed tool","platform":"platform","query":"short query","reason":"brief reason"}]
identifiers=${JSON.stringify(identifiers)}
leadPlatform=${context.platform}
selectedPlatforms=${JSON.stringify(context.selectedPlatforms)}
allowedTools=${JSON.stringify(TOOL_NAMES)}`);
    } catch (error: any) {
      console.warn(`[LeadProfileBuilder] dynamic discovery planner unavailable: ${error.message}`);
    }

    const raw = Array.isArray(aiPlan) ? aiPlan : [];
    const allowedPlatforms = new Set(['web', ...context.selectedPlatforms]);
    const planned = raw.map((step: any) => ({
      tool: step.tool,
      platform: normalizePlatform(step.platform),
      query: safeText(step.query, 300),
      reason: safeText(step.reason, 180),
    })).filter((step: any): step is DiscoveryPlan =>
      TOOL_NAMES.includes(step.tool) &&
      allowedPlatforms.has(step.platform) &&
      Boolean(step.query) &&
      !PERSONAL_DATA_PATTERN.test(step.query),
    ).slice(0, 6);

    if (planned.length) return planned;
    const fallbackPlan: DiscoveryPlan[] = [
      {
        tool: 'platform_profile_search',
        platform: context.platform,
        query: `"${context.platformUsername || context.platformUserId}"`,
        reason: 'Search the lead platform for a public profile reference',
      },
      {
        tool: 'web_public_profile',
        platform: 'web',
        query: `"${context.platformUsername || context.platformUserId}"`,
        reason: 'Check public web references without opening a private account',
      },
    ];
    return fallbackPlan.filter((step) => Boolean(step.query));
  }

  private async executePlan(plan: DiscoveryPlan[]): Promise<ReachResult[]> {
    const results: ReachResult[] = [];
    for (const step of plan) {
      await this.waitForRateLimit();
      try {
        const found = await agentReachAdapter.search(step.platform, step.query);
        results.push(...found);
      } catch (error: any) {
        console.warn(`[LeadProfileBuilder] ${step.tool} skipped: ${error.message}`);
      }
    }
    const seen = new Set<string>();
    return results.filter((result) => {
      const key = result.url || result.externalId;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return Boolean(result.url && result.text);
    }).slice(0, 30);
  }

  private toPublicEvidence(results: ReachResult[]) {
    return results.map((result) => ({
      source: normalizePlatform(result.platform),
      url: safeText(result.url, 500),
      excerpt: safeText(result.text, 1000),
      capturedAt: result.capturedAt,
    })).filter((item) => item.url && item.excerpt && !PERSONAL_DATA_PATTERN.test(item.excerpt));
  }

  private buildEvidence(context: LeadContext, publicEvidence: Array<{ source: string; url: string; excerpt: string; capturedAt: string }>) {
    return [
      context.firstInteraction ? { source: 'user_owned_lead_signal', text: context.firstInteraction } : null,
      context.intentSignals ? { source: 'public_signal_metadata', text: safeText(JSON.stringify(context.intentSignals), 2400) } : null,
      ...publicEvidence.map((item) => ({ source: item.source, text: item.excerpt, url: item.url, capturedAt: item.capturedAt })),
    ].filter(Boolean) as any[];
  }

  private async buildPublicIdentity(context: LeadContext, evidence: Array<{ source: string; url: string; excerpt: string; capturedAt: string }>): Promise<PublicLeadIdentity> {
    let response: any = null;
    try {
      response = await this.ai.generateJson(`Extract only non-sensitive facts explicitly visible in these public search excerpts.
Do not identify a person beyond the display name shown, do not infer sensitive traits, and do not return emails,
phone numbers, addresses, profile pictures, private connections, or hidden account links. Public connections must be [].
Return exactly {"displayName":"","bio":"","interests":[],"publicConnections":[],"socialHandles":[{"platform":"","handle":"","url":"","source":""}]}.
Known lead platform: ${context.platform}
Known public username: ${context.platformUsername}
EXCERPTS: ${JSON.stringify(evidence).slice(0, 14000)}`);
    } catch (error: any) {
      console.warn(`[LeadProfileBuilder] public identity extraction unavailable: ${error.message}`);
    }
    const handles = Array.isArray(response?.socialHandles) ? response.socialHandles.map((handle: any) => ({
      platform: normalizePlatform(handle.platform),
      handle: safeText(handle.handle, 160),
      url: safeText(handle.url, 500),
      source: safeText(handle.source || 'public_search', 120),
    })).filter((handle: PublicSocialHandle) => handle.platform && handle.handle && /^https?:\/\//i.test(handle.url)).slice(0, 20) : [];
    return {
      displayName: safeText(response?.displayName || context.platformUsername, 180),
      bio: safeText(response?.bio, 600),
      interests: cleanList(response?.interests, 12),
      publicConnections: [],
      socialHandles: handles,
    };
  }

  private async generateProfile(context: LeadContext, evidence: any[]): Promise<any> {
    try {
      return await this.ai.generateJson(`Create a respectful sales preparation profile using only the observed public or user-owned evidence below.
Do not identify the person, infer health, race, religion, political views, sexuality, precise location, income, or any other sensitive trait.
Do not state guesses as facts. Use empty arrays when evidence is absent.
Return JSON with exactly: communicationStyle, statedNeeds, observedPainPoints, buyingSignals, decisionBlockers, preferredTopics,
observedTiming {"activeHours":[],"responsePattern":""}, recommendedTone, confidence.
LEAD PLATFORM: ${context.platform}
EVIDENCE: ${JSON.stringify(evidence).slice(0, 18000)}`);
    } catch (error: any) {
      console.warn(`[LeadProfileBuilder] sales profile generation unavailable: ${error.message}`);
      return null;
    }
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

  private async startRun(userId: string, context: LeadContext): Promise<{ id: string }> {
    const { data, error } = await this.supabase.from('lead_profile_builder_runs').upsert({
      user_id: userId,
      lead_id: context.id,
      strategy_id: context.strategyId,
      status: 'queued',
      selected_platforms: context.selectedPlatforms,
      tools_attempted: [],
      public_evidence_count: 0,
      public_profile: {},
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,lead_id' }).select('id').single();
    // The service role client will report a useful error when the migration has
    // not been applied; do not silently pretend enrichment completed.
    if (error || !data?.id) throw new Error(`profile builder run could not start: ${error?.message || 'missing run id'}`);
    return data;
  }

  private async updateRun(id: string, patch: Record<string, any>) {
    const { error } = await this.supabase.from('lead_profile_builder_runs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`profile run update failed: ${error.message}`);
  }

  private async finishRun(id: string, status: BuilderStatus, patch: Record<string, any>) {
    await this.updateRun(id, { ...patch, status, completed_at: new Date().toISOString() });
  }

  private async setLeadStatus(context: LeadContext, status: BuilderStatus, error?: string) {
    await this.supabase.from('agent_leads').update({
      profile_status: status,
      profile_updated_at: new Date().toISOString(),
      profile_error: error || null,
    }).eq('id', context.id);
  }

  private async saveProfile(userId: string, context: LeadContext, profile: LeadProfile) {
    const { error } = await this.supabase.from('lead_sales_profiles').upsert({
      user_id: userId,
      lead_id: context.id,
      profile,
      evidence_count: profile.evidenceCount,
      confidence_score: profile.confidence,
      privacy_scope: profile.privacyScope,
      updated_at: profile.generatedAt,
    }, { onConflict: 'user_id,lead_id' });
    if (error) throw new Error(`profile save failed: ${error.message}`);
  }

  private async markFailed(userId: string, leadId: string, message: string) {
    const safeMessage = safeText(message, 300);
    await this.supabase.from('agent_leads').update({
      profile_status: 'failed',
      profile_updated_at: new Date().toISOString(),
      profile_error: safeMessage,
    }).eq('id', leadId).eq('user_id', userId);
    await this.supabase.from('lead_profile_builder_runs').update({
      status: 'failed',
      error_message: safeMessage,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq('lead_id', leadId).eq('user_id', userId);
  }

  private async waitForRateLimit() {
    const delay = Math.max(0, 700 - (Date.now() - this.lastDiscoveryAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastDiscoveryAt = Date.now();
  }
}

export const leadProfileBuilder = new LeadProfileBuilder();