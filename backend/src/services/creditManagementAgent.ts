/**
 * ══════════════════════════════════════════════════════════════════
 * ADROOM CREDIT MANAGEMENT AGENT (CMA)
 *
 * The CMA is AdRoom's internal cost-optimizer. Before any AI
 * operation fires, the CMA decides:
 *   • Which model to actually use (GPT-4o vs Gemini Flash)
 *   • Whether the user has headroom (daily cap + balance check)
 *   • Whether a system-level cooldown applies (intelligence cycles)
 *   • How many credits to charge (possibly cheaper than list price)
 *
 * Savings are logged to `cma_savings_log` so admins can see ROI.
 * ══════════════════════════════════════════════════════════════════
 */

import { getServiceSupabaseClient } from '../config/supabase';
import { OPERATION_COST } from './energyService';

// ─── Tier ordering ────────────────────────────────────────────────
const TIER_RANK: Record<string, number> = {
  none:     0,
  trial:    1,
  starter:  2,
  pro:      3,
  pro_plus: 4,
};

// ─── Model routing ────────────────────────────────────────────────
// Operations that CAN run on Gemini Flash when the user's tier is
// below the premium threshold. Savings = full cost - economy cost.
const ECONOMY_ROUTING: Record<string, {
  economyModel:  string;
  economyCredits: number;
  economyUsd:    number;
  minTierForPremium: string; // tier at or above this gets the default model
  blockedBelow?: string;    // tier below this gets denied entirely
}> = {
  generate_strategy:    { economyModel: 'gemini-flash', economyCredits: 3,  economyUsd: 0.010, minTierForPremium: 'pro' },
  generate_copy:        { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'starter' },
  generate_reply:       { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'starter' },
  agent_task:           { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.003, minTierForPremium: 'pro' },
  chat:                 { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.003, minTierForPremium: 'pro' },
  geo_monitoring:       { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'pro' },
  activate_agents:      { economyModel: 'gemini-flash', economyCredits: 2,  economyUsd: 0.008, minTierForPremium: 'pro' },
  generate_image:       { economyModel: 'imagen-3',     economyCredits: 4,  economyUsd: 0.036, minTierForPremium: 'pro',      blockedBelow: 'pro' },
  generate_video_asset: { economyModel: 'imagen-3',     economyCredits: 6,  economyUsd: 0.054, minTierForPremium: 'pro_plus', blockedBelow: 'pro_plus' },
};

// ─── Daily credit caps by tier ────────────────────────────────────
const DAILY_CAPS: Record<string, number> = {
  none:     10,
  trial:    20,
  starter:  50,
  pro:      250,
  pro_plus: Infinity,
};

// ─── Per-user operation cooldowns (seconds) ────────────────────────
const USER_COOLDOWNS_SEC: Record<string, number> = {
  generate_strategy:    5 * 60,   // 5 min
  generate_image:       3 * 60,   // 3 min
  generate_video_asset: 5 * 60,   // 5 min
  activate_agents:      10 * 60,  // 10 min
};

// ─── System-level cooldowns for intelligence cycles (seconds) ─────
const SYSTEM_COOLDOWNS_SEC: Record<string, number> = {
  ipe_cycle:       13 * 60,   // 13 min (scheduler fires every 15 min)
  social_listening: 13 * 60,
  emotional_intel: 13 * 60,
  geo_monitoring:  13 * 60,
};

export type CMADecision = 'allow' | 'allow_economy' | 'deny_insufficient' | 'deny_cap' | 'deny_cooldown' | 'deny_tier';

export interface CMAResult {
  decision:      CMADecision;
  model:         string;
  credits:       number;
  actual_usd:    number;
  savedCredits:  number;
  savedUsd:      number;
  reason:        string;
}

// In-memory cooldown tracker: key → last-run timestamp (ms)
const systemCooldownMap   = new Map<string, number>();
const userCooldownMap     = new Map<string, number>(); // `${userId}:${operation}` → ms

export class CreditManagementAgent {
  private static instance: CreditManagementAgent;
  private supabase = getServiceSupabaseClient();

