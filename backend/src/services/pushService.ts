import { getServiceSupabaseClient } from '../config/supabase';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

async function deactivateInvalidTokens(invalidTokens: string[]): Promise<void> {
  if (!invalidTokens.length) return;
  try {
    const supabase = getServiceSupabaseClient();
    await supabase
      .from('device_push_tokens')
      .update({ is_active: false })
      .in('token', invalidTokens);
    console.log(`[PushService] Deactivated ${invalidTokens.length} invalid push token(s)`);
  } catch (e: any) {
    console.error('[PushService] Failed to deactivate invalid tokens:', e.message);
  }
}

interface ExpoSendResult {
  ok: boolean;
  httpStatus: number;
  tokensSent: number;
  tickets: any[];
  invalidTokens: string[];
  errorSummary?: string;
  rawResponse?: string;
}

async function sendExpoPush(tokens: string[], payload: PushPayload): Promise<ExpoSendResult> {
  if (!tokens.length) {
    return { ok: false, httpStatus: 0, tokensSent: 0, tickets: [], invalidTokens: [], errorSummary: 'No active tokens for this user' };
  }
  const messages = tokens.map((token) => ({
    to: token,
    sound: payload.sound ?? 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    badge: payload.badge,
    channelId: payload.channelId,
    priority: 'high',
    _displayInForeground: true,
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const rawText = await res.text();
    if (!res.ok) {
      console.error('[PushService] Expo push HTTP error:', res.status, rawText.slice(0, 400));
      return { ok: false, httpStatus: res.status, tokensSent: tokens.length, tickets: [], invalidTokens: [], errorSummary: `Expo HTTP ${res.status}`, rawResponse: rawText.slice(0, 600) };
    }

    let json: any = null;
    try { json = JSON.parse(rawText); } catch { /* keep null */ }

    const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
    const invalid: string[] = [];
    const errorMessages: string[] = [];

    tickets.forEach((ticket, idx) => {
      if (ticket?.status === 'error') {
        const errCode = ticket?.details?.error;
        const msg = ticket?.message || 'unknown error';
        errorMessages.push(`${errCode || 'error'}: ${msg}`);
        if (
          errCode === 'DeviceNotRegistered' ||
          errCode === 'InvalidCredentials' ||
          errCode === 'MismatchSenderId'
        ) {
          const token = tokens[idx];
          if (token) invalid.push(token);
        }
      }
    });
    if (invalid.length) await deactivateInvalidTokens(invalid);

    const allOk = tickets.length > 0 && tickets.every((t) => t?.status === 'ok');
    return {
      ok: allOk,
      httpStatus: res.status,
      tokensSent: tokens.length,
      tickets,
      invalidTokens: invalid,
      errorSummary: errorMessages.length ? errorMessages.join(' | ') : undefined,
      rawResponse: allOk ? undefined : rawText.slice(0, 600),
    };
  } catch (e: any) {
    console.error('[PushService] Network error sending push:', e.message);
    return { ok: false, httpStatus: 0, tokensSent: tokens.length, tickets: [], invalidTokens: [], errorSummary: `Network error: ${e.message}` };
  }
}

async function getUserTokens(userId: string): Promise<string[]> {
  const supabase = getServiceSupabaseClient();
  const { data } = await supabase
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('is_active', true);
  return (data ?? []).map((r: any) => r.token).filter(Boolean);
}

async function insertNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, any> = {},
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  await supabase.from('user_notifications').insert({
    user_id: userId,
    title,
    body,
    data,
    is_read: false,
    sent_by: 'system',
  });
}

export const pushService = {
  async notifyLowCredits(userId: string, balance: number, required?: number): Promise<void> {
    const tokens = await getUserTokens(userId);
    const requiredNote = required ? ` You need at least ${required} more credits to continue.` : '';
    const title = 'AdRoom Energy Running Low';
    const body = `You have ${balance.toFixed(1)} energy credits remaining.${requiredNote} Top up to keep your strategy running.`;
    const data = { type: 'low_credits', balance, required };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts' }),
      insertNotification(userId, title, body, data),
    ]);
    console.log(`[PushService] Low credits notification sent to user ${userId} (balance: ${balance})`);
  },

  async notifyExhausted(userId: string): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = 'AdRoom Energy Exhausted';
    const body = 'Your energy credits have run out. All AI operations and campaigns have been paused. Top up to resume.';
    const data = { type: 'credits_exhausted' };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts' }),
      insertNotification(userId, title, body, data),
    ]);
    console.log(`[PushService] Exhausted credits notification sent to user ${userId}`);
  },

  async notifyStrategyActivated(userId: string, strategyTitle: string): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = 'Strategy Activated';
    const body = `Your strategy "${strategyTitle}" is now live. AdRoom AI is executing your campaign.`;
    const data = { type: 'strategy_activated' };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data }),
      insertNotification(userId, title, body, data),
    ]);
  },

  async notifyStrategyStopped(userId: string, strategyTitle: string, reason: string): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = 'Strategy Stopped';
    const body = `Your strategy "${strategyTitle}" has been stopped. Reason: ${reason}`;
    const data = { type: 'strategy_stopped', reason };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts' }),
      insertNotification(userId, title, body, data),
    ]);
  },

  async notifyInsufficientForOperation(
    userId: string,
    operation: string,
    balance: number,
    required: number,
  ): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = 'Insufficient Credits';
    const body = `AdRoom needs ${required} credits to run "${operation}" but you only have ${balance.toFixed(1)}. Top up to continue.`;
    const data = { type: 'insufficient_credits', operation, balance, required };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts' }),
      insertNotification(userId, title, body, data),
    ]);
  },

  async notifyTopupSuccess(userId: string, packLabel: string, credits: number, newBalance: number): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = 'Energy Top-Up Successful';
    const body = `+${credits} energy credits added (${packLabel}). New balance: ${newBalance.toFixed(1)}.`;
    const data = { type: 'topup_success', credits, newBalance, pack: packLabel };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data }),
      insertNotification(userId, title, body, data),
    ]);
  },

  async notifyPlanChanged(userId: string, planName: string, credits: number, newBalance: number): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = `Welcome to ${planName}`;
    const body = `Your ${planName} plan is active. ${credits} energy credits added. New balance: ${newBalance.toFixed(1)}.`;
    const data = { type: 'plan_changed', plan: planName, credits, newBalance };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data }),
      insertNotification(userId, title, body, data),
    ]);
  },

  /**
   * Generic credit-award notification for any positive credit grant that
   * doesn't have a dedicated notifier (admin grants, promo codes, etc.).
   * Top-ups and plan changes already use notifyTopupSuccess /
   * notifyPlanChanged so we don't double-notify those.
   */
  async notifyCreditsAwarded(userId: string, credits: number, reason: string, newBalance: number): Promise<void> {
    return this.send(userId, {
      title: `+${credits} energy credits`,
      body: `${reason} — new balance: ${newBalance.toFixed(0)} credits`,
      data: { type: 'credits_awarded', credits, reason, newBalance },
    });
  },

  async notifyTrialStarted(userId: string, credits: number, daysLeft: number): Promise<void> {
    const tokens = await getUserTokens(userId);
    const title = 'Free Trial Started';
    const body = `You've got ${credits} energy credits to explore AdRoom AI for the next ${daysLeft} days. No charge until your trial ends.`;
    const data = { type: 'trial_started', credits, daysLeft };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data }),
      insertNotification(userId, title, body, data),
    ]);
  },

  async notifySubscriptionCancelled(userId: string, accessUntil: string | null): Promise<void> {
    const tokens = await getUserTokens(userId);
    const dateText = accessUntil ? new Date(accessUntil).toLocaleDateString() : 'the end of your billing period';
    const title = 'Subscription Cancelled';
    const body = `Your subscription has been cancelled. You'll keep access until ${dateText}.`;
    const data = { type: 'subscription_cancelled', accessUntil };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data }),
      insertNotification(userId, title, body, data),
    ]);
  },

  async send(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await getUserTokens(userId);
    await Promise.all([
      sendExpoPush(tokens, payload),
      insertNotification(userId, payload.title, payload.body, payload.data ?? {}),
    ]);
  },

  async notifyDealClosed(userId: string, params: {
    buyerName: string;
    productName: string;
    dealValue: number;
    currency: string;
    platform: string;
    deliveryType?: string;
    deliveryAddress?: string;
  }): Promise<void> {
    const tokens = await getUserTokens(userId);
    const currencySymbol = params.currency === 'USD' ? '$' : params.currency + ' ';
    const title = `Deal Closed — ${currencySymbol}${params.dealValue.toLocaleString()}`;
    const body = `${params.buyerName} just agreed to purchase "${params.productName}" via ${params.platform}. ${params.deliveryType === 'payment_on_delivery' ? 'Cash on delivery.' : 'Payment required before delivery.'}${params.deliveryAddress ? ` Deliver to: ${params.deliveryAddress}.` : ''}`;
    const data = { type: 'deal_closed', ...params };
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts', sound: 'default' }),
      insertNotification(userId, title, body, data),
    ]);
    console.log(`[PushService] Deal closed notification sent to user ${userId} — buyer: ${params.buyerName}`);
  },

  /**
   * Notifies a user that their Salesman Agent has identified a new high-intent
   * lead from a platform comment or Google Maps outreach.
   *
   * 4-hour dedup per platform_user so rapid rescans don't spam.
   */
  async notifyNewLead(
    userId: string,
    params: {
      leadName: string;
      platform: string;
      intentScore: number;
      firstInteraction?: string;
    },
  ): Promise<void> {
    const supabase = getServiceSupabaseClient();

    // ── Dedup: one notification per lead name per 4 hours ──
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('user_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('sent_by', 'system')
      .gte('created_at', cutoff)
      .filter('data->>type', 'eq', 'new_lead')
      .filter('data->>leadName', 'eq', params.leadName)
      .limit(1)
      .maybeSingle();

    if (recent) return; // already notified for this lead recently

    const displayPlatform = params.platform.charAt(0).toUpperCase() + params.platform.slice(1);
    const score = Math.round(params.intentScore * 100);
    const preview = params.firstInteraction
      ? ` "${params.firstInteraction.slice(0, 60)}${params.firstInteraction.length > 60 ? '…' : ''}"`
      : '';

    const title = `New Lead on ${displayPlatform}`;
    const body  = `${params.leadName} is interested (${score}% intent).${preview} Salesman AI is working on them.`;
    const data  = { type: 'new_lead', platform: params.platform, leadName: params.leadName, intentScore: params.intentScore };

    const tokens = await getUserTokens(userId);
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts' }),
      insertNotification(userId, title, body, data),
    ]);
    console.log(`[PushService] New lead notification — ${params.leadName} on ${params.platform} for user ${userId}`);
  },

  /**
   * Notifies a user that one of their platform connections has expired and
   * needs to be reconnected — sent when the background token refresh fails.
   *
   * Includes 24-hour dedup so repeated refresh failures don't spam the user
   * every 6 hours.  The push data carries `action: 'reconnect'` and the
   * `platform` name so the mobile app can deep-link straight to the
   * platform connection screen.
   */
  async notifyTokenRefreshFailed(userId: string, platform: string): Promise<void> {
    const supabase = getServiceSupabaseClient();

    // ── Dedup: skip if we already sent this notification within 24 hours ──
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('user_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('sent_by', 'system')
      .gte('created_at', cutoff)
      .filter('data->>type', 'eq', 'token_refresh_failed')
      .filter('data->>platform', 'eq', platform)
      .limit(1)
      .maybeSingle();

    if (recent) {
      console.log(`[PushService] Skipping token_refresh_failed for ${platform} user ${userId} — already notified within 24h`);
      return;
    }

    const displayName = platform.charAt(0).toUpperCase() + platform.slice(1);
    const title = `Reconnect ${displayName}`;
    const body  = `Your ${displayName} connection has expired. Tap to reconnect and keep your campaign running.`;
    const data  = { type: 'token_refresh_failed', platform, action: 'reconnect' };

    const tokens = await getUserTokens(userId);
    await Promise.all([
      sendExpoPush(tokens, { title, body, data, channelId: 'alerts' }),
      insertNotification(userId, title, body, data),
    ]);
    console.log(`[PushService] Token refresh failed notification sent — ${platform} user ${userId}`);
  },

  /**
   * Diagnostic helper used by /api/push/test. Sends a real push to all of
   * the user's active devices and returns the full Expo response so the
   * client can show exactly why a push isn't being delivered (FCM not
   * configured, token invalid, MismatchSenderId, etc.).
   */
  async sendTest(userId: string): Promise<{
    tokensFound: number;
    result: ExpoSendResult;
    devices: Array<{ device_id: string; platform: string; app_version: string | null; last_seen_at: string }>;
  }> {
    const supabase = getServiceSupabaseClient();
    const { data: rows } = await supabase
      .from('device_push_tokens')
      .select('token, device_id, platform, app_version, last_seen_at')
      .eq('user_id', userId)
      .eq('is_active', true);

    const tokens = (rows ?? []).map((r: any) => r.token).filter(Boolean);
    const devices = (rows ?? []).map((r: any) => ({
      device_id: String(r.device_id || '').slice(0, 8) + '…',
      platform: r.platform,
      app_version: r.app_version,
      last_seen_at: r.last_seen_at,
    }));

    const result = await sendExpoPush(tokens, {
      title: 'AdRoom AI Test Push',
      body: 'If you can see this with the app closed, push is working correctly.',
      data: { type: 'test_push', sentAt: new Date().toISOString() },
      channelId: 'alerts',
    });

    // Don't insert into user_notifications for test pushes — keep the
    // bell uncluttered.
    return { tokensFound: tokens.length, result, devices };
  },
};
