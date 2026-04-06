import { SupabaseClient } from '@supabase/supabase-js';

export interface PlanLimits {
  imageAssets: number;
  videoAssets: number;
  platforms: number;
  websiteScraping: boolean;
  agents: {
    sales: boolean;
    awareness: boolean;
    promotion: boolean;
    launch: boolean;
  };
}

export const SUBSCRIPTION_PLAN_LIMITS: Record<string, PlanLimits> = {
  starter: {
    imageAssets: 0,
    videoAssets: 0,
    platforms: 1,
    websiteScraping: false,
    agents: { sales: false, awareness: true, promotion: true, launch: true },
  },
  pro: {
    imageAssets: 6,
    videoAssets: 2,
    platforms: 2,
    websiteScraping: true,
    agents: { sales: true, awareness: true, promotion: true, launch: true },
  },
  pro_plus: {
    imageAssets: 14,
    videoAssets: 4,
    platforms: 99,
    websiteScraping: true,
    agents: { sales: true, awareness: true, promotion: true, launch: true },
  },
  none: {
    imageAssets: 0,
    videoAssets: 0,
    platforms: 0,
    websiteScraping: false,
    agents: { sales: false, awareness: false, promotion: false, launch: false },
  },
};

export interface SubscriptionGuardResult {
  allowed: boolean;
  plan: string;
  status: string;
  limits: PlanLimits;
  usage: { imageAssets: number; videoAssets: number };
  reason?: string;
}

/**
 * Fetches the user's active subscription + usage and returns plan limits.
 * Checks whether the subscription is active or trialing.
 */
export async function getSubscriptionGuard(
  userId: string,
  supabase: SupabaseClient,
): Promise<SubscriptionGuardResult> {
  const [subRes, usageRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status, current_period_start, current_period_end, trial_start, trial_end')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('energy_transactions')
      .select('operation, created_at')
      .eq('user_id', userId)
      .in('operation', ['generate_image', 'generate_video_asset']),
  ]);

  const sub = subRes.data;
  const plan: string = sub?.plan ?? 'none';
  const status: string = sub?.status ?? 'inactive';
  const isActive = status === 'active' || status === 'trialing';
  const limits = SUBSCRIPTION_PLAN_LIMITS[plan] ?? SUBSCRIPTION_PLAN_LIMITS['none'];

  if (!isActive) {
    return { allowed: false, plan, status, limits, usage: { imageAssets: 0, videoAssets: 0 }, reason: 'No active subscription.' };
  }

  // Count asset usage within the current billing period
  const periodStart = sub?.current_period_start ?? sub?.trial_start ?? null;
  const periodEnd = sub?.current_period_end ?? sub?.trial_end ?? null;

  const txs: Array<{ operation: string; created_at: string }> = usageRes.data ?? [];
  const inPeriod = txs.filter((t) => {
    if (!periodStart) return true;
    const d = new Date(t.created_at);
    const start = new Date(periodStart);
    const end = periodEnd ? new Date(periodEnd) : new Date();
    return d >= start && d <= end;
  });

  const usage = {
    imageAssets: inPeriod.filter((t) => t.operation === 'generate_image').length,
    videoAssets: inPeriod.filter((t) => t.operation === 'generate_video_asset').length,
  };

  return { allowed: true, plan, status, limits, usage };
}

/**
 * Quick helper — checks if a user's subscription allows a specific feature.
 * Returns { allowed, reason } for easy inline use.
 */
export async function checkFeatureAccess(
  userId: string,
  feature: 'websiteScraping' | 'sales_agent' | 'image_asset' | 'video_asset',
  supabase: SupabaseClient,
): Promise<{ allowed: boolean; plan: string; reason?: string; remaining?: number }> {
  const guard = await getSubscriptionGuard(userId, supabase);

  if (!guard.allowed) {
    return { allowed: false, plan: guard.plan, reason: guard.reason };
  }

  switch (feature) {
    case 'websiteScraping':
      if (!guard.limits.websiteScraping) {
        return { allowed: false, plan: guard.plan, reason: `Website scraping is not available on the ${guard.plan} plan. Upgrade to Pro or Pro+.` };
      }
      return { allowed: true, plan: guard.plan };

    case 'sales_agent':
      if (!guard.limits.agents.sales) {
        return { allowed: false, plan: guard.plan, reason: `The Sales Agent is not available on the ${guard.plan} plan. Upgrade to Pro or Pro+.` };
      }
      return { allowed: true, plan: guard.plan };

    case 'image_asset': {
      const limit = guard.limits.imageAssets;
      const used = guard.usage.imageAssets;
      if (limit <= 0) {
        return { allowed: false, plan: guard.plan, reason: `AI image generation is not available on the ${guard.plan} plan. Upgrade to Pro or Pro+.` };
      }
      if (used >= limit) {
        return { allowed: false, plan: guard.plan, reason: `You've used all ${limit} AI image assets allowed on your ${guard.plan} plan this billing period.`, remaining: 0 };
      }
      return { allowed: true, plan: guard.plan, remaining: limit - used };
    }

    case 'video_asset': {
      const limit = guard.limits.videoAssets;
      const used = guard.usage.videoAssets;
      if (limit <= 0) {
        return {
          allowed: false, plan: guard.plan,
          reason: `AI video generation is not available on the ${guard.plan} plan. Starter users can only upload their own video. Upgrade to Pro (2 videos) or Pro+ (4 videos).`,
        };
      }
      if (used >= limit) {
        return {
          allowed: false, plan: guard.plan,
          reason: `You've used all ${limit} AI video asset${limit > 1 ? 's' : ''} allowed on your ${guard.plan} plan this billing period.`,
          remaining: 0,
        };
      }
      return { allowed: true, plan: guard.plan, remaining: limit - used };
    }
  }
}
