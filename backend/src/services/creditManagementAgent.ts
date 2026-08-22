/**
 * ══════════════════════════════════════════════════════════════════
 * ADROOM CREDIT MANAGEMENT AGENT (CMA) — PRODUCTION v2
 *
 * The CMA is AdRoom's internal AI cost-optimizer. It runs BEFORE
 * every AI operation and decides in real-time:
 *   • Which model to actually use (GPT-4o vs Gemini Flash)
 *   • Whether the user has headroom (daily cap + balance check)
 *   • Whether a system-level cooldown applies (intelligence cycles)
 *   • How many credits to charge (possibly cheaper than list price)
 *   • Whether to tighten spend rate based on burn velocity
 *
 * Real-time monitoring loop: every 10 minutes the CMA reviews the
 * system-wide spend velocity and dynamically adjusts economy routing
 * thresholds. Users spending fast get routed to economy models sooner.
 *
 * Savings are logged to `cma_savings_log` for admin visibility.
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

// ─── Base economy routing table ────────────────────────────────────
// Defines which operations can be routed to a cheaper model for
// lower-tier users — or when system burn rate is high.
interface EconomyRoute {
  economyModel:      string;
  economyCredits:    number;
  economyUsd:        number;
  minTierForPremium: string;
  blockedBelow?:     string;
}

const BASE_ECONOMY_ROUTING: Record<string, EconomyRoute> = {
  generate_strategy:    { economyModel: 'gemini-flash', economyCredits: 3,  economyUsd: 0.010, minTierForPremium: 'pro' },
  generate_copy:        { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'starter' },
  generate_reply:       { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'starter' },
  agent_task:           { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.003, minTierForPremium: 'pro' },
  chat:                 { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.003, minTierForPremium: 'pro' },
  geo_monitoring:       { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'pro' },
  activate_agents:      { economyModel: 'gemini-flash', economyCredits: 2,  economyUsd: 0.008, minTierForPremium: 'pro' },
  scan_product:         { economyModel: 'gemini-flash', economyCredits: 1,  economyUsd: 0.004, minTierForPremium: 'pro' },
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
  scan_product:         2 * 60,   // 2 min
};

// ─── System-level cooldowns for intelligence cycles (seconds) ─────
const SYSTEM_COOLDOWNS_SEC: Record<string, number> = {
  ipe_cycle:        13 * 60,
  social_listening: 13 * 60,
  emotional_intel:  13 * 60,
  geo_monitoring:   13 * 60,
};

// ─── Burn-rate thresholds that trigger aggressive economy routing ──
// If a user burns > X credits/hour, every qualifying operation gets
// routed to the economy model regardless of tier.
const BURN_RATE_ECONOMY_THRESHOLD = 30; // credits/hour

export type CMADecision =
  | 'allow'
  | 'allow_economy'
  | 'deny_insufficient'
  | 'deny_cap'
  | 'deny_cooldown'
  | 'deny_tier';

export interface CMAResult {
  decision:     CMADecision;
  model:        string;
  credits:      number;
  actual_usd:   number;
  savedCredits: number;
  savedUsd:     number;
  reason:       string;
}

export interface CMAStats {
  totalSavedCredits: number;
  totalSavedUsd:     number;
  byOperation:       Record<string, number>;
  events:            number;
  systemBurnRate:    number;  // credits/hour in last 1h
  economyRatio:      number;  // % of ops routed to economy
}

// In-memory cooldown + velocity trackers
const systemCooldownMap  = new Map<string, number>();            // operation → last run ms
const userCooldownMap    = new Map<string, number>();            // `${uid}:op` → last run ms
const userHourlyBurnMap  = new Map<string, number[]>();         // uid → [timestamps of deductions]
const systemHourlyCredits: number[] = [];                        // timestamps of system-level ops

// Dynamic economy override — set by selfMonitor if system burn is high
let dynamicEconomyOverride = false;

// ────────────────────────────────────────────────────────────────────────────

export class CreditManagementAgent {
  private static instance: CreditManagementAgent;
  private supabase = getServiceSupabaseClient();

  private constructor() {}

  public static getInstance(): CreditManagementAgent {
    if (!CreditManagementAgent.instance) {
      CreditManagementAgent.instance = new CreditManagementAgent();
    }
    return CreditManagementAgent.instance;
  }

  // ─── Startup init — restores persisted state from DB ──────────
  /**
   * Call once on server start. Reads the last known economy override
   * state from `cma_monitor_log` so the CMA survives server restarts.
   */
  async init(): Promise<void> {
    try {
      const { data } = await this.supabase
        .from('cma_monitor_log')
        .select('economy_override, system_burn_rate_1h, recommendation, updated_at')
        .eq('id', 'singleton')
        .single();

      if (data) {
        dynamicEconomyOverride = data.economy_override ?? false;
        console.log(`[CMA:Init] Restored state — economy_override=${dynamicEconomyOverride}, burn_rate=${data.system_burn_rate_1h}, last_updated=${data.updated_at}`);
        if (dynamicEconomyOverride) {
          console.log(`[CMA:Init] ⚠️  Economy override is ACTIVE from previous session: ${data.recommendation}`);
        }
      } else {
        // Insert the singleton row if missing (first run)
        await this.supabase.from('cma_monitor_log').upsert({
          id: 'singleton',
          system_burn_rate_1h: 0,
          system_cost_usd_1h: 0,
          economy_override: false,
          model_breakdown: {},
          recommendation: 'CMA initialised',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        console.log('[CMA:Init] First run — singleton row created');
      }
    } catch (err: any) {
      console.error('[CMA:Init] Failed to restore state:', err.message, '— starting with defaults');
    }
  }

  // ─── Main entry point ──────────────────────────────────────────
  /**
   * Called BEFORE any AI operation. Returns the routing decision
   * including the model to use, credits to charge, and any savings.
   *
   * @param userId   null for system-level operations (scheduler)
   * @param operation  key from OPERATION_COST
   */
  async evaluate(userId: string | null, operation: string): Promise<CMAResult> {
    const defaultOp = OPERATION_COST[operation] ?? OPERATION_COST['agent_task'];
    const { credits: defaultCredits, model: defaultModel, actual_usd: defaultUsd } = defaultOp;

    // ── 1. System cooldown check (scheduler cycles) ───────────────
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
      this.trackSystemOp();
      return this.allow(defaultModel, defaultCredits, defaultUsd, 0, 0, 'System operation — approved');
    }

    // ── 2. Load user tier ─────────────────────────────────────────
    const tier = await this.getUserTier(userId);

    // ── 3. Tier blocking (e.g. images are Pro-only) ────────────────
    const routing = BASE_ECONOMY_ROUTING[operation];
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

    // ── 6. Burn-rate check — high-velocity users get economy routing
    const burnRate = this.getUserBurnRate(userId);
    const highBurnUser = burnRate > BURN_RATE_ECONOMY_THRESHOLD;

    // ── 7. Model routing (economy vs premium) ─────────────────────
    const useEconomy = routing && (
      TIER_RANK[tier] < TIER_RANK[routing.minTierForPremium]
      || dynamicEconomyOverride
      || highBurnUser
    );

    if (useEconomy && routing) {
      const savedCredits = defaultCredits - routing.economyCredits;
      const savedUsd     = defaultUsd     - routing.economyUsd;

      this.markUserCooldown(userId, operation);
      this.markSystemCooldown(operation);
      this.trackUserBurn(userId);

      const reason = highBurnUser
        ? `High burn rate (${burnRate.toFixed(1)}/hr) → economy routing: ${routing.economyModel}`
        : `Economy routing: ${defaultModel} → ${routing.economyModel} (saved ${savedCredits} credits)`;

      this.logSavings(userId, operation, tier, savedCredits, savedUsd, routing.economyModel).catch(() => {});

      return this.allowEconomy(
        routing.economyModel, routing.economyCredits, routing.economyUsd,
        savedCredits, savedUsd, reason,
      );
    }

    // ── 8. Approved at full price ──────────────────────────────────
    this.markUserCooldown(userId, operation);
    this.markSystemCooldown(operation);
    this.trackUserBurn(userId);

    return this.allow(defaultModel, defaultCredits, defaultUsd, 0, 0,
      `Approved (${tier} plan, ${defaultModel}${highBurnUser ? ', high-burn override' : ''})`);
  }

  // ─── Real-time self-monitor — called by scheduler every 10 min ──
  /**
   * Analyses system-wide credit burn velocity and adjusts economy
   * routing dynamically. If the system is burning too fast, sets
   * dynamicEconomyOverride=true so ALL operations get cheaper routing.
   */
  async selfMonitor(): Promise<{
    systemBurnRate: number;
    dynamicEconomyActive: boolean;
    totalCostUsdLastHour: number;
    recommendation: string;
  }> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Pull last hour's AI usage from DB
      const { data: recentUsage } = await this.supabase
        .from('ai_usage_logs')
        .select('energy_debited, actual_cost_usd, model, operation, created_at')
        .gte('created_at', oneHourAgo);

      const rows = recentUsage ?? [];
      const totalCreditsLastHour = rows.reduce((s: number, r: any) => s + (parseFloat(r.energy_debited) || 0), 0);
      const totalCostUsdLastHour = rows.reduce((s: number, r: any) => s + (parseFloat(r.actual_cost_usd) || 0), 0);

      // Dynamic thresholds (per hour system-wide)
      const HIGH_BURN_THRESHOLD = 500;   // credits/hour system-wide → tighten
      const LOW_BURN_THRESHOLD  = 100;   // credits/hour → relax

      let recommendation = 'System nominal — standard routing active';

      if (totalCreditsLastHour > HIGH_BURN_THRESHOLD) {
        dynamicEconomyOverride = true;
        recommendation = `High system burn (${totalCreditsLastHour} credits/hr) — economy override ACTIVE. All eligible ops routed to cheap models.`;
        console.log(`[CMA:Monitor] ⚠️  ${recommendation}`);
      } else if (totalCreditsLastHour < LOW_BURN_THRESHOLD && dynamicEconomyOverride) {
        dynamicEconomyOverride = false;
        recommendation = `System burn normalised (${totalCreditsLastHour} credits/hr) — economy override RELEASED.`;
        console.log(`[CMA:Monitor] ✓ ${recommendation}`);
      }

      // Build model breakdown for logging
      const byModel: Record<string, number> = {};
      for (const r of rows) {
        byModel[r.model] = (byModel[r.model] ?? 0) + (parseFloat(r.energy_debited) || 0);
      }

      console.log(`[CMA:Monitor] Burn: ${totalCreditsLastHour.toFixed(1)} credits | $${totalCostUsdLastHour.toFixed(4)} | Models: ${JSON.stringify(byModel)}`);

      // Persist monitoring snapshot to DB
      try {
        await this.supabase.from('cma_monitor_log').upsert({
          id: 'singleton',
          system_burn_rate_1h: totalCreditsLastHour,
          system_cost_usd_1h:  totalCostUsdLastHour,
          economy_override:    dynamicEconomyOverride,
          model_breakdown:     byModel,
          recommendation,
          updated_at:          new Date().toISOString(),
        }, { onConflict: 'id' });
      } catch (_persistErr) {
        // Non-fatal — monitoring continues even if DB write fails
      }

      return {
        systemBurnRate:       totalCreditsLastHour,
        dynamicEconomyActive: dynamicEconomyOverride,
        totalCostUsdLastHour,
        recommendation,
      };
    } catch (err: any) {
      console.error('[CMA:Monitor] selfMonitor error:', err.message);
      return { systemBurnRate: 0, dynamicEconomyActive: false, totalCostUsdLastHour: 0, recommendation: 'Monitor error' };
    }
  }

  // ─── Get savings summary for admin panel ──────────────────────
  async getSavingsSummary(days = 7): Promise<CMAStats> {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const [{ data: savings }, { data: recentUsage }] = await Promise.all([
        this.supabase
          .from('cma_savings_log')
          .select('operation, tier, saved_credits, saved_usd, model_used, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(500),
        this.supabase
          .from('ai_usage_logs')
          .select('energy_debited, model')
          .gte('created_at', oneHourAgo),
      ]);

      const rows        = savings ?? [];
      const usageRows   = recentUsage ?? [];

      const totalSavedCredits = rows.reduce((s: number, r: any) => s + (r.saved_credits ?? 0), 0);
      const totalSavedUsd     = rows.reduce((s: number, r: any) => s + (r.saved_usd ?? 0), 0);
      const byOperation: Record<string, number> = {};
      for (const r of rows) {
        byOperation[r.operation] = (byOperation[r.operation] ?? 0) + (r.saved_credits ?? 0);
      }

      const systemBurnRate = usageRows.reduce((s: number, r: any) => s + (parseFloat(r.energy_debited) || 0), 0);
      const economyRows    = rows.filter((r: any) => r.saved_credits > 0).length;
      const economyRatio   = rows.length > 0 ? economyRows / rows.length : 0;

      return { totalSavedCredits, totalSavedUsd, byOperation, events: rows.length, systemBurnRate, economyRatio };
    } catch {
      return { totalSavedCredits: 0, totalSavedUsd: 0, byOperation: {}, events: 0, systemBurnRate: 0, economyRatio: 0 };
    }
  }

  // ─── Get live status ─────────────────────────────────────────
  getLiveStatus() {
    return {
      dynamicEconomyOverride,
      activeSystemCooldowns: [...systemCooldownMap.entries()].map(([op, ts]) => ({
        operation: op,
        cooldownEndsIn: Math.max(0, Math.ceil(((SYSTEM_COOLDOWNS_SEC[op] ?? 0) * 1000 - (Date.now() - ts)) / 1000)),
      })).filter(c => c.cooldownEndsIn > 0),
      trackedUsers: userCooldownMap.size,
    };
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

  // ─── Per-user burn rate (credits/hour from last hour) ──────────
  private trackUserBurn(userId: string) {
    const now = Date.now();
    const arr = userHourlyBurnMap.get(userId) ?? [];
    arr.push(now);
    // keep only last 60 min
    const filtered = arr.filter(t => now - t < 60 * 60 * 1000);
    userHourlyBurnMap.set(userId, filtered);
  }

  private getUserBurnRate(userId: string): number {
    const now = Date.now();
    const arr = userHourlyBurnMap.get(userId) ?? [];
    return arr.filter(t => now - t < 60 * 60 * 1000).length;
  }

  private trackSystemOp() {
    const now = Date.now();
    systemHourlyCredits.push(now);
    // trim entries older than 1 hour
    const cutoff = now - 60 * 60 * 1000;
    const idx = systemHourlyCredits.findIndex(t => t > cutoff);
    if (idx > 0) systemHourlyCredits.splice(0, idx);
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

      return (data ?? []).reduce((s: number, r: any) => s + (parseFloat(r.energy_debited) || 0), 0);
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
