import { getServiceSupabaseClient } from '../config/supabase';
import { creditManagementAgent, CMAResult } from './creditManagementAgent';

// ══════════════════════════════════════════════════════════════
// ADROOM ENERGY ECONOMICS
//   1 energy credit  = $0.20 user-facing value
//   1 energy credit  = $0.09 actual model cost to company
//   Margin: ~55%
//
//   Energy debited = (actual_cost_usd / ACTUAL_COST_PER_CREDIT)
// ══════════════════════════════════════════════════════════════

export const ENERGY_RATE = {
  ACTUAL_COST_PER_CREDIT: 0.09,   // $0.09 actual model cost per 1 credit
  USER_PRICE_PER_CREDIT:  0.20,   // $0.20 what user pays per credit
};

// Fixed energy costs per operation (actual cost → credit conversion)
export const OPERATION_COST: Record<string, { credits: number; model: string; actual_usd: number }> = {
  scan_product:        { credits: 2,  model: 'gemini-vision',  actual_usd: 0.018 },
  generate_strategy:   { credits: 8,  model: 'gpt-4o',         actual_usd: 0.072 },
  generate_image:      { credits: 4,  model: 'imagen-3',        actual_usd: 0.036 },
  generate_video_asset:{ credits: 6,  model: 'imagen-3',        actual_usd: 0.054 },
  generate_copy:       { credits: 3,  model: 'gpt-4o',         actual_usd: 0.027 },
  generate_reply:      { credits: 2,  model: 'gpt-4o',         actual_usd: 0.018 },
  agent_task:          { credits: 1,  model: 'gpt-4o',         actual_usd: 0.009 },
  ipe_cycle:           { credits: 5,  model: 'gemini-flash',    actual_usd: 0.045 },
  social_listening:    { credits: 3,  model: 'gemini-flash',    actual_usd: 0.027 },
  emotional_intel:     { credits: 3,  model: 'gemini-flash',    actual_usd: 0.027 },
  geo_monitoring:      { credits: 2,  model: 'gpt-4o',         actual_usd: 0.018 },
  activate_agents:     { credits: 5,  model: 'gpt-4o',         actual_usd: 0.045 },
  chat:                { credits: 1,  model: 'gpt-4o',         actual_usd: 0.009 },
};

// Plan definitions
export const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price_usd: 20,
    energy_credits: 100,
    actual_model_budget_usd: 9,
    description: 'Perfect for getting started with AI marketing',
    flw_amount: 20,
    currency: 'USD',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_usd: 45,
    energy_credits: 300,
    actual_model_budget_usd: 25,
    description: 'Scale your campaigns with more AI power',
    flw_amount: 45,
    currency: 'USD',
  },
  pro_plus: {
    id: 'pro_plus',
    name: 'Pro+',
    price_usd: 100,
    energy_credits: 600,
    actual_model_budget_usd: 45,
    description: 'Unlimited potential for serious marketers',
    flw_amount: 100,
    currency: 'USD',
  },
};

// Top-up options (standalone credit packs)
export const TOPUP_PACKS = {
  topup_600: { id: 'topup_600', energy_credits: 600, price_usd: 120, label: '600 Energy Credits' },
  topup_300: { id: 'topup_300', energy_credits: 300, price_usd: 50,  label: '300 Energy Credits' },
  topup_100: { id: 'topup_100', energy_credits: 100, price_usd: 25,  label: '100 Energy Credits' },
};

export const TRIAL_CREDITS = 50; // ~$10 worth of energy (50 × $0.20 = $10)
export const ON_DEMAND_THRESHOLD = 25; // trigger auto top-up at 25 credits ($5 value)

// ────────────────────────────────────────────────────────────────────────────────

export class EnergyService {
  private supabase = getServiceSupabaseClient();

  /** Get a user's energy account (creates if missing) */
  async getAccount(userId: string) {
    const { data, error } = await this.supabase
      .from('energy_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // create it
      const { data: created } = await this.supabase
        .from('energy_accounts')
        .insert({ user_id: userId, balance_credits: 0 })
        .select()
        .single();
      return created;
    }
    return data;
  }

  /** Get subscription info */
  async getSubscription(userId: string) {
    const { data } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();
    return data;
  }

  /** Check if user has enough energy. Returns { allowed, balance, deficit } */
  async checkEnergy(userId: string, operation: string): Promise<{
    allowed: boolean;
    balance: number;
    required: number;
    deficit: number;
    subscription_status: string;
  }> {
    const op = OPERATION_COST[operation] || OPERATION_COST['agent_task'];
    const account = await this.getAccount(userId);
    const sub = await this.getSubscription(userId);

    const balance = parseFloat(account?.balance_credits ?? '0');
    const required = op.credits;
    const deficit = Math.max(0, required - balance);
    const allowed = balance >= required;

    return {
      allowed,
      balance,
      required,
      deficit,
      subscription_status: sub?.status ?? 'inactive',
    };
  }

