import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { agentReachAdapter, type ReachResult } from './agentReachAdapter';
import { normalizePlatform, normalizeSelectedPlatforms } from './platformIdentity';
import * as featureFlags from './featureFlagService';
import { pushService } from './pushService';
import { PsychologistEngine, type LeadPsychologyProfile } from './psychologistEngine';
import { type PublicProfileTool } from './publicProfileToolAdapters';

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
  tool: PublicProfileTool;
  platform: string;
  query: string;
  reason: string;
}

interface LeadContext {
  userId: string;
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
  'helix_public_username',
  'osintgraph_public_instagram',
  'jarvis_public_research',
  'reddeye_public_reddit',
  'platform_profile_search',
  'web_public_profile',
] as const;

const PERSONAL_DATA_PATTERN = /(?:\b(?:email|e-mail|phone|telephone|mobile|address|dob|date of birth|income|salary|religion|race|ethnicity|sexuality|political|health|diagnos|password|token|secret|api key)\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{7,}\d)/i;

function safeText(value: unknown, max = 1200): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safePublicUrl(value: unknown): string {
  const candidate = safeText(value, 500);
  if (!/^https?:\/\//i.test(candidate) || PERSONAL_DATA_PATTERN.test(candidate)) return '';
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function logBuilderActivity(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[LeadProfileBuilder] ${JSON.stringify({
    event,
    at: new Date().toISOString(),
    ...fields,
  })}`);
}

function safeActivityError(error: unknown): string {
  return safeText(error instanceof Error ? error.message : error, 400)
    .replace(/https?:\/\/[^/\s:@]+(?::[^/\s@]*)?@/gi, 'https://[redacted]@')
    .replace(PERSONAL_DATA_PATTERN, '[redacted]');
}

function cleanList(value: unknown, maxItems = 12): string[] {
  return Array.isArray(value)
    ? value.map((item) => safeText(item, 180))
      .filter((item) => Boolean(item) && !PERSONAL_DATA_PATTERN.test(item))
      .slice(0, maxItems)
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

  async enqueueForLead(userId: string, leadId: string): Promise<boolean> {
    const context = await this.loadContext(userId, leadId);
    if (!context) return false;
    const { data: existing } = await this.supabase
      .from('lead_profile_builder_runs')
      .select('status, updated_at')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle();
    if (existing && ['queued', 'identified', 'discovering', 'profile_ready', 'psychology_complete'].includes(existing.status)) {
      logBuilderActivity('queue_reused', {
        userId,
        leadId,
        status: existing.status,
      });
      return true;
    }
    const { error } = await this.supabase.from('lead_profile_builder_runs').upsert({
      user_id: userId,
      lead_id: leadId,
      strategy_id: context.strategyId,
      status: 'queued',
      selected_platforms: context.selectedPlatforms,
      tools_attempted: [],
      public_evidence_count: 0,
      public_profile: {},
      error_message: null,
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      claimed_at: null,
      started_at: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,lead_id' });
    if (error) throw new Error(`profile builder queue failed: ${error.message}`);
    logBuilderActivity('lead_queued', {
      userId,
      leadId,
      strategyId: context.strategyId,
      selectedPlatformCount: context.selectedPlatforms.length,
    });
    await this.setLeadStatus(context, 'queued');
    return true;
  }

  async processQueued(limit = 8): Promise<number> {
    const now = new Date().toISOString();
    const { data: runs, error } = await this.supabase
      .from('lead_profile_builder_runs')
      .select('user_id, lead_id, status, attempt_count')
      .in('status', ['queued', 'failed'])
      .lte('next_attempt_at', now)
      .order('updated_at', { ascending: true })
      .limit(Math.max(1, Math.min(limit, 20)));
    if (error) throw new Error(`profile builder queue lookup failed: ${error.message}`);
    logBuilderActivity('queue_polled', {
      dueCount: runs?.length || 0,
      requestedLimit: limit,
    });
    let processed = 0;
    for (const run of runs || []) {
      if (this.running.has(run.lead_id)) continue;
      if (!(await featureFlags.isEnabled('lead_profile_builder', run.user_id))) continue;
      const { data: claimed, error: claimError } = await this.supabase.from('lead_profile_builder_runs').update({
        status: 'identified',
        claimed_at: new Date().toISOString(),
        attempt_count: Number(run.attempt_count || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('user_id', run.user_id).eq('lead_id', run.lead_id).in('status', ['queued', 'failed']).select('lead_id');
      if (claimError) {
        console.warn(`[LeadProfileBuilder] unable to claim lead=${run.lead_id}: ${claimError.message}`);
        logBuilderActivity('claim_failed', {
          userId: run.user_id,
          leadId: run.lead_id,
          error: safeActivityError(claimError.message),
        });
        continue;
      }
      if (!claimed?.length) {
        logBuilderActivity('claim_lost', { userId: run.user_id, leadId: run.lead_id });
        continue;
      }
      logBuilderActivity('lead_claimed', {
        userId: run.user_id,
        leadId: run.lead_id,
        attemptCount: Number(run.attempt_count || 0) + 1,
      });
      await this.buildForLead(run.user_id, run.lead_id);
      processed++;
    }
    return processed;
  }

  async buildForLead(userId: string, leadId: string): Promise<LeadProfile | null> {
    const enabled = await featureFlags.isEnabled('lead_profile_builder', userId);
    if (!enabled || this.running.has(leadId)) return null;
    this.running.add(leadId);
    const startedAt = Date.now();
    logBuilderActivity('build_started', { userId, leadId });

    try {
      const context = await this.loadContext(userId, leadId);
      if (!context) {
        logBuilderActivity('build_skipped', { userId, leadId, reason: 'lead_not_found' });
        return null;
      }

      const run = await this.startRun(userId, context);
      logBuilderActivity('run_started', { userId, leadId, runId: run.id });
      await this.setLeadStatus(context, 'identified');
      await this.updateRun(run.id, { status: 'identified' });

      const plan = await this.chooseDiscoveryPlan(context);
      logBuilderActivity('discovery_plan_selected', {
        userId,
        leadId,
        runId: run.id,
        stepCount: plan.length,
        tools: Array.from(new Set(plan.map((step) => step.tool))),
      });
      await this.updateRun(run.id, {
        status: 'discovering',
        tools_attempted: Array.from(new Set(plan.map((step) => step.tool))),
      });
      await this.setLeadStatus(context, 'discovering');

      const results = await this.executePlan(plan);
      const publicEvidence = this.toPublicEvidence(results);
      logBuilderActivity('discovery_complete', {
        userId,
        leadId,
        runId: run.id,
        resultCount: results.length,
        evidenceCount: publicEvidence.length,
      });
      const publicIdentity = await this.buildPublicIdentity(context, publicEvidence);
      const evidence = this.buildEvidence(context, publicEvidence);
      if (!evidence.length && !context.firstInteraction) {
        await this.finishRun(run.id, 'completed', { public_evidence_count: 0 });
        await this.setLeadStatus(context, 'completed');
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
      logBuilderActivity('profile_persisted', {
        userId,
        leadId,
        runId: run.id,
        evidenceCount: result.evidenceCount,
        confidence: result.confidence,
      });
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
        logBuilderActivity('psychology_complete', { userId, leadId, runId: run.id });
        await this.saveProfile(userId, context, result);
        await this.updateRun(run.id, { status: 'psychology_complete', public_profile: result });
        await this.setLeadStatus(context, 'psychology_complete');
      }

      await this.finishRun(run.id, 'completed', {
        public_evidence_count: result.evidenceCount,
        public_profile: result,
      });
      await this.setLeadStatus(context, 'completed');
      logBuilderActivity('build_completed', {
        userId,
        leadId,
        runId: run.id,
        evidenceCount: result.evidenceCount,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Profile builder failed';
      console.warn(`[LeadProfileBuilder] failed lead=${leadId}: ${message}`);
      logBuilderActivity('build_failed', {
        userId,
        leadId,
        error: safeActivityError(error),
        durationMs: Date.now() - startedAt,
      });
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

  async logMigrationReadiness(): Promise<void> {
    const checks = await Promise.all([
      this.supabase.from('agent_leads').select('profile_status').limit(1),
      this.supabase.from('lead_profile_builder_runs').select('id').limit(1),
      this.supabase.from('lead_sales_profiles').select('id').limit(1),
    ]);
    const names = ['agent_leads.profile_status', 'lead_profile_builder_runs', 'lead_sales_profiles'];
    const missing = checks
      .map((check, index) => check.error ? names[index] : null)
      .filter((name): name is string => Boolean(name));
    logBuilderActivity('migration_readiness', {
      ready: missing.length === 0,
      missing,
    });
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
      userId,
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
    const identifiers = [context.platformUsername]
      .filter((value) => value && !PERSONAL_DATA_PATTERN.test(value) && !value.startsWith('discovery:'));
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
        tool: 'maigret_public_username',
        platform: 'web',
        query: context.platformUsername,
        reason: 'Check public username references across the pinned Maigret site database',
      },
      {
        tool: 'helix_public_username',
        platform: 'web',
        query: context.platformUsername,
        reason: 'Use the pinned Helix username interface when its runtime is available',
      },
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
       const found = await agentReachAdapter.search(step.platform, step.query, step.tool);
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
      url: safePublicUrl(result.url),
      excerpt: safeText(result.text, 1000),
      capturedAt: result.capturedAt,
    })).filter((item) =>
      item.url &&
      item.excerpt &&
      !PERSONAL_DATA_PATTERN.test(item.excerpt) &&
      !PERSONAL_DATA_PATTERN.test(item.source),
    );
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
      url: safePublicUrl(handle.url),
      source: safeText(handle.source || 'public_search', 120),
    })).filter((handle: PublicSocialHandle) =>
      handle.platform &&
      handle.handle &&
      !PERSONAL_DATA_PATTERN.test(handle.handle) &&
      Boolean(handle.url),
    ).slice(0, 20) : [];
    return {
      displayName: safeText(response?.displayName || context.platformUsername, 180).replace(PERSONAL_DATA_PATTERN, ''),
      bio: PERSONAL_DATA_PATTERN.test(safeText(response?.bio, 600)) ? '' : safeText(response?.bio, 600),
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
    const { error: updateError } = await this.supabase.from('agent_leads').update({
      profile_status: status,
      profile_updated_at: new Date().toISOString(),
      profile_error: error || null,
    }).eq('id', context.id);
    if (updateError) throw new Error(`lead profile status update failed: ${updateError.message}`);
    logBuilderActivity('lead_status_updated', {
      userId: context.userId,
      leadId: context.id,
      status,
      ...(error ? { hasError: true } : {}),
    });
    if (['profile_ready', 'psychology_complete', 'completed'].includes(status)) {
      await pushService.notifyLeadProfileMilestone(context.userId, {
        leadId: context.id,
        platform: context.platform,
        status,
        evidenceCount: 0,
      }).catch((notificationError) => {
        logBuilderActivity('milestone_notification_failed', {
          userId: context.userId,
          leadId: context.id,
          status,
          error: safeActivityError(notificationError),
        });
      });
    }
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
    const { data: currentRun } = await this.supabase
      .from('lead_profile_builder_runs')
      .select('attempt_count')
      .eq('lead_id', leadId)
      .eq('user_id', userId)
      .maybeSingle();
    const attemptCount = Number(currentRun?.attempt_count || 1);
    const retryAt = new Date(
      Date.now() + (attemptCount >= 3
        ? 7 * 24 * 60 * 60 * 1000
        : Math.min(60 * 60 * 1000, 2 ** Math.min(attemptCount, 6) * 60_000)),
    ).toISOString();
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
      next_attempt_at: retryAt,
    }).eq('lead_id', leadId).eq('user_id', userId);
    logBuilderActivity('retry_scheduled', {
      userId,
      leadId,
      attemptCount,
      retryAt,
    });
    const context = await this.loadContext(userId, leadId).catch(() => null);
    if (context) {
      await pushService.notifyLeadProfileMilestone(userId, {
        leadId,
        platform: context.platform,
        status: 'failed',
        evidenceCount: 0,
      }).catch(() => undefined);
    }
  }

  private async waitForRateLimit() {
    const delay = Math.max(0, 700 - (Date.now() - this.lastDiscoveryAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastDiscoveryAt = Date.now();
  }
}

export const leadProfileBuilder = new LeadProfileBuilder();