  private constructor() {}
  public static getInstance(): CreditManagementAgent {
    if (!CreditManagementAgent.instance) CreditManagementAgent.instance = new CreditManagementAgent();
    return CreditManagementAgent.instance;
  }

  // ─── Main entry point ──────────────────────────────────────────
  /**
   * Called BEFORE any AI operation. Returns the routing decision
   * including the model to use, credits to charge, and any savings.
   *
   * @param userId   null for system-level operations (scheduler)
   * @param operation  one of the OPERATION_COST keys
   */
  async evaluate(userId: string | null, operation: string): Promise<CMAResult> {
    const defaultOp = OPERATION_COST[operation] ?? OPERATION_COST['agent_task'];
    const defaultCredits = defaultOp.credits;
    const defaultModel   = defaultOp.model;
    const defaultUsd     = defaultOp.actual_usd;

    // ── 1. System cooldown check (no user needed) ─────────────────
    const sysCooldown = SYSTEM_COOLDOWNS_SEC[operation];
    if (sysCooldown !== undefined) {
      const last = systemCooldownMap.get(operation) ?? 0;
      const elapsed = (Date.now() - last) / 1000;
      if (elapsed < sysCooldown) {
        const remaining = Math.ceil(sysCooldown - elapsed);
        return this.deny('deny_cooldown', defaultModel, defaultCredits, defaultUsd,
          `System cooldown: ${remaining}s remaining for ${operation}`);
      }
    }

    // System-level operations (no user = skip per-user checks)
    if (!userId) {
      this.markSystemCooldown(operation);
      return this.allow(defaultModel, defaultCredits, defaultUsd, 0, 0,
        'System operation — approved');
    }

    // ── 2. Load user tier ─────────────────────────────────────────
    const tier = await this.getUserTier(userId);

    // ── 3. Tier blocking (e.g. images are Pro-only) ────────────────
    const routing = ECONOMY_ROUTING[operation];
    if (routing?.blockedBelow && TIER_RANK[tier] < TIER_RANK[routing.blockedBelow]) {
      return this.deny('deny_tier', defaultModel, defaultCredits, defaultUsd,
        `${operation} requires ${routing.blockedBelow} plan (user has: ${tier})`);
    }

    // ── 4. Daily cap check ─────────────────────────────────────────
    const cap = DAILY_CAPS[tier] ?? DAILY_CAPS['none'];
    if (cap !== Infinity) {
      const todayUsage = await this.getTodayUsage(userId);
      const needed = routing && TIER_RANK[tier] < TIER_RANK[routing.minTierForPremium]
        ? routing.economyCredits
        : defaultCredits;
      if (todayUsage + needed > cap) {
        return this.deny('deny_cap', defaultModel, defaultCredits, defaultUsd,
          `Daily cap reached: ${todayUsage}/${cap} credits used today (${tier} plan)`);
      }
    }

    // ── 5. Per-user cooldown ───────────────────────────────────────
    const userCooldownSec = USER_COOLDOWNS_SEC[operation];
    if (userCooldownSec) {
      const key = `${userId}:${operation}`;
      const last = userCooldownMap.get(key) ?? 0;
      const elapsed = (Date.now() - last) / 1000;
      if (elapsed < userCooldownSec) {
        const remaining = Math.ceil(userCooldownSec - elapsed);
        return this.deny('deny_cooldown', defaultModel, defaultCredits, defaultUsd,
          `User cooldown: ${remaining}s remaining for ${operation}`);
      }
    }

    // ── 6. Model routing (economy vs premium) ─────────────────────
    if (routing && TIER_RANK[tier] < TIER_RANK[routing.minTierForPremium]) {
      const savedCredits = defaultCredits - routing.economyCredits;
      const savedUsd     = defaultUsd - routing.economyUsd;

      this.markUserCooldown(userId, operation);
      this.markSystemCooldown(operation);

      // Log savings asynchronously
      this.logSavings(userId, operation, tier, savedCredits, savedUsd, routing.economyModel).catch(() => {});

      return this.allowEconomy(routing.economyModel, routing.economyCredits, routing.economyUsd,
        savedCredits, savedUsd,
        `Economy routing: ${defaultModel} → ${routing.economyModel} (saved ${savedCredits} credits)`);
    }

    // ── 7. Approved at full price ──────────────────────────────────
    this.markUserCooldown(userId, operation);
    this.markSystemCooldown(operation);

    return this.allow(defaultModel, defaultCredits, defaultUsd, 0, 0,
      `Approved (${tier} plan, ${defaultModel})`);
  }