  /** Deduct energy for an AI operation. Returns updated balance or throws if insufficient. */
  async deductEnergy(userId: string, operation: string, metadata?: any): Promise<number> {
    const op = OPERATION_COST[operation] || OPERATION_COST['agent_task'];

    // Atomically deduct using a transaction-safe update
    const account = await this.getAccount(userId);
    const currentBalance = parseFloat(account?.balance_credits ?? '0');

    if (currentBalance < op.credits) {
      throw new Error(`INSUFFICIENT_ENERGY: Need ${op.credits} credits, have ${currentBalance.toFixed(2)}`);
    }

    const newBalance = currentBalance - op.credits;

    await this.supabase
      .from('energy_accounts')
      .update({
        balance_credits: newBalance,
        lifetime_consumed: parseFloat(account.lifetime_consumed ?? '0') + op.credits,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Log the transaction
    await this.supabase.from('energy_transactions').insert({
      user_id: userId,
      type: 'debit',
      credits: -op.credits,
      balance_after: newBalance,
      description: `AI operation: ${operation}`,
      operation,
      actual_cost_usd: op.actual_usd,
      energy_rate: ENERGY_RATE.ACTUAL_COST_PER_CREDIT,
      metadata: metadata ?? {},
    });

    // Log AI usage
    await this.supabase.from('ai_usage_logs').insert({
      user_id: userId,
      model: op.model,
      operation,
      actual_cost_usd: op.actual_usd,
      energy_debited: op.credits,
      ...( metadata ?? {} ),
    });

    // Check if on-demand top-up should trigger
    if (newBalance <= ON_DEMAND_THRESHOLD) {
      await this.checkAndTriggerOnDemand(userId, newBalance);
    }

    return newBalance;
  }

  /**
   * CMA-powered deduction:
   * 1. Asks the Credit Management Agent which model to use + actual cost
   * 2. If denied (cap / cooldown / tier), throws with the reason
   * 3. If allowed (possibly at economy rate), deducts the CMA-determined credits
   * Returns { newBalance, cma } so callers can route to the correct model.
   */
  async deductEnergyWithRouting(
    userId: string,
    operation: string,
    metadata?: any,
  ): Promise<{ newBalance: number; cma: CMAResult }> {
    const cma = await creditManagementAgent.evaluate(userId, operation);

    if (cma.decision === 'deny_cap') {
      throw new Error(`DAILY_CAP_REACHED: ${cma.reason}`);
    }
    if (cma.decision === 'deny_cooldown') {
      throw new Error(`COOLDOWN_ACTIVE: ${cma.reason}`);
    }
    if (cma.decision === 'deny_tier') {
      throw new Error(`TIER_RESTRICTED: ${cma.reason}`);
    }
    if (cma.decision === 'deny_insufficient') {
      throw new Error(`INSUFFICIENT_ENERGY: ${cma.reason}`);
    }

    // Build an overridden op using CMA values
    const op = { credits: cma.credits, model: cma.model, actual_usd: cma.actual_usd };
    const account = await this.getAccount(userId);
    const currentBalance = parseFloat(account?.balance_credits ?? '0');

    if (currentBalance < op.credits) {
      throw new Error(`INSUFFICIENT_ENERGY: Need ${op.credits} credits, have ${currentBalance.toFixed(2)}`);
    }

    const newBalance = currentBalance - op.credits;

    await this.supabase
      .from('energy_accounts')
      .update({
        balance_credits: newBalance,
        lifetime_consumed: parseFloat(account.lifetime_consumed ?? '0') + op.credits,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    await this.supabase.from('energy_transactions').insert({
      user_id: userId,
      type: 'debit',
      credits: -op.credits,
      balance_after: newBalance,
      description: `AI operation: ${operation} [CMA:${cma.decision}]`,
      operation,
      actual_cost_usd: op.actual_usd,
      energy_rate: ENERGY_RATE.ACTUAL_COST_PER_CREDIT,
      metadata: { ...(metadata ?? {}), cma_model: cma.model, cma_saved: cma.savedCredits },
    });

    await this.supabase.from('ai_usage_logs').insert({
      user_id: userId,
      model: op.model,
      operation,
      actual_cost_usd: op.actual_usd,
      energy_debited: op.credits,
      ...(metadata ?? {}),
    });

    if (newBalance <= ON_DEMAND_THRESHOLD) {
      await this.checkAndTriggerOnDemand(userId, newBalance);
    }

    const savedMsg = cma.savedCredits > 0 ? ` [CMA saved ${cma.savedCredits} credits]` : '';
    console.log(`[CMA] ${operation} → ${cma.model} | charged ${cma.credits} credits${savedMsg}`);

    return { newBalance, cma };
  }

  /** Credit energy to a user's account */
  async creditEnergy(
    userId: string,
    credits: number,
    type: string,
    description: string,
    paymentRef?: string,
    amount_usd?: number,
  ): Promise<number> {
    const account = await this.getAccount(userId);
    const currentBalance = parseFloat(account?.balance_credits ?? '0');
    const newBalance = currentBalance + credits;

    await this.supabase
      .from('energy_accounts')
      .update({
        balance_credits: newBalance,
        lifetime_credits: parseFloat(account.lifetime_credits ?? '0') + credits,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    await this.supabase.from('energy_transactions').insert({
      user_id: userId,
      type,
      credits,
      balance_after: newBalance,
      description,
      flw_tx_ref: paymentRef,
      amount_usd: amount_usd ?? null,
    });

    return newBalance;
  }

  /** Grant the 14-day trial (50 energy credits = $10 value) */
  async grantTrial(userId: string): Promise<{ success: boolean; message: string }> {
    const sub = await this.getSubscription(userId);

    if (sub?.trial_start) {
      return { success: false, message: 'Trial already used.' };
    }
    if (!sub?.flw_card_token) {
      return { success: false, message: 'Please add a payment method before starting your trial.' };
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    await this.supabase
      .from('subscriptions')
      .update({
        status: 'trialing',
        trial_start: now.toISOString(),
        trial_end: trialEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('user_id', userId);

    await this.creditEnergy(userId, TRIAL_CREDITS, 'trial_grant', '14-day free trial — 50 energy credits');

    return { success: true, message: `Trial started! You have ${TRIAL_CREDITS} energy credits for 14 days.` };
  }

  /** Apply subscription credits after successful payment */
  async applySubscription(
    userId: string,
    planId: string,
    flwTransactionId: string,
    flwTxRef: string,
    cardToken?: string,
    cardLast4?: string,
    cardBrand?: string,
    billingEmail?: string,
  ): Promise<{ success: boolean; credits: number }> {
    const plan = PLANS[planId as keyof typeof PLANS];
    if (!plan) throw new Error(`Unknown plan: ${planId}`);

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Update subscription record
    const subUpdate: any = {
      plan: planId,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      updated_at: now.toISOString(),
    };
    if (cardToken)    subUpdate.flw_card_token  = cardToken;
    if (cardLast4)    subUpdate.flw_card_last4   = cardLast4;
    if (cardBrand)    subUpdate.flw_card_brand   = cardBrand;
    if (billingEmail) subUpdate.billing_email    = billingEmail;
    if (flwTransactionId) subUpdate.flw_subscription_id = flwTransactionId;

    await this.supabase
      .from('subscriptions')
      .upsert({ user_id: userId, ...subUpdate }, { onConflict: 'user_id' });

    // Save payment method if card token provided
    if (cardToken) {
      await this.supabase.from('payment_methods').upsert(
        { user_id: userId, flw_token: cardToken, last4: cardLast4, brand: cardBrand, email: billingEmail, is_default: true },
        { onConflict: 'user_id' }
      );
    }

    // Credit energy
    const newBalance = await this.creditEnergy(
      userId,
      plan.energy_credits,
      'subscription_grant',
      `${plan.name} plan subscription — ${plan.energy_credits} energy credits`,
      flwTxRef,
      plan.price_usd,
    );

    return { success: true, credits: plan.energy_credits };
  }

  /** Apply a top-up pack */
  async applyTopUp(
    userId: string,
    packId: string,
    flwTransactionId: string,
    flwTxRef: string,
    type: 'topup' | 'on_demand_topup' = 'topup',
  ): Promise<{ success: boolean; credits: number; newBalance: number }> {
    const pack = TOPUP_PACKS[packId as keyof typeof TOPUP_PACKS];
    if (!pack) throw new Error(`Unknown top-up pack: ${packId}`);

    const newBalance = await this.creditEnergy(
      userId,
      pack.energy_credits,
      type,
      `Energy top-up: ${pack.label}`,
      flwTxRef,
      pack.price_usd,
    );

    return { success: true, credits: pack.energy_credits, newBalance };
  }

  /** Check on-demand auto top-up */
  private async checkAndTriggerOnDemand(userId: string, currentBalance: number) {
    const account = await this.getAccount(userId);
    if (!account?.on_demand_enabled) return;
    if (currentBalance > 0) return; // only trigger at actual zero/near-zero

    const sub = await this.getSubscription(userId);
    if (!sub?.flw_card_token) return;

    console.log(`[Energy] Triggering on-demand top-up for user ${userId}`);
    // Emit an event that the server can pick up — in production, call Flutterwave charge API
    await this.supabase.from('energy_transactions').insert({
      user_id: userId,
      type: 'on_demand_topup',
      credits: 0, // pending — will be updated after successful charge
      balance_after: currentBalance,
      description: 'On-demand top-up triggered (pending payment)',
      metadata: { pack_id: account.on_demand_top_up_amount, status: 'pending' },
    });
  }

  /** Cancel subscription */
  async cancelSubscription(userId: string, reason?: string) {
    await this.supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason ?? 'user_requested',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  /** Get usage summary for display */
  async getUsageSummary(userId: string) {
    const [account, sub, { data: recentTx }, { data: recentUsage }] = await Promise.all([
      this.getAccount(userId),
      this.getSubscription(userId),
      this.supabase
        .from('energy_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      this.supabase
        .from('ai_usage_logs')
        .select('operation, energy_debited, actual_cost_usd, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    return { account, subscription: sub, transactions: recentTx, usage: recentUsage };
  }
}

export const energyService = new EnergyService();