  // ─── Record that a system operation just ran ──────────────────
  private markSystemCooldown(operation: string) {
    if (SYSTEM_COOLDOWNS_SEC[operation] !== undefined) {
      systemCooldownMap.set(operation, Date.now());
    }
  }

  private markUserCooldown(userId: string, operation: string) {
    if (USER_COOLDOWNS_SEC[operation] !== undefined) {
      userCooldownMap.set(`${userId}:${operation}`, Date.now());
    }
  }

  // ─── Tier resolution ──────────────────────────────────────────
  private async getUserTier(userId: string): Promise<string> {
    try {
      const { data: sub } = await this.supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', userId)
        .single();

      if (!sub || sub.status !== 'active') return 'none';
      return sub.plan ?? 'none';
    } catch {
      return 'none';
    }
  }

  // ─── Daily credit usage from ai_usage_logs ─────────────────────
  private async getTodayUsage(userId: string): Promise<number> {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data } = await this.supabase
        .from('ai_usage_logs')
        .select('energy_debited')
        .eq('user_id', userId)
        .gte('created_at', startOfDay.toISOString());

      return (data ?? []).reduce((sum: number, row: any) => sum + (parseFloat(row.energy_debited) || 0), 0);
    } catch {
      return 0;
    }
  }

  // ─── Savings logging ──────────────────────────────────────────
  private async logSavings(
    userId: string, operation: string, tier: string,
    savedCredits: number, savedUsd: number, usedModel: string,
  ) {
    try {
      await this.supabase.from('cma_savings_log').insert({
        user_id:       userId,
        operation,
        tier,
        saved_credits: savedCredits,
        saved_usd:     savedUsd,
        model_used:    usedModel,
        created_at:    new Date().toISOString(),
      });
    } catch {}
  }

  // ─── Get savings summary for admin panel ──────────────────────
  async getSavingsSummary(days = 7) {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await this.supabase
        .from('cma_savings_log')
        .select('operation, tier, saved_credits, saved_usd, model_used, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500);

      const rows = data ?? [];
      const totalSavedCredits = rows.reduce((s: number, r: any) => s + (r.saved_credits ?? 0), 0);
      const totalSavedUsd     = rows.reduce((s: number, r: any) => s + (r.saved_usd ?? 0), 0);
      const byOperation: Record<string, number> = {};
      for (const r of rows) {
        byOperation[r.operation] = (byOperation[r.operation] ?? 0) + (r.saved_credits ?? 0);
      }

      return { totalSavedCredits, totalSavedUsd, byOperation, events: rows.length };
    } catch {
      return { totalSavedCredits: 0, totalSavedUsd: 0, byOperation: {}, events: 0 };
    }
  }

  // ─── Response builders ────────────────────────────────────────
  private allow(model: string, credits: number, usd: number, saved: number, savedUsd: number, reason: string): CMAResult {
    return { decision: 'allow', model, credits, actual_usd: usd, savedCredits: saved, savedUsd, reason };
  }
  private allowEconomy(model: string, credits: number, usd: number, saved: number, savedUsd: number, reason: string): CMAResult {
    return { decision: 'allow_economy', model, credits, actual_usd: usd, savedCredits: saved, savedUsd, reason };
  }
  private deny(decision: Exclude<CMADecision, 'allow' | 'allow_economy'>, model: string, credits: number, usd: number, reason: string): CMAResult {
    return { decision, model, credits, actual_usd: usd, savedCredits: 0, savedUsd: 0, reason };
  }
}

export const creditManagementAgent = CreditManagementAgent.getInstance();
