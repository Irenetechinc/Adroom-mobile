import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getServiceSupabaseClient } from '../config/supabase';
import { SUBSCRIPTION_PLAN_LIMITS } from '../services/subscriptionGuard';
import { pushService } from '../services/pushService';
import { apmaAdminRouter } from '../apma/apmaRouter';
import { broadcast as _sseBroadcast, registerSSEClient, unregisterSSEClient } from '../events/sseBroadcast';
import { runAPMAStartupMigration, checkAPMAMigrationStatus } from '../utils/apmaStartupMigration';
import * as featureFlags from '../services/featureFlagService';

const router = Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const JWT_SECRET = process.env.ADMIN_JWT_SECRET ||
  (ADMIN_EMAIL && ADMIN_PASSWORD
    ? crypto.createHash('sha256').update(`adroom:${ADMIN_EMAIL}:${ADMIN_PASSWORD}:v1`).digest('hex')
    : crypto.randomBytes(64).toString('hex'));
const ADMIN_CONFIGURED = !!(ADMIN_EMAIL && ADMIN_PASSWORD);
if (!ADMIN_CONFIGURED) {
  console.warn('[Admin] ADMIN_EMAIL and/or ADMIN_PASSWORD not set — admin login is disabled until both are configured.');
}

// ─── SSE broadcast helpers ────────────────────────────────────────────────────
// Exported so server.ts can broadcast from its own routes
export function adminBroadcast(event: string, data: unknown) {
  _sseBroadcast(event, data);
}
const broadcast = _sseBroadcast;

// ─── Token helpers ────────────────────────────────────────────────────────────
function signToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ e: email, iat: Date.now(), exp: Date.now() + 86_400_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): { e: string } | null {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch { return null; }
}

// ─── Admin auth middleware ────────────────────────────────────────────────────
function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload || payload.e !== ADMIN_EMAIL) return res.status(401).json({ error: 'Invalid token' });
  next();
}

// ─── Log admin action ────────────────────────────────────────────────────────
async function logAction(action: string, targetUserId: string | null, targetEmail: string | null, details: Record<string, unknown>) {
  const sb = getServiceSupabaseClient();
  await sb.from('admin_action_logs').insert({
    admin_email: ADMIN_EMAIL,
    action_type: action,
    target_user_id: targetUserId,
    target_user_email: targetEmail,
    details,
  });
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  if (!ADMIN_CONFIGURED) {
    return res.status(503).json({ error: 'Admin console is not configured. ADMIN_EMAIL and ADMIN_PASSWORD must be set on the server.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (email.toLowerCase() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return res.json({ token: signToken(ADMIN_EMAIL), email: ADMIN_EMAIL });
});

// ─── APMA (Autonomous Political Marketing Agent) — admin-only ─────────────────
router.use('/api/apma', auth, apmaAdminRouter);

// ─── APMA Migration endpoints ─────────────────────────────────────────────────
router.get('/api/apma-migration/status', auth, async (_req, res) => {
  try {
    const status = await checkAPMAMigrationStatus();
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ migrated: false, missing: [e.message] });
  }
});

router.post('/api/apma-migration/run', auth, async (_req, res) => {
  try {
    const result = await runAPMAStartupMigration();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────
router.get('/api/stats', auth, async (_req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const [usersRes, subsRes, energyRes, strategiesRes, agentTasksRes, aiLogsRes, suspendedRes] = await Promise.all([
      sb.from('energy_accounts').select('user_id', { count: 'exact', head: true }),
      sb.from('subscriptions').select('plan, status'),
      sb.from('energy_transactions').select('credits, type, created_at').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
      sb.from('strategies').select('id', { count: 'exact', head: true }),
      sb.from('agent_tasks').select('status', { count: 'exact', head: true }),
      sb.from('ai_usage_logs').select('actual_cost_usd').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
      sb.from('user_status_overrides').select('user_id', { count: 'exact', head: true }).eq('status', 'suspended'),
    ]);

    const subs = subsRes.data || [];
    const activeSubs = subs.filter(s => s.status === 'active' || s.status === 'trialing').length;
    const planBreakdown = { starter: 0, pro: 0, pro_plus: 0, none: 0 } as Record<string, number>;
    subs.forEach(s => { planBreakdown[s.plan] = (planBreakdown[s.plan] || 0) + 1; });

    const txs = energyRes.data || [];
    const creditsTopup = txs.filter(t => ['topup', 'subscription_grant', 'trial_grant'].includes(t.type)).reduce((s, t) => s + Number(t.credits), 0);
    const creditsConsumed = txs.filter(t => t.type === 'debit').reduce((s, t) => s + Math.abs(Number(t.credits)), 0);

    const aiRevenue30d = (aiLogsRes.data || []).reduce((s, l) => s + Number(l.actual_cost_usd || 0), 0);

    res.json({
      totalUsers: usersRes.count ?? 0,
      activeSubscriptions: activeSubs,
      suspendedUsers: suspendedRes.count ?? 0,
      planBreakdown,
      totalStrategies: strategiesRes.count ?? 0,
      agentTasksTotal: agentTasksRes.count ?? 0,
      credits30d: { topup: creditsTopup, consumed: creditsConsumed },
      aiCost30d: aiRevenue30d,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LIST USERS ───────────────────────────────────────────────────────────────
router.get('/api/users', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const page = parseInt(String(req.query.page || '1'));
    const limit = parseInt(String(req.query.limit || '20'));
    const search = String(req.query.search || '');
    const from = (page - 1) * limit;

    const { data: { users }, error } = await sb.auth.admin.listUsers({ page, perPage: limit });
    if (error) throw error;

    let filtered = users;
    if (search) {
      const q = search.toLowerCase();
      filtered = users.filter(u =>
        u.email?.toLowerCase().includes(q) ||
        u.id.includes(q) ||
        u.user_metadata?.full_name?.toLowerCase().includes(q)
      );
    }

    const userIds = filtered.map(u => u.id);
    const [energyRes, subRes, statusRes, stratRes, platformRes] = await Promise.all([
      sb.from('energy_accounts').select('user_id, balance_credits, lifetime_consumed').in('user_id', userIds),
      sb.from('subscriptions').select('user_id, plan, status, current_period_end').in('user_id', userIds),
      sb.from('user_status_overrides').select('user_id, status, reason, applied_at').in('user_id', userIds),
      sb.from('strategies').select('user_id').in('user_id', userIds),
      sb.from('platform_configs').select('user_id, platform').in('user_id', userIds),
    ]);

    const energyMap: Record<string, any> = {};
    (energyRes.data || []).forEach(e => { energyMap[e.user_id] = e; });
    const subMap: Record<string, any> = {};
    (subRes.data || []).forEach(s => { subMap[s.user_id] = s; });
    const statusMap: Record<string, any> = {};
    (statusRes.data || []).forEach(s => { statusMap[s.user_id] = s; });
    const stratCount: Record<string, number> = {};
    (stratRes.data || []).forEach(s => { stratCount[s.user_id] = (stratCount[s.user_id] || 0) + 1; });
    const platformCount: Record<string, number> = {};
    (platformRes.data || []).forEach(p => { platformCount[p.user_id] = (platformCount[p.user_id] || 0) + 1; });

    const enriched = filtered.map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.user_metadata?.full_name || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at || null,
      email_verified: !!u.email_confirmed_at,
      energy: energyMap[u.id] || null,
      subscription: subMap[u.id] || null,
      override_status: statusMap[u.id]?.status || 'active',
      override_reason: statusMap[u.id]?.reason || null,
      strategy_count: stratCount[u.id] || 0,
      connected_accounts: platformCount[u.id] || 0,
    }));

    res.json({ users: enriched, total: filtered.length, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER DETAIL ──────────────────────────────────────────────────────────────
router.get('/api/users/:id', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;

    const { data: { user }, error: uErr } = await sb.auth.admin.getUserById(id);
    if (uErr || !user) return res.status(404).json({ error: 'User not found' });

    const [energyRes, subRes, txRes, stratRes, agentRes, aiRes, statusRes, pushRes] = await Promise.all([
      sb.from('energy_accounts').select('*').eq('user_id', id).single(),
      sb.from('subscriptions').select('*').eq('user_id', id).single(),
      sb.from('energy_transactions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      sb.from('strategies').select('id, title, is_active, created_at, goal, platforms').eq('user_id', id).order('created_at', { ascending: false }).limit(10),
      sb.from('agent_tasks').select('id, agent_type, task_type, platform, status, scheduled_at, executed_at, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      sb.from('ai_usage_logs').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      sb.from('user_status_overrides').select('*').eq('user_id', id).single(),
      sb.from('device_push_tokens').select('token, platform, created_at').eq('user_id', id),
    ]);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        email_confirmed_at: user.email_confirmed_at,
      },
      energy: energyRes.data,
      subscription: subRes.data,
      recent_transactions: txRes.data || [],
      strategies: stratRes.data || [],
      agent_tasks: agentRes.data || [],
      ai_usage: aiRes.data || [],
      status_override: statusRes.data,
      push_tokens: pushRes.data || [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADJUST CREDITS ───────────────────────────────────────────────────────────
router.post('/api/users/:id/credits', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;
    const { amount, type, reason } = req.body;
    if (!amount || !type || !['credit', 'debit'].includes(type)) {
      return res.status(400).json({ error: 'amount and type (credit|debit) required' });
    }
    const credits = Math.abs(Number(amount));
    if (isNaN(credits) || credits <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const { data: account } = await sb.from('energy_accounts').select('*').eq('user_id', id).single();
    if (!account) return res.status(404).json({ error: 'Energy account not found' });

    const { data: { user } } = await sb.auth.admin.getUserById(id);
    const currentBalance = Number(account.balance_credits);
    const newBalance = type === 'credit' ? currentBalance + credits : Math.max(0, currentBalance - credits);

    const { error: updateErr } = await sb.from('energy_accounts').update({
      balance_credits: newBalance,
      lifetime_credits: type === 'credit' ? Number(account.lifetime_credits) + credits : account.lifetime_credits,
      lifetime_consumed: type === 'debit' ? Number(account.lifetime_consumed) + credits : account.lifetime_consumed,
    }).eq('user_id', id);
    if (updateErr) throw updateErr;

    await sb.from('energy_transactions').insert({
      user_id: id,
      type: type === 'credit' ? 'credit' : 'debit',
      credits: type === 'credit' ? credits : -credits,
      balance_after: newBalance,
      description: reason || `Admin ${type === 'credit' ? 'top-up' : 'deduction'}: ${credits} credits`,
      operation: 'admin_adjustment',
    });

    await logAction(`credit_${type}`, id, user?.email || null, { amount: credits, reason, old_balance: currentBalance, new_balance: newBalance });
    broadcast('credit_adjusted', { userId: id, email: user?.email, type, amount: credits, newBalance });

    // Notify the user on their device + in-app inbox so they actually find
    // out their balance changed. Without this, admin top-ups happened
    // silently and users had no idea they'd been credited.
    if (type === 'credit') {
      pushService
        .notifyCreditsAwarded(id, credits, reason || 'Credits added by AdRoom team', newBalance)
        .catch((e: any) => console.error('[Admin] notifyCreditsAwarded failed:', e?.message));
    } else {
      pushService
        .send(id, {
          title: 'Energy Credits Adjusted',
          body: `${credits} energy credit${credits === 1 ? '' : 's'} were deducted from your balance. New balance: ${newBalance.toFixed(0)}.`,
          data: { type: 'credits_deducted', credits, reason, newBalance },
          channelId: 'alerts',
        })
        .catch((e: any) => console.error('[Admin] credit-deduction push failed:', e?.message));
    }

    res.json({ success: true, old_balance: currentBalance, new_balance: newBalance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SUSPEND USER ─────────────────────────────────────────────────────────────
router.post('/api/users/:id/suspend', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;
    const { reason } = req.body;

    const { data: { user } } = await sb.auth.admin.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await sb.from('user_status_overrides').upsert({
      user_id: id,
      status: 'suspended',
      reason: reason || 'Suspended by admin',
      applied_by: ADMIN_EMAIL,
      applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await logAction('suspend', id, user.email || null, { reason });
    broadcast('user_suspended', { userId: id, email: user.email, reason });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UNSUSPEND USER ───────────────────────────────────────────────────────────
router.post('/api/users/:id/unsuspend', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;

    const { data: { user } } = await sb.auth.admin.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await sb.from('user_status_overrides').upsert({
      user_id: id,
      status: 'active',
      reason: null,
      applied_by: ADMIN_EMAIL,
      updated_at: new Date().toISOString(),
    });

    await logAction('unsuspend', id, user.email || null, {});
    broadcast('user_unsuspended', { userId: id, email: user.email });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CHANGE SUBSCRIPTION PLAN ────────────────────────────────────────────────
router.post('/api/users/:id/plan', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;
    const { plan, status, grantCredits } = req.body;

    const validPlans = ['starter', 'pro', 'pro_plus', 'none'];
    const validStatuses = ['active', 'inactive', 'trialing', 'cancelled', 'expired'];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan. Must be: starter, pro, pro_plus, none' });
    if (!validStatuses.includes(status || 'active')) return res.status(400).json({ error: 'Invalid status' });

    const { data: { user } } = await sb.auth.admin.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const PLAN_CREDITS: Record<string, number> = { starter: 100, pro: 300, pro_plus: 600, none: 0 };
    const planCredits = PLAN_CREDITS[plan] ?? 0;
    const effectiveStatus = plan === 'none' ? 'inactive' : (status || 'active');
    const now = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();

    const { data: existingSub } = await sb.from('subscriptions').select('plan, status').eq('user_id', id).single();

    await sb.from('subscriptions').upsert({
      user_id: id,
      plan,
      status: effectiveStatus,
      current_period_start: plan !== 'none' ? now : null,
      current_period_end: plan !== 'none' ? periodEnd : null,
      updated_at: now,
    }, { onConflict: 'user_id' });

    // ── Enforce platform-count limits on plan change ────────────────────────
    // When a user is downgraded (e.g. pro → starter or anything → none) we
    // proactively delete their excess connected platforms so the new plan's
    // limits are immediately enforced. The most-recently-updated configs are
    // kept so the user retains the platforms they care about most.
    let removedPlatforms: string[] = [];
    try {
      const newLimit = (SUBSCRIPTION_PLAN_LIMITS[plan] ?? SUBSCRIPTION_PLAN_LIMITS['none']).platforms;
      const isInactive = effectiveStatus !== 'active' && effectiveStatus !== 'trialing';
      const effectiveLimit = isInactive ? 0 : newLimit;

      const { data: configs } = await sb
        .from('ad_configs')
        .select('platform, updated_at')
        .eq('user_id', id)
        .order('updated_at', { ascending: false });

      const list = configs || [];
      if (list.length > effectiveLimit) {
        const toRemove = list.slice(effectiveLimit).map((c: any) => c.platform);
        if (toRemove.length > 0) {
          await sb.from('ad_configs').delete().eq('user_id', id).in('platform', toRemove);
          removedPlatforms = toRemove;
          // Notify admin dashboard listeners that platforms were force-disconnected
          broadcast('platform_disconnected', { userId: id, platforms: toRemove, reason: 'plan_downgrade' });
        }
      }
    } catch (e: any) {
      console.error('[Admin] Failed to enforce platform limit on plan change:', e.message);
    }

    let newBalance: number | null = null;
    if (grantCredits && plan !== 'none' && planCredits > 0) {
      const { data: account } = await sb.from('energy_accounts').select('*').eq('user_id', id).single();
      if (account) {
        const updatedBalance = Number(account.balance_credits) + planCredits;
        await sb.from('energy_accounts').update({
          balance_credits: updatedBalance,
          lifetime_credits: Number(account.lifetime_credits) + planCredits,
          updated_at: now,
        }).eq('user_id', id);

        await sb.from('energy_transactions').insert({
          user_id: id,
          type: 'subscription_grant',
          credits: planCredits,
          balance_after: updatedBalance,
          description: `Admin plan change to ${plan} — ${planCredits} credits granted`,
          operation: 'admin_plan_change',
        });
        newBalance = updatedBalance;
      }
    }

    await logAction('plan_change', id, user.email || null, {
      from_plan: existingSub?.plan || 'none',
      to_plan: plan,
      status: effectiveStatus,
      credits_granted: grantCredits && planCredits > 0 ? planCredits : 0,
    });

    broadcast('plan_changed', {
      userId: id,
      email: user.email,
      from: existingSub?.plan || 'none',
      to: plan,
      status: effectiveStatus,
      creditsGranted: grantCredits ? planCredits : 0,
      newBalance,
      removedPlatforms,
    });

    // ── Realtime push notification to the user ──────────────────────────────
    // Lets the user know immediately on their device that their plan changed.
    try {
      const fromPlan = existingSub?.plan || 'none';
      const PLAN_LABEL: Record<string, string> = {
        starter: 'Starter', pro: 'Pro', pro_plus: 'Pro+', none: 'No Plan',
      };
      const toLabel = PLAN_LABEL[plan] || plan;
      const fromLabel = PLAN_LABEL[fromPlan] || fromPlan;

      let title = 'Subscription Updated';
      let body = '';
      if (effectiveStatus === 'cancelled' || effectiveStatus === 'expired' || plan === 'none') {
        title = 'Subscription Ended';
        body = 'Your AdRoom AI subscription has ended. Upgrade to keep your campaigns running.';
      } else if (fromPlan === 'none' || (existingSub?.status !== 'active' && existingSub?.status !== 'trialing')) {
        title = `Welcome to ${toLabel}`;
        body = grantCredits && planCredits > 0
          ? `Your ${toLabel} plan is active. ${planCredits} energy credits have been added to your wallet.`
          : `Your ${toLabel} plan is now active. Start launching strategies right away.`;
      } else if (fromPlan !== plan) {
        const ranks: Record<string, number> = { none: 0, starter: 1, pro: 2, pro_plus: 3 };
        const direction = (ranks[plan] ?? 0) > (ranks[fromPlan] ?? 0) ? 'upgraded' : 'downgraded';
        title = direction === 'upgraded' ? 'Plan Upgraded' : 'Plan Changed';
        body = `Your subscription has been ${direction} from ${fromLabel} to ${toLabel}.`;
        if (removedPlatforms.length > 0) {
          body += ` ${removedPlatforms.length} connected platform${removedPlatforms.length > 1 ? 's were' : ' was'} disconnected to fit your new plan.`;
        }
        if (grantCredits && planCredits > 0) {
          body += ` ${planCredits} credits added.`;
        }
      } else {
        body = `Your ${toLabel} subscription was updated.`;
      }

      await pushService.send(id, {
        title,
        body,
        data: { type: 'plan_changed', plan, status: effectiveStatus, removedPlatforms },
        channelId: 'alerts',
      });
    } catch (e: any) {
      console.error('[Admin] Failed to send plan-change push:', e.message);
    }

    res.json({
      success: true,
      plan,
      status: effectiveStatus,
      credits_granted: grantCredits && planCredits > 0 ? planCredits : 0,
      new_balance: newBalance,
      removed_platforms: removedPlatforms,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TERMINATE USER ───────────────────────────────────────────────────────────
router.delete('/api/users/:id', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;

    const { data: { user } } = await sb.auth.admin.getUserById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await logAction('terminate', id, user.email || null, {});
    const { error } = await sb.auth.admin.deleteUser(id);
    if (error) throw error;

    broadcast('user_terminated', { userId: id, email: user.email });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SEND PUSH NOTIFICATION ───────────────────────────────────────────────────
router.post('/api/notifications', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { target, title, body, data: extraData } = req.body;
    if (!target || !title || !body) return res.status(400).json({ error: 'target, title, body required' });

    let tokenQuery = sb.from('device_push_tokens').select('token, user_id');
    if (target.startsWith('user:')) {
      tokenQuery = tokenQuery.eq('user_id', target.replace('user:', ''));
    } else if (target.startsWith('plan:')) {
      const planName = target.replace('plan:', '');
      const { data: subs } = await sb.from('subscriptions').select('user_id').eq('plan', planName).in('status', ['active', 'trialing']);
      const ids = (subs || []).map(s => s.user_id);
      if (ids.length === 0) return res.json({ success: true, sent: 0, message: 'No active users on this plan' });
      tokenQuery = tokenQuery.in('user_id', ids);
    }

    const { data: tokenRows } = await tokenQuery;
    const tokens = (tokenRows || []).map(r => r.token).filter(Boolean);

    if (tokens.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No push tokens found for target' });
    }

    const messages = tokens.map(token => ({ to: token, title, body, data: extraData || {} }));
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }

    let successCount = 0;
    const results: any[] = [];
    for (const chunk of chunks) {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      const result = await response.json();
      if (Array.isArray(result.data)) {
        result.data.forEach((r: any) => { if (r.status === 'ok') successCount++; });
      }
      results.push(result);
    }

    await sb.from('notification_logs').insert({
      sent_by: ADMIN_EMAIL,
      target,
      title,
      body,
      recipients_count: successCount,
      delivery_results: { results, total_tokens: tokens.length },
    });

    // Also save to user_notifications inbox so users can see in-app
    const recipientUserIds = (tokenRows || []).map(r => r.user_id).filter(Boolean);
    if (recipientUserIds.length > 0) {
      const inboxRows = recipientUserIds.map(uid => ({
        user_id: uid,
        title,
        body,
        data: extraData || {},
        sent_by: ADMIN_EMAIL,
        is_read: false,
      }));
      await sb.from('user_notifications').insert(inboxRows).then(({ error: e }) => {
        if (e && e.code !== '42P01') console.warn('[Admin] Failed to save to user_notifications:', e.message);
      });
    }

    await logAction('send_notification', null, null, { target, title, body, sent: successCount });
    broadcast('notification_sent', { target, title, sent: successCount });
    res.json({ success: true, sent: successCount, total_tokens: tokens.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN ACTION LOG ─────────────────────────────────────────────────────────
router.get('/api/action-logs', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { data } = await sb.from('admin_action_logs').select('*').order('created_at', { ascending: false }).limit(100);
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SELF-EVOLUTION LOG ───────────────────────────────────────────────────────
// Returns entries from self_evolution_log (latest first) so the admin dashboard
// can show the AI's autonomous self-improvement decisions in real time.
router.get('/api/evolution/log', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const limit = Math.min(parseInt(String(req.query.limit || '100')), 500);
    const type  = typeof req.query.type === 'string' ? req.query.type : undefined;

    let query = sb
      .from('self_evolution_log')
      .select('id, agent, cycle_date, analysis, adopted_sources, scaled_back_sources, new_source_ideas, overall_recommendation, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type) query = query.eq('agent', type);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ entries: data || [], count: (data || []).length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AGENT NETWORK STATUS ────────────────────────────────────────────────────
router.get('/api/agent-network', auth, async (_req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: tasks } = await sb
      .from('agent_tasks')
      .select('agent_type, status, platform')
      .gte('created_at', since);

    const summary: Record<string, { agent_type: string; total: number; running: number; done: number; failed: number; platforms: Set<string> }> = {};
    for (const t of tasks || []) {
      if (!summary[t.agent_type]) summary[t.agent_type] = { agent_type: t.agent_type, total: 0, running: 0, done: 0, failed: 0, platforms: new Set() };
      summary[t.agent_type].total++;
      if (t.status === 'running' || t.status === 'pending') summary[t.agent_type].running++;
      if (t.status === 'done') summary[t.agent_type].done++;
      if (t.status === 'failed') summary[t.agent_type].failed++;
      if (t.platform) summary[t.agent_type].platforms.add(t.platform.toLowerCase());
    }

    const agents = Object.values(summary).map(a => ({ ...a, platforms: Array.from(a.platforms) }));
    res.json({ agents, since });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CMA SAVINGS STATS ────────────────────────────────────────────────────────
router.get('/api/cma/stats', auth, async (req, res) => {
  try {
    const { creditManagementAgent: cmaAgent } = await import('../services/creditManagementAgent');
    const days = Math.min(parseInt(String(req.query.days || '7')), 90);
    const [stats, liveStatus] = await Promise.all([
      cmaAgent.getSavingsSummary(days),
      Promise.resolve(cmaAgent.getLiveStatus()),
    ]);
    res.json({ ...stats, liveStatus, days });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CMA: REAL-TIME AI PROVIDER CREDITS ────────────────────────────────────────
// Returns actual spend tracked in ai_usage_logs plus live OpenAI billing API data.
// Google/Gemini doesn't expose balance via API key so we use internal tracking.
router.get('/api/cma/model-credits', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();

    // Pull all ai_usage_logs for this calendar month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: usageLogs } = await sb
      .from('ai_usage_logs')
      .select('model, operation, actual_cost_usd, energy_debited, created_at')
      .gte('created_at', startOfMonth.toISOString())
      .order('created_at', { ascending: false });

    const rows = usageLogs || [];

    // Classify rows by provider
    const isOpenAI  = (m: string) => m.startsWith('gpt') || m.includes('openai');
    const isGoogle  = (m: string) => m.startsWith('gemini') || m.startsWith('imagen') || m.includes('google');

    const openaiRows  = rows.filter(r => isOpenAI(r.model));
    const googleRows  = rows.filter(r => isGoogle(r.model));

    const sum = (arr: any[]) => arr.reduce((s, r) => s + (parseFloat(r.actual_cost_usd) || 0), 0);

    const openaiInternalSpend = sum(openaiRows);
    const googleInternalSpend = sum(googleRows);

    // Model-level breakdown
    const modelBreakdown = (arr: any[]) => {
      const map: Record<string, { calls: number; usd: number }> = {};
      for (const r of arr) {
        if (!map[r.model]) map[r.model] = { calls: 0, usd: 0 };
        map[r.model].calls++;
        map[r.model].usd += parseFloat(r.actual_cost_usd) || 0;
      }
      return map;
    };

    // ── OpenAI live billing API ─────────────────────────────────────
    let openaiLiveSpend: number | null = null;
    let openaiHardLimitUsd: number | null = null;
    let openaiSoftLimitUsd: number | null = null;
    let openaiApiError: string | null = null;

    try {
      const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
      const today = new Date();
      const yyyy  = today.getFullYear();
      const mm    = String(today.getMonth() + 1).padStart(2, '0');
      const dd    = String(today.getDate() + 1).padStart(2, '0'); // tomorrow as end
      const start = `${yyyy}-${mm}-01`;
      const end   = `${yyyy}-${mm}-${dd}`;

      const [usageResp, subResp] = await Promise.allSettled([
        fetch(`https://api.openai.com/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`, {
          headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        }),
        fetch('https://api.openai.com/v1/dashboard/billing/subscription', {
          headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        }),
      ]);

      if (usageResp.status === 'fulfilled' && usageResp.value.ok) {
        const data: any = await usageResp.value.json();
        openaiLiveSpend = (data.total_usage || 0) / 100; // cents → USD
      } else if (usageResp.status === 'fulfilled') {
        const errData: any = await usageResp.value.json().catch(() => ({}));
        openaiApiError = errData?.error?.message || `HTTP ${usageResp.value.status}`;
      }

      if (subResp.status === 'fulfilled' && subResp.value.ok) {
        const data: any = await subResp.value.json();
        openaiHardLimitUsd = data.hard_limit_usd ?? null;
        openaiSoftLimitUsd = data.soft_limit_usd ?? null;
      }
    } catch (e: any) {
      openaiApiError = e.message;
    }

    const now = new Date().toISOString();
    res.json({
      ok: true,
      period: { start: startOfMonth.toISOString(), end: now },
      providers: [
        {
          id:         'openai',
          name:       'OpenAI',
          color:      '#10A37F',
          textColor:  '#FFFFFF',
          models:     ['gpt-4o'],
          internalSpendUsd:  openaiInternalSpend,
          internalCallCount: openaiRows.length,
          liveSpendUsd:      openaiLiveSpend,
          hardLimitUsd:      openaiHardLimitUsd,
          softLimitUsd:      openaiSoftLimitUsd,
          apiError:          openaiApiError,
          modelBreakdown:    modelBreakdown(openaiRows),
        },
        {
          id:         'google',
          name:       'Google',
          color:      '#4285F4',
          textColor:  '#FFFFFF',
          models:     ['gemini-2.0-flash', 'imagen-3.0-generate-001'],
          internalSpendUsd:  googleInternalSpend,
          internalCallCount: googleRows.length,
          liveSpendUsd:      null,   // Google AI Studio API key has no billing endpoint
          hardLimitUsd:      null,
          softLimitUsd:      null,
          apiError:          null,
          modelBreakdown:    modelBreakdown(googleRows),
          note:              'Balance via Google Cloud Console — internal tracking shown',
        },
      ],
      totalSpendUsd: openaiInternalSpend + googleInternalSpend,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRITIC AGENT: STATS ──────────────────────────────────────────────────────
router.get('/api/critic/stats', auth, async (_req, res) => {
  try {
    const { criticAgentService } = await import('../services/criticAgentService');
    const stats = await criticAgentService.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRITIC AGENT: RECENT LOGS ────────────────────────────────────────────────
router.get('/api/critic/logs', auth, async (req, res) => {
  try {
    const { criticAgentService } = await import('../services/criticAgentService');
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 200);
    const verdict = req.query.verdict as string | undefined;
    const agentType = req.query.agent_type as string | undefined;
    const logs = await criticAgentService.getLogs({ limit, verdict, agentType });
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRITIC AGENT: HEATMAP (7-day rolling avg per agent × platform) ───────────
router.get('/api/critic/heatmap', auth, async (_req, res) => {
  try {
    const { criticAgentService } = await import('../services/criticAgentService');
    const cells = await criticAgentService.getHeatmapData();
    res.json({ cells });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRITIC AGENT: PAUSE CONFIG ───────────────────────────────────────────────
router.get('/api/critic/pause-config', auth, async (_req, res) => {
  try {
    const { criticAgentService } = await import('../services/criticAgentService');
    const thresholds = await criticAgentService.getPauseThresholds();
    res.json({ thresholds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/critic/pause-config', auth, async (req, res) => {
  const { thresholds } = req.body ?? {};
  if (!thresholds || typeof thresholds !== 'object') {
    return res.status(400).json({ error: 'thresholds must be a key→number object' });
  }
  try {
    const { criticAgentService } = await import('../services/criticAgentService');
    await criticAgentService.setPauseThresholds(thresholds);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRITIC AGENT: AUTO-IMPROVE ───────────────────────────────────────────────
router.post('/api/critic/auto-improve/:agentType', auth, async (req, res) => {
  const { agentType } = req.params;
  if (!agentType) return res.status(400).json({ error: 'agentType required' });
  try {
    const { criticAgentService } = await import('../services/criticAgentService');
    const recommendation = await criticAgentService.triggerAutoImprove(agentType);
    res.json({ ok: true, recommendation });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MODEL OVERRIDE: STATUS ────────────────────────────────────────────────────
router.get('/api/models/status', auth, async (_req, res) => {
  try {
    const { getModelOverride } = await import('../config/ai-models');
    const override = getModelOverride();
    const sb = getServiceSupabaseClient();
    const { data: cmaStats } = await sb
      .from('cma_monitor_log')
      .select('system_burn_rate, dynamic_economy_active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    res.json({
      override,
      cma: {
        systemBurnRate:        (cmaStats as any)?.system_burn_rate ?? null,
        dynamicEconomyActive:  (cmaStats as any)?.dynamic_economy_active ?? false,
      },
      models: {
        premium:  process.env.OPENAI_TEXT_MODEL || 'gpt-4o',
        economy:  'gemini-2.0-flash',
      },
      description: {
        auto:    'CMA decides per-user based on subscription tier and burn rate',
        economy: 'All AI operations routed to Gemini Flash (cheaper, faster)',
        premium: 'All AI operations routed to GPT-4o (highest quality)',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MODEL OVERRIDE: SET ───────────────────────────────────────────────────────
router.post('/api/models/override', auth, async (req, res) => {
  try {
    const { mode, reason } = req.body as { mode: string; reason?: string };
    if (!['auto', 'economy', 'premium'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "auto", "economy", or "premium"' });
    }
    const { setModelOverride } = await import('../config/ai-models');
    setModelOverride(mode as 'auto' | 'economy' | 'premium', reason || '');

    // Also persist to DB so override survives server restart if needed
    const sb = getServiceSupabaseClient();
    await sb.from('model_override_config').upsert({
      operation: 'all',
      forced_model: mode,
      override_active: mode !== 'auto',
      reason: reason || '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'operation' });

    res.json({ ok: true, mode, reason: reason || '', message: `Model override set to '${mode}'` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MODEL OVERRIDE: RESET ────────────────────────────────────────────────────
router.delete('/api/models/override', auth, async (_req, res) => {
  try {
    const { setModelOverride } = await import('../config/ai-models');
    setModelOverride('auto', '');
    const sb = getServiceSupabaseClient();
    await sb.from('model_override_config').upsert({
      operation: 'all',
      forced_model: 'auto',
      override_active: false,
      reason: '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'operation' });
    res.json({ ok: true, mode: 'auto', message: 'Model override cleared — CMA auto-routing restored' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GOOGLE DORKS: MANUAL TRIGGER ─────────────────────────────────────────────
router.post('/api/google-dorks/run', auth, async (req, res) => {
  try {
    const { googleDorksService } = await import('../services/googleDorksService');
    // Run in background
    googleDorksService.runDiscoveryCycle().catch((e: any) =>
      console.error('[Admin] Google Dorks manual run error:', e.message)
    );
    res.json({ ok: true, message: 'Google Dorks discovery cycle started in background' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ACCOUNT DELETION REQUESTS ────────────────────────────────────────────────
router.get('/api/account-deletions', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { data, error } = await sb
      .from('account_deletion_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error && error.code !== '42P01') throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/account-deletions/:id/approve', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;

    const { data: req_data } = await sb.from('account_deletion_requests').select('*').eq('id', id).single();
    if (!req_data) return res.status(404).json({ error: 'Request not found' });
    if (req_data.status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

    // Delete the user account
    const { error: delErr } = await sb.auth.admin.deleteUser(req_data.user_id);
    if (delErr) throw delErr;

    await sb.from('account_deletion_requests').update({
      status: 'approved',
      reviewed_by: ADMIN_EMAIL,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    await logAction('approve_deletion', req_data.user_id, req_data.user_email, { request_id: id });
    broadcast('deletion_approved', { id, userId: req_data.user_id, email: req_data.user_email });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/account-deletions/:id/dismiss', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { id } = req.params;

    const { data: req_data } = await sb.from('account_deletion_requests').select('*').eq('id', id).single();
    if (!req_data) return res.status(404).json({ error: 'Request not found' });

    await sb.from('account_deletion_requests').update({
      status: 'dismissed',
      reviewed_by: ADMIN_EMAIL,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id);

    await logAction('dismiss_deletion', req_data.user_id, req_data.user_email, { request_id: id });
    broadcast('deletion_dismissed', { id, userId: req_data.user_id, email: req_data.user_email });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── NOTIFICATION HISTORY ─────────────────────────────────────────────────────
router.get('/api/notifications', auth, async (req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const { data } = await sb.from('notification_logs').select('*').order('sent_at', { ascending: false }).limit(50);
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TRIALS MONITORING ────────────────────────────────────────────────────────
router.get('/api/trials', auth, async (_req, res) => {
  try {
    const sb = getServiceSupabaseClient();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

    const [activeTrials, failedConversions, pastDue] = await Promise.all([
      sb.from('subscriptions')
        .select('user_id, plan, trial_start, trial_end, trial_charged, flw_card_token, billing_email, flw_card_last4, flw_card_brand')
        .eq('status', 'trialing')
        .order('trial_end', { ascending: true }),
      sb.from('energy_transactions')
        .select('user_id, description, created_at, metadata')
        .in('type', ['trial_conversion_failed', 'renewal_failed'])
        .order('created_at', { ascending: false })
        .limit(50),
      sb.from('subscriptions')
        .select('user_id, plan, current_period_end, renewal_next_retry_at, billing_email, flw_card_last4')
        .eq('status', 'past_due')
        .order('renewal_next_retry_at', { ascending: true })
        .limit(50),
    ]);

    const trials = (activeTrials.data || []).map((t: any) => ({
      ...t,
      days_left: t.trial_end ? Math.max(0, Math.ceil((new Date(t.trial_end).getTime() - now.getTime()) / 86400000)) : null,
      upcoming_charge: t.trial_end && new Date(t.trial_end) <= new Date(in48h),
      has_card: !!t.flw_card_token,
    }));

    res.json({
      active_trials: trials,
      upcoming_charges: trials.filter((t: any) => t.upcoming_charge),
      failed_conversions: failedConversions.data || [],
      past_due: pastDue.data || [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SSE REAL-TIME STREAM ─────────────────────────────────────────────────────
router.get('/api/stream', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send a real named event immediately so the browser fires onopen and
  // EventSource transitions from CONNECTING → OPEN right away.
  // flush() is called after every write to bypass proxy buffering (Replit mTLS proxy).
  const flush = () => { try { (res as any).flush?.(); } catch {} };
  try { res.write('event: connected\ndata: {}\n\n'); flush(); } catch {}

  registerSSEClient(res);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); flush(); } catch { clearInterval(ping); unregisterSSEClient(res); }
  }, 5000);

  const pollActivity = setInterval(async () => {
    try {
      const sb = getServiceSupabaseClient();
      const since = new Date(Date.now() - 30000).toISOString();
      const [newUsers, newStrategies, newAgentTasks, newTx, newEvolution] = await Promise.all([
        sb.from('energy_accounts').select('user_id, created_at').gte('created_at', since),
        sb.from('strategies').select('id, title, user_id, created_at').gte('created_at', since),
        sb.from('agent_tasks').select('id, agent_type, task_type, platform, status, user_id, created_at').gte('created_at', since).neq('status', 'pending'),
        sb.from('energy_transactions').select('user_id, type, credits, description, created_at').gte('created_at', since).in('type', ['topup', 'subscription_grant', 'trial_grant']),
        sb.from('self_evolution_log').select('id, agent, cycle_date, analysis, adopted_sources, scaled_back_sources, new_source_ideas, overall_recommendation, created_at').gte('created_at', since).order('created_at', { ascending: false }),
      ]);

      const events: any[] = [];
      (newUsers.data || []).forEach(u => events.push({ type: 'new_user', payload: u }));
      (newStrategies.data || []).forEach(s => events.push({ type: 'new_strategy', payload: s }));
      (newAgentTasks.data || []).forEach(t => events.push({ type: 'agent_task', payload: t }));
      (newTx.data || []).forEach(t => events.push({ type: 'credit_purchase', payload: t }));

      if (events.length > 0) {
        const msg = `event: activity\ndata: ${JSON.stringify(events)}\n\n`;
        try { res.write(msg); flush(); } catch {}
      }

      (newEvolution.data || []).forEach(entry => {
        const msg = `event: evolution_entry\ndata: ${JSON.stringify(entry)}\n\n`;
        try { res.write(msg); flush(); } catch {}
      });
    } catch {}
  }, 10000);

  req.on('close', () => {
    clearInterval(ping);
    clearInterval(pollActivity);
    unregisterSSEClient(res);
  });
});

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────

router.get('/api/feature-flags', auth, async (_req, res) => {
  try {
    const flags = await featureFlags.getAllFlags();
    res.json({ flags });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/feature-flags/:key', auth, async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
    await featureFlags.setGlobalFlag(key, enabled, ADMIN_EMAIL);
    await logAction('feature_flag_toggle', null, null, { flag_key: key, enabled });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/feature-flags/user/:userId', auth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const overrides = await featureFlags.getUserOverrides(userId);
    res.json({ overrides });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/feature-flags/user/:userId/:key', auth, async (req: Request, res: Response) => {
  try {
    const { userId, key } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
    await featureFlags.setUserOverride(userId, key, enabled, ADMIN_EMAIL);
    await logAction('user_feature_override', userId, null, { flag_key: key, enabled });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/feature-flags/user/:userId/:key', auth, async (req: Request, res: Response) => {
  try {
    const { userId, key } = req.params;
    await featureFlags.removeUserOverride(userId, key);
    await logAction('user_feature_override_remove', userId, null, { flag_key: key });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SERVE DASHBOARD HTML ─────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});

// ─── DASHBOARD HTML ───────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>AdRoom Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0B0F19;color:#E2E8F0;min-height:100vh}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#151B2B}
::-webkit-scrollbar-thumb{background:#1E293B;border-radius:3px}
#login{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0B0F19}
#app{display:none;flex-direction:row;min-height:100vh}
.sidebar{width:240px;background:#0D1220;border-right:1px solid #1E293B;display:flex;flex-direction:column;flex-shrink:0;position:fixed;top:0;left:0;height:100vh;overflow-y:auto;z-index:100}
.main{margin-left:240px;flex:1;display:flex;flex-direction:column;min-height:100vh;overflow-x:hidden}
.logo{padding:20px;border-bottom:1px solid #1E293B;display:flex;align-items:center;gap:10px}
.logo-dot{width:10px;height:10px;border-radius:50%;background:#00F0FF;box-shadow:0 0 8px #00F0FF}
.logo-text{font-size:16px;font-weight:800;color:#00F0FF;letter-spacing:1px}
.logo-sub{font-size:10px;color:#64748B;letter-spacing:2px}
.nav-section{padding:8px 12px;color:#475569;font-size:10px;font-weight:700;letter-spacing:1.5px;margin-top:8px}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;border-radius:8px;margin:2px 8px;color:#94A3B8;font-size:13px;font-weight:500;transition:all .15s;border:none;background:none;width:calc(100% - 16px);text-align:left}
.nav-item:hover{background:#151B2B;color:#E2E8F0}
.nav-item.active{background:#00F0FF15;color:#00F0FF;border:1px solid #00F0FF30}
.nav-item .badge{margin-left:auto;background:#EF4444;color:#fff;font-size:10px;padding:1px 6px;border-radius:10px}
.topbar{background:#0D1220;border-bottom:1px solid #1E293B;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar-title{font-size:18px;font-weight:800;color:#E2E8F0}
.topbar-right{display:flex;align-items:center;gap:12px}
.sse-dot{width:8px;height:8px;border-radius:50%;background:#10B981;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.content{padding:24px;flex:1}
.card{background:#151B2B;border:1px solid #1E293B;border-radius:14px;padding:20px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#151B2B;border:1px solid #1E293B;border-radius:14px;padding:16px}
.stat-label{font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.stat-value{font-size:28px;font-weight:800;color:#E2E8F0;margin:6px 0 2px}
.stat-sub{font-size:11px;color:#64748B}
.btn{border:none;cursor:pointer;border-radius:8px;font-weight:600;font-size:13px;padding:8px 14px;transition:all .15s;display:inline-flex;align-items:center;gap:6px}
.btn-primary{background:#00F0FF;color:#020617}
.btn-primary:hover{background:#00D4E0}
.btn-danger{background:#EF444420;color:#EF4444;border:1px solid #EF444440}
.btn-danger:hover{background:#EF444440}
.btn-warn{background:#F59E0B20;color:#F59E0B;border:1px solid #F59E0B40}
.btn-warn:hover{background:#F59E0B40}
.btn-ghost{background:#1E293B;color:#E2E8F0}
.btn-ghost:hover{background:#273449}
.btn-sm{padding:5px 10px;font-size:11px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 14px;font-size:11px;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #1E293B}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid #0F172A;vertical-align:middle}
tr:hover td{background:#1E293B20}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}
.badge-green{background:#10B98120;color:#10B981;border:1px solid #10B98130}
.badge-yellow{background:#F59E0B20;color:#F59E0B;border:1px solid #F59E0B30}
.badge-red{background:#EF444420;color:#EF4444;border:1px solid #EF444430}
.badge-blue{background:#3B82F620;color:#3B82F6;border:1px solid #3B82F630}
.badge-purple{background:#7C3AED20;color:#7C3AED;border:1px solid #7C3AED30}
.badge-gray{background:#1E293B;color:#64748B}
.input{background:#0B0F19;border:1px solid #1E293B;border-radius:8px;padding:9px 14px;color:#E2E8F0;font-size:13px;outline:none;width:100%;transition:border .15s}
.input:focus{border-color:#00F0FF50}
.input-group{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
label{font-size:12px;color:#94A3B8;font-weight:600}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto}
.modal-overlay.open{display:flex}
.modal{background:#0D1220;border:1px solid #1E293B;border-radius:16px;width:100%;max-width:780px;overflow:hidden}
.modal-header{padding:20px 24px;border-bottom:1px solid #1E293B;display:flex;align-items:center;justify-content:space-between}
.modal-title{font-size:16px;font-weight:800}
.modal-body{padding:24px;max-height:70vh;overflow-y:auto}
.close-btn{background:none;border:none;color:#64748B;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px}
.close-btn:hover{background:#1E293B;color:#E2E8F0}
.tabs{display:flex;gap:4px;border-bottom:1px solid #1E293B;margin-bottom:20px}
.tab{padding:8px 16px;font-size:13px;font-weight:600;color:#64748B;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.tab.active{color:#00F0FF;border-bottom-color:#00F0FF}
.section{display:none}
.section.active{display:block}
.activity-feed{max-height:500px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
.activity-item{background:#0B0F19;border:1px solid #1E293B;border-radius:8px;padding:10px 14px;display:flex;align-items:flex-start;gap:10px}
.activity-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.search-bar{position:relative;margin-bottom:16px}
.search-bar input{padding-left:36px}
.search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#64748B;pointer-events:none}
.empty{text-align:center;padding:40px;color:#64748B}
.tag{display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;background:#1E293B;color:#94A3B8;margin:1px}
.progress{height:6px;background:#1E293B;border-radius:3px;overflow:hidden}
.progress-bar{height:100%;border-radius:3px;transition:width .3s}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.detail-item{background:#0B0F19;border-radius:8px;padding:12px}
.detail-label{font-size:11px;color:#64748B;font-weight:600;margin-bottom:4px}
.detail-value{font-size:14px;font-weight:700;color:#E2E8F0}
.user-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.toast{position:fixed;top:20px;right:20px;background:#151B2B;border:1px solid #1E293B;border-radius:10px;padding:12px 16px;font-size:13px;font-weight:600;z-index:999;transform:translateX(120%);transition:transform .3s;display:flex;align-items:center;gap:8px;max-width:320px}
.toast.show{transform:translateX(0)}
.toast.success{border-color:#10B98150;color:#10B981}
.toast.error{border-color:#EF444450;color:#EF4444}
.toast.info{border-color:#3B82F650;color:#3B82F6}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.section-title{font-size:16px;font-weight:800}
.sub-tabs{display:flex;gap:4px;margin-bottom:16px;background:#0B0F19;border-radius:8px;padding:4px;width:fit-content}
.sub-tab{padding:5px 12px;font-size:12px;font-weight:600;color:#64748B;border:none;background:none;cursor:pointer;border-radius:6px;transition:all .15s}
.sub-tab.active{background:#1E293B;color:#E2E8F0}
</style>
</head>
<body>

<!-- TOAST -->
<div id="toast" class="toast"></div>

<!-- LOGIN -->
<div id="login">
  <div style="width:100%;max-width:400px;padding:0 20px">
    <div style="text-align:center;margin-bottom:32px">
      <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="width:10px;height:10px;border-radius:50%;background:#00F0FF;box-shadow:0 0 10px #00F0FF"></div>
        <span style="font-size:22px;font-weight:800;color:#00F0FF;letter-spacing:1px">ADROOM</span>
      </div>
      <div style="font-size:11px;color:#64748B;letter-spacing:3px">ADMIN CONTROL PANEL</div>
    </div>
    <div class="card" style="padding:28px">
      <div class="input-group">
        <label>Admin Email</label>
        <input class="input" id="login-email" type="email" placeholder="admin@adroomai.com" autocomplete="username"/>
      </div>
      <div class="input-group">
        <label>Password</label>
        <input class="input" id="login-pwd" type="password" placeholder="••••••••" autocomplete="current-password"/>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:11px" id="login-btn" onclick="doLogin()">Sign In to Admin Panel</button>
      <div id="login-err" style="color:#EF4444;font-size:12px;margin-top:10px;text-align:center"></div>
    </div>
  </div>
</div>

<!-- APP -->
<div id="app">
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="logo">
      <div class="logo-dot"></div>
      <div>
        <div class="logo-text">ADROOM</div>
        <div class="logo-sub">ADMIN PANEL</div>
      </div>
    </div>
    <div class="nav-section">OVERVIEW</div>
    <button class="nav-item active" onclick="showSection('dashboard')" id="nav-dashboard">
      <span>📊</span> Dashboard
    </button>
    <div class="nav-section">USER MANAGEMENT</div>
    <button class="nav-item" onclick="showSection('users')" id="nav-users">
      <span>👥</span> All Users
    </button>
    <button class="nav-item" onclick="showSection('credits')" id="nav-credits">
      <span>⚡</span> Credits
    </button>
    <div class="nav-section">COMMUNICATIONS</div>
    <button class="nav-item" onclick="showSection('notifications')" id="nav-notifications">
      <span>🔔</span> Push Notifications
    </button>
    <button class="nav-item" onclick="showSection('deletions')" id="nav-deletions">
      <span>🗑️</span> Deletion Requests <span class="badge" id="deletion-badge" style="display:none">0</span>
    </button>
    <div class="nav-section">MONITORING</div>
    <button class="nav-item" onclick="showSection('trials')" id="nav-trials">
      <span>🧪</span> Trials &amp; Billing <span class="badge" id="trials-badge" style="display:none">0</span>
    </button>
    <button class="nav-item" onclick="showSection('activity')" id="nav-activity">
      <span>📡</span> Live Activity
    </button>
    <button class="nav-item" onclick="showSection('terminal')" id="nav-terminal">
      <span>🖥️</span> Live Terminal
    </button>
    <button class="nav-item" onclick="showSection('logs')" id="nav-logs">
      <span>📋</span> Admin Logs
    </button>
    <button class="nav-item" onclick="showSection('cma')" id="nav-cma">
      <span>💰</span> CMA Savings
    </button>
    <button class="nav-item" onclick="showSection('agentnet')" id="nav-agentnet">
      <span>🕸️</span> Agent Network
    </button>
    <button class="nav-item" onclick="showSection('evolution')" id="nav-evolution">
      <span>🧬</span> AI Self-Evolution
    </button>
    <button class="nav-item" onclick="showSection('featureflags')" id="nav-featureflags">
      <span>🎛️</span> Feature Flags
    </button>
    <div class="nav-section">APMA</div>
    <button class="nav-item" onclick="showSection('apma')" id="nav-apma">
      <span>🎯</span> Political Marketing
    </button>
    <div style="margin-top:auto;padding:16px 8px">
      <button class="nav-item" onclick="doLogout()" style="color:#EF4444">
        <span>🚪</span> Sign Out
      </button>
    </div>
  </div>

  <!-- Main -->
  <div class="main">
    <div class="topbar">
      <div class="topbar-title" id="page-title">Dashboard</div>
      <div class="topbar-right">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748B">
          <div class="sse-dot" id="sse-dot" style="background:#EF4444"></div>
          <span id="sse-status">Connecting...</span>
        </div>
        <span style="font-size:12px;color:#64748B" id="admin-badge">ADMIN@ADROOMAI.COM</span>
      </div>
    </div>

    <div class="content">

      <!-- ───────────── DASHBOARD ───────────── -->
      <div id="section-dashboard" class="section active">
        <div class="stats-grid" id="stats-grid">
          <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value" id="stat-users">—</div><div class="stat-sub">Registered accounts</div></div>
          <div class="stat-card"><div class="stat-label">Active Subs</div><div class="stat-value" id="stat-subs">—</div><div class="stat-sub">Active + trialing</div></div>
          <div class="stat-card"><div class="stat-label">Suspended</div><div class="stat-value" id="stat-suspended" style="color:#F59E0B">—</div><div class="stat-sub">Restricted accounts</div></div>
          <div class="stat-card"><div class="stat-label">Strategies</div><div class="stat-value" id="stat-strategies">—</div><div class="stat-sub">Total created</div></div>
          <div class="stat-card"><div class="stat-label">Agent Tasks</div><div class="stat-value" id="stat-agents">—</div><div class="stat-sub">All time</div></div>
          <div class="stat-card"><div class="stat-label">Credits Sold (30d)</div><div class="stat-value" id="stat-credits" style="color:#00F0FF">—</div><div class="stat-sub">Top-ups + subscriptions</div></div>
          <div class="stat-card"><div class="stat-label">AI Cost (30d)</div><div class="stat-value" id="stat-cost" style="color:#F59E0B">—</div><div class="stat-sub">Actual model spend</div></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">
            <div class="section-header"><div class="section-title">Plan Breakdown</div></div>
            <div id="plan-breakdown" style="display:flex;flex-direction:column;gap:10px"></div>
          </div>
          <div class="card">
            <div class="section-header"><div class="section-title">Recent Activity</div><div style="font-size:11px;color:#64748B">Live</div></div>
            <div class="activity-feed" id="live-feed"><div class="empty">Connecting to live feed…</div></div>
          </div>
        </div>
      </div>

      <!-- ───────────── USERS ───────────── -->
      <div id="section-users" class="section">
        <div class="section-header">
          <div class="section-title">All Users</div>
          <button class="btn btn-ghost btn-sm" onclick="loadUsers()">↺ Refresh</button>
        </div>
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input class="input" id="user-search" placeholder="Search by email, name, or user ID…" oninput="filterUsers()" style="padding-left:36px"/>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <table>
            <thead>
              <tr>
                <th>User</th><th>Plan</th><th>Status</th><th>Credits</th><th>Strategies</th><th>Connected</th><th>Joined</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="users-table-body">
              <tr><td colspan="7" class="empty">Loading…</td></tr>
            </tbody>
          </table>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:12px;font-size:13px;color:#64748B" id="users-pagination"></div>
      </div>

      <!-- ───────────── CREDITS ───────────── -->
      <div id="section-credits" class="section">
        <div class="section-header"><div class="section-title">Credit Management</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div class="card">
            <div style="font-size:14px;font-weight:700;margin-bottom:16px">Adjust User Credits</div>
            <div class="input-group">
              <label>User Email or ID</label>
              <input class="input" id="credit-user" placeholder="email@example.com or user UUID"/>
            </div>
            <div class="input-group">
              <label>Operation</label>
              <select class="input" id="credit-type" style="cursor:pointer">
                <option value="credit">➕ Top Up (Add Credits)</option>
                <option value="debit">➖ Deduct (Remove Credits)</option>
              </select>
            </div>
            <div class="input-group">
              <label>Amount (Energy Credits)</label>
              <input class="input" id="credit-amount" type="number" min="1" placeholder="e.g. 50"/>
            </div>
            <div class="input-group">
              <label>Reason (shown in transaction history)</label>
              <input class="input" id="credit-reason" placeholder="e.g. Promo credit, Support refund…"/>
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="applyCredit()">Apply Credit Adjustment</button>
          </div>
          <div class="card">
            <div style="font-size:14px;font-weight:700;margin-bottom:16px">Recent Credit Adjustments</div>
            <div id="credit-log" style="display:flex;flex-direction:column;gap:8px;max-height:380px;overflow-y:auto">
              <div class="empty">No adjustments yet</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ───────────── NOTIFICATIONS ───────────── -->
      <div id="section-notifications" class="section">
        <div class="section-header"><div class="section-title">Push Notifications</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div class="card">
            <div style="font-size:14px;font-weight:700;margin-bottom:16px">Send Notification</div>
            <div class="input-group">
              <label>Target</label>
              <select class="input" id="notif-target-type" onchange="updateNotifTarget()" style="cursor:pointer">
                <option value="all">📢 All Users</option>
                <option value="plan">📋 Specific Plan</option>
                <option value="user">👤 Specific User</option>
              </select>
            </div>
            <div class="input-group" id="notif-plan-group" style="display:none">
              <label>Plan</label>
              <select class="input" id="notif-plan" style="cursor:pointer">
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="pro_plus">Pro+</option>
              </select>
            </div>
            <div class="input-group" id="notif-user-group" style="display:none">
              <label>User Email or ID</label>
              <input class="input" id="notif-user" placeholder="email or user ID"/>
            </div>
            <div class="input-group">
              <label>Title</label>
              <input class="input" id="notif-title" placeholder="e.g. New Feature Alert!"/>
            </div>
            <div class="input-group">
              <label>Message Body</label>
              <textarea class="input" id="notif-body" rows="4" placeholder="Notification message…" style="resize:vertical"></textarea>
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="sendNotification()">Send Push Notification</button>
          </div>
          <div class="card">
            <div style="font-size:14px;font-weight:700;margin-bottom:16px">Notification History</div>
            <div id="notif-history" style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto">
              <div class="empty">Loading…</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ───────────── DELETION REQUESTS ───────────── -->
      <div id="section-deletions" class="section">
        <div class="section-header">
          <div class="section-title">Account Deletion Requests</div>
          <button class="btn btn-ghost btn-sm" onclick="loadDeletionRequests()">↺ Refresh</button>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <table>
            <thead>
              <tr><th>User</th><th>Reason</th><th>Status</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody id="deletions-table-body">
              <tr><td colspan="5" class="empty">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ───────────── TRIALS & BILLING ───────────── -->
      <div id="section-trials" class="section">
        <div class="section-header">
          <div class="section-title">Trials &amp; Billing Monitor</div>
          <button class="btn btn-ghost btn-sm" onclick="loadTrials()">↺ Refresh</button>
        </div>

        <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
          <div class="stat-card"><div class="stat-label">Active Trials</div><div class="stat-value" id="trials-active-count" style="color:#00F0FF">—</div><div class="stat-sub">Currently trialing</div></div>
          <div class="stat-card"><div class="stat-label">Charging in 48h</div><div class="stat-value" id="trials-upcoming-count" style="color:#F59E0B">—</div><div class="stat-sub">Day-15 upcoming</div></div>
          <div class="stat-card"><div class="stat-label">Failed Conversions</div><div class="stat-value" id="trials-failed-count" style="color:#EF4444">—</div><div class="stat-sub">Last 50 events</div></div>
          <div class="stat-card"><div class="stat-label">Past Due</div><div class="stat-value" id="trials-pastdue-count" style="color:#F59E0B">—</div><div class="stat-sub">Renewal failures</div></div>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;color:#E2E8F0;margin-bottom:14px">Active Trials</div>
          <table>
            <thead><tr><th>User</th><th>Plan</th><th>Days Left</th><th>Card Saved</th><th>Trial End</th><th>Status</th></tr></thead>
            <tbody id="trials-active-body"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
          </table>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;color:#F59E0B;margin-bottom:14px">⚠ Charging Within 48 Hours</div>
          <table>
            <thead><tr><th>User</th><th>Plan</th><th>Days Left</th><th>Card</th><th>Billing Email</th><th>Trial End</th></tr></thead>
            <tbody id="trials-upcoming-body"><tr><td colspan="6" class="empty">None upcoming</td></tr></tbody>
          </table>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;color:#EF4444;margin-bottom:14px">Failed Conversions &amp; Renewals</div>
          <table>
            <thead><tr><th>User</th><th>Type</th><th>Description</th><th>Time</th></tr></thead>
            <tbody id="trials-failed-body"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody>
          </table>
        </div>

        <div class="card">
          <div style="font-size:13px;font-weight:700;color:#F59E0B;margin-bottom:14px">Past Due — Renewal Retries Pending</div>
          <table>
            <thead><tr><th>User</th><th>Plan</th><th>Card</th><th>Next Retry</th><th>Period End</th></tr></thead>
            <tbody id="trials-pastdue-body"><tr><td colspan="5" class="empty">None past due</td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- ───────────── LIVE ACTIVITY ───────────── -->
      <div id="section-activity" class="section">
        <div class="section-header">
          <div class="section-title">Live Activity Feed</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="sse-dot" id="sse-dot-activity" style="background:#EF4444"></div>
            <span style="font-size:12px;color:#64748B" id="sse-status-activity">Connecting…</span>
          </div>
        </div>
        <div class="card" style="padding:16px">
          <div class="activity-feed" id="activity-full" style="max-height:600px">
            <div class="empty">Waiting for events…</div>
          </div>
        </div>
      </div>

      <!-- ───────────── LIVE TERMINAL ───────────── -->
      <div id="section-terminal" class="section">
        <div class="section-header">
          <div class="section-title">Live Server Terminal</div>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="sse-dot" id="term-sse-dot" style="background:#EF4444"></div>
            <span style="font-size:12px;color:#64748B" id="term-sse-status">Connecting…</span>
            <button class="btn btn-ghost btn-sm" onclick="termPaused=!termPaused;this.textContent=termPaused?'▶ Resume':'⏸ Pause'">⏸ Pause</button>
            <button class="btn btn-ghost btn-sm" onclick="clearTerminal()">🗑 Clear</button>
            <span style="font-size:11px;color:#475569" id="term-line-count">0 lines</span>
          </div>
        </div>
        <div style="
          background:#0A0E1A;border:1px solid #1E293B;border-radius:14px;
          padding:0;overflow:hidden;font-family:'Courier New',monospace
        ">
          <div style="
            background:#0D1117;border-bottom:1px solid #1E293B;
            padding:8px 14px;display:flex;align-items:center;gap:8px
          ">
            <div style="width:10px;height:10px;border-radius:50%;background:#EF4444;opacity:.8"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:#F59E0B;opacity:.8"></div>
            <div style="width:10px;height:10px;border-radius:50%;background:#10B981;opacity:.8"></div>
            <span style="color:#475569;font-size:11px;margin-left:8px">adroom-backend — live output</span>
          </div>
          <div id="terminal-output" style="
            height:580px;overflow-y:auto;padding:12px 16px;
            font-size:12px;line-height:1.7;scroll-behavior:smooth
          ">
            <div style="color:#475569;font-style:italic">Waiting for server logs…</div>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('')" id="term-filter-all" style="border-color:#00F0FF;color:#00F0FF">All</button>
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('INFO')" id="term-filter-info">Info</button>
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('WARN')" id="term-filter-warn" style="color:#F59E0B">Warnings</button>
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('ERROR')" id="term-filter-error" style="color:#EF4444">Errors</button>
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('Scheduler')" id="term-filter-sched">Scheduler</button>
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('Agent')" id="term-filter-agent">Agents</button>
          <button class="btn btn-ghost btn-sm" onclick="setTermFilter('Energy')" id="term-filter-energy">Energy</button>
        </div>
      </div>

      <!-- ───────────── ADMIN LOGS ───────────── -->
      <div id="section-logs" class="section">
        <div class="section-header">
          <div class="section-title">Admin Action Logs</div>
          <button class="btn btn-ghost btn-sm" onclick="loadAdminLogs()">↺ Refresh</button>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          <table>
            <thead>
              <tr><th>Time</th><th>Action</th><th>Target</th><th>Details</th></tr>
            </thead>
            <tbody id="admin-logs-body">
              <tr><td colspan="4" class="empty">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ───────────── AGENT NETWORK ───────────── -->
      <div id="section-agentnet" class="section">
        <div class="section-header">
          <div class="section-title">Agent Network — Real-Time Activity Map</div>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="sse-dot" id="sse-dot-2" style="background:#EF4444"></div>
            <span id="sse-status-2" style="font-size:12px;color:#64748B">Connecting…</span>
            <button class="btn btn-ghost btn-sm" onclick="loadAgentNetwork()">↺ Refresh</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 340px;gap:16px">
          <!-- SVG Node Graph -->
          <div class="card" style="padding:0;overflow:hidden;min-height:480px;position:relative">
            <div style="position:absolute;top:12px;left:16px;font-size:11px;color:#475569;z-index:10;display:flex;gap:12px">
              <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#10B981;display:inline-block"></span>Active</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#F59E0B;display:inline-block"></span>Pending</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#EF4444;display:inline-block"></span>Failed</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#00F0FF;display:inline-block"></span>Intelligence</span>
            </div>
            <svg id="agent-network-svg" width="100%" height="480" style="display:block"></svg>
          </div>
          <!-- Live event feed -->
          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="card" style="flex:1;min-height:220px">
              <div style="font-size:13px;font-weight:700;margin-bottom:12px;color:#00F0FF">⚡ Live Agent Events</div>
              <div id="agentnet-feed" style="display:flex;flex-direction:column;gap:6px;max-height:170px;overflow-y:auto">
                <div class="empty">Waiting for agent activity…</div>
              </div>
            </div>
            <div class="card">
              <div style="font-size:13px;font-weight:700;margin-bottom:12px">Agent Status</div>
              <div id="agentnet-status" style="display:flex;flex-direction:column;gap:8px"></div>
            </div>
            <div class="card">
              <div style="font-size:13px;font-weight:700;margin-bottom:10px">Intelligence Engines</div>
              <div id="agentnet-engines" style="display:flex;flex-direction:column;gap:8px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="color:#CBD5E1;font-size:12px">Platform Intelligence (IPE)</span>
                  <span id="eng-ipe" class="badge badge-gray">Idle</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="color:#CBD5E1;font-size:12px">Social Listening</span>
                  <span id="eng-social" class="badge badge-gray">Idle</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="color:#CBD5E1;font-size:12px">Emotional Intelligence</span>
                  <span id="eng-emotional" class="badge badge-gray">Idle</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="color:#CBD5E1;font-size:12px">GEO Monitoring</span>
                  <span id="eng-geo" class="badge badge-gray">Idle</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="color:#CBD5E1;font-size:12px">AI Brain</span>
                  <span id="eng-brain" class="badge badge-gray">Idle</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ───────────── AI SELF-EVOLUTION LOG ───────────── -->
      <div id="section-evolution" class="section">
        <div class="section-header">
          <div class="section-title">AI Self-Evolution — Live Benchmark &amp; Decision Log</div>
          <div style="display:flex;gap:8px;align-items:center">
            <div id="evo-live-dot" style="width:8px;height:8px;border-radius:50%;background:#10B981;box-shadow:0 0 6px #10B981;flex-shrink:0"></div>
            <span id="evo-live-label" style="font-size:12px;color:#64748B">Live</span>
            <select id="evo-type-filter" class="input" style="width:160px;padding:4px 8px;font-size:12px" onchange="loadEvolutionLog()">
              <option value="">All Agents</option>
              <option value="LEAD_DISCOVERY">Lead Discovery</option>
              <option value="SALESMAN">Salesman</option>
              <option value="AWARENESS">Awareness</option>
              <option value="PROMOTION">Promotion</option>
              <option value="LAUNCH">Launch</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="loadEvolutionLog()">↺ Refresh</button>
          </div>
        </div>

        <!-- KPI strip -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          <div class="stat-card">
            <div class="stat-label">Total Cycles</div>
            <div class="stat-value" id="evo-total" style="color:#818CF8">—</div>
            <div class="stat-sub">all time</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Last 24 h</div>
            <div class="stat-value" id="evo-24h" style="color:#38BDF8">—</div>
            <div class="stat-sub">cycles run</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg Sources Adopted</div>
            <div class="stat-value" id="evo-avg-delta" style="color:#10B981">—</div>
            <div class="stat-sub">per cycle</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Last Cycle</div>
            <div class="stat-value" id="evo-last-time" style="font-size:16px;color:#F59E0B">—</div>
            <div class="stat-sub" id="evo-last-type">—</div>
          </div>
        </div>

        <!-- Performance Delta Chart -->
        <div class="card" style="margin-bottom:16px;padding:14px 16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div>
              <div style="font-size:13px;font-weight:700">📈 Sources Adopted vs Scaled Back Over Time</div>
              <div style="font-size:11px;color:#475569;margin-top:2px">Each bar = one AI self-evolution cycle. Green = sources the AI adopted, Red = sources scaled back.</div>
            </div>
            <div style="display:flex;gap:12px;font-size:11px;align-items:center">
              <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#10B981;display:inline-block"></span>Adopted</span>
              <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#EF4444;display:inline-block"></span>Scaled back</span>
            </div>
          </div>
          <svg id="evo-chart-svg" width="100%" height="180" style="display:block;overflow:visible"></svg>
          <div id="evo-chart-empty" style="display:none;text-align:center;padding:40px 0;color:#475569;font-size:12px">No evolution cycles yet — the AI will chart its decisions here once the Lead Discovery agent runs.</div>
        </div>

        <!-- Live event ticker -->
        <div class="card" style="margin-bottom:16px;padding:14px 16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:13px;font-weight:700;color:#00F0FF">⚡ Real-Time Evolution Feed</div>
            <button onclick="clearEvolutionFeed()" style="font-size:11px;color:#475569;background:none;border:none;cursor:pointer">Clear</button>
          </div>
          <div id="evo-ticker" style="display:flex;flex-direction:column;gap:5px;max-height:140px;overflow-y:auto">
            <div class="empty">Waiting for evolution events…</div>
          </div>
        </div>

        <!-- Full log table -->
        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid #1E293B;display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:13px;font-weight:700">Evolution Log</div>
            <span id="evo-count-badge" class="badge badge-gray">0 entries</span>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#0B0F19">
                  <th style="padding:10px 14px;text-align:left;color:#475569;font-weight:600;white-space:nowrap">Time</th>
                  <th style="padding:10px 14px;text-align:left;color:#475569;font-weight:600">Agent</th>
                  <th style="padding:10px 14px;text-align:left;color:#475569;font-weight:600">Analysis</th>
                  <th style="padding:10px 14px;text-align:left;color:#475569;font-weight:600">Recommendation</th>
                  <th style="padding:10px 14px;text-align:right;color:#475569;font-weight:600">✅ Adopted</th>
                  <th style="padding:10px 14px;text-align:right;color:#475569;font-weight:600">🔽 Scaled Back</th>
                  <th style="padding:10px 14px;text-align:right;color:#475569;font-weight:600">💡 New Ideas</th>
                </tr>
              </thead>
              <tbody id="evo-log-body">
                <tr><td colspan="7" style="padding:24px;text-align:center;color:#475569">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div><!-- /section-evolution -->

      <!-- ───────────── FEATURE FLAGS ───────────── -->
      <div id="section-featureflags" class="section">
        <div class="section-header">
          <div class="section-title">Feature Flags — App Feature Control</div>
          <button class="btn btn-ghost btn-sm" onclick="loadFeatureFlags()">↺ Refresh</button>
        </div>

        <!-- Global flags -->
        <div class="card" style="margin-bottom:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div>
              <div style="font-size:14px;font-weight:700;color:#E2E8F0">Global Feature Switches</div>
              <div style="font-size:12px;color:#64748B;margin-top:2px">Turn features on or off for all users at once. User overrides take precedence.</div>
            </div>
            <div id="ff-save-status" style="font-size:12px;color:#22C55E;opacity:0;transition:opacity .3s">✓ Saved</div>
          </div>
          <div id="ff-global-list" style="display:flex;flex-direction:column;gap:2px">
            <div class="empty">Loading…</div>
          </div>
        </div>

        <!-- Per-user overrides -->
        <div class="card">
          <div style="font-size:14px;font-weight:700;color:#E2E8F0;margin-bottom:4px">Per-User Overrides</div>
          <div style="font-size:12px;color:#64748B;margin-bottom:14px">Enter a user ID to view or set per-user flag overrides.</div>
          <div style="display:flex;gap:10px;margin-bottom:16px">
            <input id="ff-user-id-input" type="text" placeholder="User UUID…"
              style="flex:1;background:#0B1120;border:1px solid #334155;border-radius:8px;padding:10px 14px;color:#F1F5F9;font-size:13px;outline:none"
              onkeydown="if(event.key==='Enter') loadUserOverrides()" />
            <button class="btn btn-sm" onclick="loadUserOverrides()">Load</button>
          </div>
          <div id="ff-user-overrides-list" style="display:flex;flex-direction:column;gap:2px"></div>
        </div>
      </div><!-- /section-featureflags -->

      <!-- ───────────── CMA SAVINGS ───────────── -->
      <div id="section-cma" class="section">
        <div class="section-header">
          <div class="section-title">Credit Management Agent — Savings Dashboard</div>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="cma-days-select" class="input" style="width:120px;padding:4px 8px;font-size:12px" onchange="loadCMAStats()">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="loadCMAStats()">↺ Refresh</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          <div class="stat-card">
            <div class="stat-label">Credits Saved</div>
            <div class="stat-value" id="cma-saved-credits" style="color:#10B981">—</div>
            <div class="stat-sub">via economy routing</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">USD Saved</div>
            <div class="stat-value" id="cma-saved-usd" style="color:#10B981">—</div>
            <div class="stat-sub">actual model cost</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Economy Events</div>
            <div class="stat-value" id="cma-events" style="color:#00F0FF">—</div>
            <div class="stat-sub">total routing decisions</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Economy Ratio</div>
            <div class="stat-value" id="cma-ratio" style="color:#F59E0B">—</div>
            <div class="stat-sub">% ops routed to cheap model</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div class="card">
            <div class="section-header"><div class="section-title" style="font-size:14px">Live System Status</div></div>
            <div id="cma-live-status" style="font-size:13px;color:#94A3B8">Loading…</div>
          </div>
          <div class="card">
            <div class="section-header"><div class="section-title" style="font-size:14px">Savings by Operation</div></div>
            <div id="cma-by-op" style="font-size:13px;color:#94A3B8">Loading…</div>
          </div>
        </div>
        <div class="card">
          <div class="section-header"><div class="section-title" style="font-size:14px">System Burn Rate (last 1h)</div></div>
          <div id="cma-burn-rate" style="font-size:24px;font-weight:800;color:#00F0FF">—</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">credits consumed in the last 60 minutes across all users</div>
        </div>

        <!-- ── AI PROVIDER BALANCES ─────────────────────────────────────── -->
        <div style="margin-top:16px">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title" style="font-size:14px">AI Provider Balances — This Month</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-size:11px;color:#64748B" id="mc-updated">—</span>
              <button class="btn btn-ghost btn-sm" onclick="loadModelCredits()">↺ Refresh</button>
            </div>
          </div>
          <div id="mc-error" style="display:none;color:#EF4444;font-size:13px;margin-bottom:8px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" id="mc-grid">

            <!-- OpenAI card -->
            <div class="card" style="border:1px solid #10A37F33;padding:20px">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                <div style="background:#10A37F;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;color:#fff;letter-spacing:0.5px">OpenAI</div>
                <div>
                  <div style="font-size:14px;font-weight:700;color:#E2E8F0">GPT-4o</div>
                  <div style="font-size:11px;color:#64748B">OpenAI API</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
                <div style="background:#0F1929;border-radius:8px;padding:10px">
                  <div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px">Internal Tracked</div>
                  <div style="font-size:20px;font-weight:800;color:#10B981" id="mc-oai-internal">—</div>
                  <div style="font-size:10px;color:#64748B">from ai_usage_logs</div>
                </div>
                <div style="background:#0F1929;border-radius:8px;padding:10px">
                  <div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px">Live API Spend</div>
                  <div style="font-size:20px;font-weight:800;color:#00F0FF" id="mc-oai-live">—</div>
                  <div style="font-size:10px;color:#64748B">from OpenAI billing</div>
                </div>
              </div>
              <div style="margin-bottom:12px" id="mc-oai-limits-row" style="display:none">
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#94A3B8;margin-bottom:4px">
                  <span>Soft limit</span><span id="mc-oai-soft">—</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#94A3B8;margin-bottom:4px">
                  <span>Hard limit</span><span id="mc-oai-hard">—</span>
                </div>
                <div style="height:6px;background:#1E293B;border-radius:3px;overflow:hidden;margin-top:8px">
                  <div id="mc-oai-bar" style="height:100%;background:linear-gradient(90deg,#10A37F,#00F0FF);border-radius:3px;width:0%;transition:width 0.5s"></div>
                </div>
                <div style="font-size:10px;color:#64748B;margin-top:3px" id="mc-oai-pct">0% of hard limit used</div>
              </div>
              <div id="mc-oai-api-error" style="display:none;font-size:11px;color:#F59E0B;margin-bottom:10px"></div>
              <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Model Breakdown</div>
              <div id="mc-oai-breakdown" style="font-size:12px;color:#94A3B8">—</div>
            </div>

            <!-- Google card -->
            <div class="card" style="border:1px solid #4285F433;padding:20px">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                <div style="background:linear-gradient(135deg,#4285F4,#34A853);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;color:#fff;letter-spacing:0.5px">Google</div>
                <div>
                  <div style="font-size:14px;font-weight:700;color:#E2E8F0">Gemini + Imagen</div>
                  <div style="font-size:11px;color:#64748B">Google AI Studio</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
                <div style="background:#0F1929;border-radius:8px;padding:10px">
                  <div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px">Internal Tracked</div>
                  <div style="font-size:20px;font-weight:800;color:#10B981" id="mc-goog-internal">—</div>
                  <div style="font-size:10px;color:#64748B">from ai_usage_logs</div>
                </div>
                <div style="background:#0F1929;border-radius:8px;padding:10px">
                  <div style="font-size:10px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px">API Balance</div>
                  <div style="font-size:20px;font-weight:800;color:#94A3B8" id="mc-goog-live">N/A</div>
                  <div style="font-size:10px;color:#64748B">no balance API</div>
                </div>
              </div>
              <div style="font-size:11px;color:#F59E0B;background:#F59E0B11;border-radius:6px;padding:8px 10px;margin-bottom:12px">
                ℹ️ Google AI Studio does not expose a credit balance via API key. Spend is tracked internally from usage logs. Check your quota at <a href="https://console.cloud.google.com/billing" target="_blank" style="color:#4285F4">Google Cloud Console</a>.
              </div>
              <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Model Breakdown</div>
              <div id="mc-goog-breakdown" style="font-size:12px;color:#94A3B8">—</div>
            </div>

          </div><!-- /mc-grid -->

          <!-- Total row -->
          <div class="card" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;padding:14px 20px">
            <div style="font-size:13px;color:#94A3B8">Total AI spend this month (all providers)</div>
            <div style="font-size:20px;font-weight:800;color:#00F0FF" id="mc-total">—</div>
          </div>
        </div>
      </div>

      <!-- ───────────── APMA POLITICAL MARKETING ───────────── -->
      <div id="section-apma" class="section">
        <div class="section-header">
          <div class="section-title">APMA — Autonomous Political Marketing Agent</div>
          <div style="display:flex;gap:8px;align-items:center">
            <span id="apma-migration-badge" style="font-size:11px;padding:3px 8px;border-radius:4px;background:#1E293B;color:#64748B">Checking schema…</span>
            <button class="btn btn-ghost btn-sm" id="apma-migration-btn" onclick="apmaRunMigration()" style="display:none">⚡ Apply Migration</button>
            <button class="btn btn-ghost btn-sm" onclick="loadAPMASection()">↺ Refresh</button>
          </div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
          <div class="stat-card"><div class="stat-label">Active Clients</div><div class="stat-value" id="apma-stat-clients" style="color:#818CF8">—</div></div>
          <div class="stat-card"><div class="stat-label">Active Campaigns</div><div class="stat-value" id="apma-stat-campaigns" style="color:#00F0FF">—</div></div>
          <div class="stat-card"><div class="stat-label">Actions (24h)</div><div class="stat-value" id="apma-stat-actions" style="color:#22C55E">—</div></div>
          <div class="stat-card"><div class="stat-label">Live Blogs</div><div class="stat-value" id="apma-stat-blogs" style="color:#F59E0B">—</div></div>
          <div class="stat-card"><div class="stat-label">Active Personas</div><div class="stat-value" id="apma-stat-personas" style="color:#94A3B8">—</div></div>
        </div>

        <!-- Live Cycle Monitor -->
        <div class="card" style="margin-bottom:16px">
          <div class="section-header" style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px">
              <div class="section-title" style="font-size:14px">Live Cycle Monitor</div>
              <div id="apma-monitor-dot" style="width:8px;height:8px;border-radius:50%;background:#475569;flex-shrink:0"></div>
              <span id="apma-monitor-status" style="font-size:11px;color:#64748B">Idle</span>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="clearAPMAMonitorLog()">Clear</button>
          </div>
          <div id="apma-monitor-feed" style="height:200px;overflow-y:auto;font-family:monospace;font-size:11px;background:#0A1628;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:3px">
            <span style="color:#475569">Waiting for cycle events…</span>
          </div>
        </div>

        <!-- Client List -->
        <div class="card" style="margin-bottom:16px">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title" style="font-size:14px">Clients</div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="color:#64748B;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1E293B">
                <th style="padding:8px 12px;text-align:left">Name</th>
                <th style="padding:8px 12px;text-align:left">Country</th>
                <th style="padding:8px 12px;text-align:left">Goal</th>
                <th style="padding:8px 12px;text-align:left">Score</th>
                <th style="padding:8px 12px;text-align:left">Status</th>
                <th style="padding:8px 12px;text-align:left">Actions</th>
              </tr>
            </thead>
            <tbody id="apma-client-list">
              <tr><td colspan="6" style="text-align:center;color:#64748B;padding:20px">Loading...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Campaigns Panel -->
        <div class="card" id="apma-campaigns-panel" style="display:none;margin-bottom:16px">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title" style="font-size:14px" id="apma-campaigns-title">Campaigns</div>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('apma-new-campaign-form').style.display=document.getElementById('apma-new-campaign-form').style.display==='none'?'block':'none'">+ New Campaign</button>
          </div>
          <!-- New campaign form -->
          <div id="apma-new-campaign-form" style="display:none;background:#1A2540;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
              <input id="apma-camp-name" class="input" placeholder="Campaign name *" style="font-size:13px" />
              <input id="apma-camp-keywords" class="input" placeholder="Keywords (comma-separated) *" style="font-size:13px" />
              <input id="apma-camp-platforms" class="input" placeholder="Platforms (default: twitter,facebook,reddit)" style="font-size:13px" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
              <div>
                <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Campaign Type</label>
                <select id="apma-camp-type" class="input" style="font-size:13px">
                  <option value="gubernatorial">Gubernatorial</option>
                  <option value="presidential">Presidential</option>
                  <option value="senate">Senate</option>
                  <option value="house">House</option>
                  <option value="mayoral">Mayoral</option>
                  <option value="city_council">City Council</option>
                  <option value="public_perception">Public Perception</option>
                </select>
              </div>
              <div>
                <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Campaign Subtype</label>
                <select id="apma-camp-subtype" class="input" style="font-size:13px">
                  <option value="build">Build (grow positive narrative)</option>
                  <option value="defend">Defend (protect reputation)</option>
                  <option value="offensive">Offensive (attack rivals)</option>
                  <option value="defensive">Defensive (counter attacks)</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Duration (months)</label>
                <select id="apma-camp-duration" class="input" style="font-size:13px">
                  <option value="6">6 months</option>
                  <option value="12" selected>12 months</option>
                  <option value="18">18 months</option>
                  <option value="24">24 months</option>
                </select>
              </div>
            </div>
            <button id="apma-camp-btn" class="btn btn-primary" onclick="apmaCreateCampaign()">Create Campaign</button>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="color:#64748B;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1E293B">
                <th style="padding:8px 12px;text-align:left">Name / Type</th>
                <th style="padding:8px 12px;text-align:left">Status</th>
                <th style="padding:8px 12px;text-align:left">Score / Target</th>
                <th style="padding:8px 12px;text-align:left">Start Date</th>
                <th style="padding:8px 12px;text-align:left">Duration</th>
                <th style="padding:8px 12px;text-align:left">Actions</th>
              </tr>
            </thead>
            <tbody id="apma-campaign-list">
              <tr><td colspan="6" style="color:#64748B;text-align:center;padding:16px">Select a client above</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Campaign Analytics Panel -->
        <div class="card" id="apma-analytics-panel" style="display:none;margin-bottom:16px">
          <div class="section-header" style="margin-bottom:16px">
            <div class="section-title" style="font-size:14px" id="apma-analytics-title">Analytics</div>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('apma-analytics-panel').style.display='none'">✕ Close</button>
          </div>
          <div id="apma-analytics-content">
            <div style="color:#64748B;text-align:center;padding:40px">Select a campaign to view analytics.</div>
          </div>
        </div>

        <!-- Campaign Overview Panel -->
        <div class="card" id="apma-overview-panel" style="display:none;margin-bottom:16px">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title" style="font-size:14px">Campaign Overview</div>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('apma-overview-panel').style.display='none'">✕ Close</button>
          </div>
          <div id="apma-overview-content" style="font-size:13px;color:#94A3B8">Select a campaign to view overview.</div>
        </div>

        <!-- Create Client Form -->
        <div class="card">
          <div class="section-header" style="margin-bottom:12px">
            <div class="section-title" style="font-size:14px">Create New Client</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div>
              <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Client Name *</label>
              <input id="apma-new-name" class="input" placeholder="e.g. President Candidate 2027" style="font-size:13px" />
            </div>
            <div>
              <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Country Code * (ISO 2-letter)</label>
              <input id="apma-new-country" class="input" placeholder="e.g. NG, GH, KE, ZA, US, GB..." style="font-size:13px;text-transform:uppercase" />
            </div>
            <div>
              <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Campaign Goal</label>
              <select id="apma-new-goal" class="input" style="font-size:13px">
                <option value="improve">Improve — Build positive narrative</option>
                <option value="damage">Damage — Counter opposition narrative</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Keywords (comma-separated)</label>
              <input id="apma-new-keywords" class="input" placeholder="e.g. economic growth, infrastructure, reform" style="font-size:13px" />
            </div>
            <div style="grid-column:1/-1">
              <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Target Entities to Monitor (comma-separated, optional)</label>
              <input id="apma-new-targets" class="input" placeholder="e.g. Opposition Party, Rival Candidate" style="font-size:13px" />
            </div>
          </div>
          <div style="font-size:11px;color:#64748B;margin-bottom:12px;background:#0F172A;border-radius:6px;padding:10px">
            💡 Once created, the client receives an API key for the desktop app. APMA will autonomously generate country-appropriate personas and begin campaigns on the next 15-minute scheduler cycle.
          </div>
          <button id="apma-create-btn" class="btn btn-primary" onclick="apmaCreateClient()">Create Client</button>
        </div>

        <!-- Desktop Releases -->
        <div class="card" style="margin-bottom:16px">
          <div class="section-header" style="margin-bottom:14px">
            <div class="section-title" style="font-size:14px">Desktop App Releases</div>
            <span style="font-size:11px;color:#64748B">Publish a new version → desktop app notifies users automatically</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
            <thead>
              <tr style="border-bottom:1px solid #1E293B">
                <th style="padding:8px 12px;text-align:left;color:#64748B;font-weight:500">Version</th>
                <th style="padding:8px 12px;text-align:left;color:#64748B;font-weight:500">Released</th>
                <th style="padding:8px 12px;text-align:left;color:#64748B;font-weight:500">Download URL</th>
                <th style="padding:8px 12px;text-align:left;color:#64748B;font-weight:500">Force</th>
                <th style="padding:8px 12px;text-align:left;color:#64748B;font-weight:500">Status</th>
              </tr>
            </thead>
            <tbody id="desktop-releases-body">
              <tr><td colspan="5" style="text-align:center;color:#64748B;padding:20px">Loading…</td></tr>
            </tbody>
          </table>

          <div style="border-top:1px solid #1E293B;padding-top:14px">
            <div style="font-size:12px;font-weight:600;color:#94A3B8;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Publish New Release</div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:10px">
              <div>
                <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Version (e.g. 1.1.0)</label>
                <input id="dr-version" type="text" placeholder="1.1.0" class="form-input" style="width:100%" />
              </div>
              <div>
                <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Download URL (.exe / .dmg / .AppImage)</label>
                <input id="dr-url" type="url" placeholder="https://your-server.com/releases/APMA-Dashboard-Setup-1.1.0.exe" class="form-input" style="width:100%" />
              </div>
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:11px;color:#64748B;display:block;margin-bottom:4px">Release Notes (optional)</label>
              <textarea id="dr-notes" rows="2" placeholder="What changed in this version…" class="form-input" style="width:100%;resize:vertical"></textarea>
            </div>
            <div style="display:flex;align-items:center;gap:20px;margin-bottom:12px">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94A3B8;cursor:pointer">
                <input type="checkbox" id="dr-force" /> Force update (users must update before using the app)
              </label>
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94A3B8;cursor:pointer">
                <input type="checkbox" id="dr-min" /> Set as minimum supported version
              </label>
            </div>
            <button id="dr-publish-btn" class="btn btn-primary btn-sm" onclick="publishDesktopRelease()">Publish Release</button>
          </div>
        </div>

      </div><!-- /section-apma -->

    </div><!-- /content -->
  </div><!-- /main -->
</div><!-- /app -->

<!-- USER DETAIL MODAL -->
<div class="modal-overlay" id="user-modal">
  <div class="modal" style="max-width:860px">
    <div class="modal-header">
      <div>
        <div class="modal-title" id="modal-user-email">User Detail</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px" id="modal-user-id"></div>
      </div>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="user-actions" id="modal-actions"></div>
      <div class="tabs" id="modal-tabs">
        <button class="tab active" onclick="showModalTab('overview')">Overview</button>
        <button class="tab" onclick="showModalTab('plan')" style="color:#00F0FF">🎯 Plan</button>
        <button class="tab" onclick="showModalTab('strategies')">Strategies</button>
        <button class="tab" onclick="showModalTab('agents')">Agent Tasks</button>
        <button class="tab" onclick="showModalTab('ai')">AI Usage</button>
        <button class="tab" onclick="showModalTab('transactions')">Transactions</button>
      </div>
      <div id="modal-overview" class="section active"></div>
      <div id="modal-plan" class="section"></div>
      <div id="modal-strategies" class="section"></div>
      <div id="modal-agents" class="section"></div>
      <div id="modal-ai" class="section"></div>
      <div id="modal-transactions" class="section"></div>
    </div>
  </div>
</div>

<script>
let TOKEN = localStorage.getItem('admin_token') || '';
let allUsers = [];
let currentUserId = null;
let evtSource = null;
let sseRetryCount = 0;
let sseRetryTimer = null;
let agentNetPoller = null;
const activityLog = [];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/admin' + path, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = (type === 'success' ? '✅ ' : type === 'error' ? '❌ ' : 'ℹ️ ') + msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3500);
}
// Alias used by APMA and other sections
function showToast(msg, type = 'info') { toast(msg, type); }

function timeAgo(ts) {
  if (!ts) return '—';
  const d = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60) return d + 's ago';
  if (d < 3600) return Math.round(d / 60) + 'm ago';
  if (d < 86400) return Math.round(d / 3600) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

function fmtDate(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }
function fmtN(n) { return n != null ? Number(n).toLocaleString() : '—'; }

function planBadge(plan, status) {
  const colors = { starter: 'badge-blue', pro: 'badge-purple', pro_plus: 'badge-yellow', none: 'badge-gray' };
  const labels = { starter: 'Starter', pro: 'Pro', pro_plus: 'Pro+', none: 'Free' };
  const dim = (status === 'active' || status === 'trialing') ? '' : 'opacity:.5';
  return \`<span class="badge \${colors[plan] || 'badge-gray'}" style="\${dim}">\${labels[plan] || plan}</span>\`;
}

function statusBadge(s) {
  if (s === 'active') return '<span class="badge badge-green">Active</span>';
  if (s === 'trialing') return '<span class="badge badge-blue">Trial</span>';
  if (s === 'suspended') return '<span class="badge badge-red">Suspended</span>';
  if (s === 'cancelled') return '<span class="badge badge-gray">Cancelled</span>';
  if (s === 'inactive') return '<span class="badge badge-gray">Inactive</span>';
  return \`<span class="badge badge-gray">\${s}</span>\`;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-pwd').value;
  document.getElementById('login-btn').textContent = 'Signing in…';
  try {
    const d = await api('POST', '/login', { email, password: pwd });
    TOKEN = d.token;
    localStorage.setItem('admin_token', TOKEN);
    initApp();
  } catch (e) {
    document.getElementById('login-err').textContent = e.message;
  } finally {
    document.getElementById('login-btn').textContent = 'Sign In to Admin Panel';
  }
}
document.getElementById('login-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function doLogout() {
  localStorage.removeItem('admin_token');
  TOKEN = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  if (evtSource) { evtSource.close(); evtSource = null; }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function initApp() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadStats();
  loadUsers();
  loadNotifHistory();
  loadAdminLogs();
  loadCreditLog();
  loadDeletionRequests();
  connectSSE();
}

if (TOKEN) {
  api('GET', '/api/stats').then(() => initApp()).catch(() => {
    localStorage.removeItem('admin_token');
    TOKEN = '';
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
const SECTIONS = ['dashboard', 'users', 'credits', 'notifications', 'deletions', 'trials', 'activity', 'terminal', 'logs', 'cma', 'agentnet', 'evolution', 'featureflags', 'apma'];
const TITLES = { dashboard: 'Dashboard', users: 'All Users', credits: 'Credit Management', notifications: 'Push Notifications', deletions: 'Account Deletion Requests', trials: 'Trials & Billing Monitor', activity: 'Live Activity', terminal: 'Live Server Terminal', logs: 'Admin Logs', cma: 'CMA Savings Dashboard', agentnet: 'Agent Network', evolution: 'AI Self-Evolution Log', featureflags: 'Feature Flags', apma: 'APMA — Political Marketing' };

function showSection(name) {
  SECTIONS.forEach(s => {
    document.getElementById('section-' + s).classList.toggle('active', s === name);
    const nav = document.getElementById('nav-' + s);
    if (nav) nav.classList.toggle('active', s === name);
  });
  document.getElementById('page-title').textContent = TITLES[name] || name;
  if (name === 'cma') { loadCMAStats(); loadModelCredits(); }
  if (name === 'trials') { loadTrials(); }
  if (name === 'apma') { loadAPMASection(); startAPMAMonitor(); } else { stopAPMAMonitor(); }
  if (name === 'agentnet') { startAgentNetPolling(); } else { stopAgentNetPolling(); }
  if (name === 'evolution') { loadEvolutionLog(); startEvolutionPolling(); } else { stopEvolutionPolling(); }
  if (name === 'featureflags') { loadFeatureFlags(); }
}

// ── Trials & Billing ─────────────────────────────────────────────────────────
async function loadTrials() {
  try {
    const d = await api('GET', '/api/trials');
    const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '—';
    const planBadge = (p) => {
      const c = p === 'pro_plus' ? '#F59E0B' : p === 'pro' ? '#7C3AED' : '#00F0FF';
      return \`<span class="badge" style="background:\${c}20;color:\${c};border:1px solid \${c}40">\${p}</span>\`;
    };

    document.getElementById('trials-active-count').textContent = (d.active_trials || []).length;
    document.getElementById('trials-upcoming-count').textContent = (d.upcoming_charges || []).length;
    document.getElementById('trials-failed-count').textContent = (d.failed_conversions || []).length;
    document.getElementById('trials-pastdue-count').textContent = (d.past_due || []).length;

    // Active trials
    document.getElementById('trials-active-body').innerHTML = (d.active_trials || []).length === 0
      ? '<tr><td colspan="6" class="empty">No active trials</td></tr>'
      : (d.active_trials || []).map(t => \`<tr>
          <td style="font-size:11px;color:#94A3B8;max-width:140px;overflow:hidden;text-overflow:ellipsis">\${t.billing_email || t.user_id?.slice(0,8)+'…'}</td>
          <td>\${planBadge(t.plan)}</td>
          <td><span style="color:\${t.days_left <= 2 ? '#EF4444' : t.days_left <= 5 ? '#F59E0B' : '#10B981'};font-weight:700">\${t.days_left ?? '?'}d</span></td>
          <td>\${t.has_card ? '<span class="badge badge-green">✓ Saved</span>' : '<span class="badge badge-red">✗ None</span>'}</td>
          <td style="font-size:11px;color:#64748B">\${fmt(t.trial_end)}</td>
          <td>\${t.trial_charged ? '<span class="badge badge-green">Charged</span>' : '<span class="badge badge-yellow">Pending</span>'}</td>
        </tr>\`).join('');

    // Upcoming charges
    document.getElementById('trials-upcoming-body').innerHTML = (d.upcoming_charges || []).length === 0
      ? '<tr><td colspan="6" class="empty">None in next 48h</td></tr>'
      : (d.upcoming_charges || []).map(t => \`<tr>
          <td style="font-size:11px;color:#94A3B8">\${t.billing_email || t.user_id?.slice(0,8)+'…'}</td>
          <td>\${planBadge(t.plan)}</td>
          <td><span style="color:#EF4444;font-weight:700">\${t.days_left ?? '?'}d</span></td>
          <td>\${t.has_card ? '<span class="badge badge-green">✓ \${t.flw_card_last4 || ""}</span>' : '<span class="badge badge-red">✗ Missing</span>'}</td>
          <td style="font-size:11px;color:#94A3B8">\${t.billing_email || '—'}</td>
          <td style="font-size:11px;color:#64748B">\${fmt(t.trial_end)}</td>
        </tr>\`).join('');

    // Failed conversions
    document.getElementById('trials-failed-body').innerHTML = (d.failed_conversions || []).length === 0
      ? '<tr><td colspan="4" class="empty">No failures</td></tr>'
      : (d.failed_conversions || []).map(f => \`<tr>
          <td style="font-size:11px;color:#94A3B8">\${f.user_id?.slice(0,8)+'…'}</td>
          <td><span class="badge badge-red">\${(f.metadata?.type || f.type || 'failed').replace('_', ' ')}</span></td>
          <td style="font-size:12px;color:#94A3B8;max-width:260px">\${f.description || '—'}</td>
          <td style="font-size:11px;color:#64748B">\${fmt(f.created_at)}</td>
        </tr>\`).join('');

    // Past due
    document.getElementById('trials-pastdue-body').innerHTML = (d.past_due || []).length === 0
      ? '<tr><td colspan="5" class="empty">No past-due subscriptions</td></tr>'
      : (d.past_due || []).map(p => \`<tr>
          <td style="font-size:11px;color:#94A3B8">\${p.billing_email || p.user_id?.slice(0,8)+'…'}</td>
          <td>\${planBadge(p.plan)}</td>
          <td>\${p.flw_card_last4 ? '<span class="badge badge-green">···\${p.flw_card_last4}</span>' : '<span class="badge badge-red">No Card</span>'}</td>
          <td style="font-size:11px;color:\${p.renewal_next_retry_at && new Date(p.renewal_next_retry_at) < new Date() ? '#EF4444' : '#F59E0B'}">\${fmt(p.renewal_next_retry_at)}</td>
          <td style="font-size:11px;color:#64748B">\${fmt(p.current_period_end)}</td>
        </tr>\`).join('');

    // Update badge
    const urgentCount = (d.upcoming_charges || []).length + (d.past_due || []).length;
    const badge = document.getElementById('trials-badge');
    badge.style.display = urgentCount > 0 ? '' : 'none';
    badge.textContent = urgentCount;
  } catch (e) { console.error('Trials load error:', e); }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await api('GET', '/api/stats');
    document.getElementById('stat-users').textContent = fmtN(d.totalUsers);
    document.getElementById('stat-subs').textContent = fmtN(d.activeSubscriptions);
    document.getElementById('stat-suspended').textContent = fmtN(d.suspendedUsers);
    document.getElementById('stat-strategies').textContent = fmtN(d.totalStrategies);
    document.getElementById('stat-agents').textContent = fmtN(d.agentTasksTotal);
    document.getElementById('stat-credits').textContent = fmtN(Math.round(d.credits30d?.topup || 0));
    document.getElementById('stat-cost').textContent = '$' + (d.aiCost30d || 0).toFixed(2);

    const pb = d.planBreakdown || {};
    const total = (pb.starter || 0) + (pb.pro || 0) + (pb.pro_plus || 0) + (pb.none || 0);
    const plans = [
      { key: 'pro_plus', label: 'Pro+', color: '#F59E0B' },
      { key: 'pro', label: 'Pro', color: '#7C3AED' },
      { key: 'starter', label: 'Starter', color: '#00F0FF' },
      { key: 'none', label: 'Free', color: '#475569' },
    ];
    document.getElementById('plan-breakdown').innerHTML = plans.map(p => {
      const count = pb[p.key] || 0;
      const pct = total > 0 ? Math.round(count / total * 100) : 0;
      return \`<div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:\${p.color};font-weight:700">\${p.label}</span>
          <span style="color:#94A3B8">\${count} users · \${pct}%</span>
        </div>
        <div class="progress"><div class="progress-bar" style="width:\${pct}%;background:\${p.color}"></div></div>
      </div>\`;
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const d = await api('GET', '/api/users?limit=200');
    allUsers = d.users || [];
    renderUsers(allUsers);
    document.getElementById('users-pagination').textContent = \`\${allUsers.length} users loaded\`;
  } catch (e) { toast(e.message, 'error'); }
}

function filterUsers() {
  const q = document.getElementById('user-search').value.toLowerCase();
  const filtered = q ? allUsers.filter(u =>
    (u.email || '').toLowerCase().includes(q) ||
    (u.full_name || '').toLowerCase().includes(q) ||
    (u.id || '').toLowerCase().includes(q)
  ) : allUsers;
  renderUsers(filtered);
}

function renderUsers(list) {
  const tbody = document.getElementById('users-table-body');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No users found</td></tr>'; return; }
  tbody.innerHTML = list.map(u => {
    const sub = u.subscription;
    const energy = u.energy;
    const overrideStatus = u.override_status || 'active';
    return \`<tr>
      <td>
        <div style="font-weight:600;font-size:13px">\${u.email || '—'}</div>
        <div style="font-size:11px;color:#64748B">\${u.full_name || ''}</div>
      </td>
      <td>\${planBadge(sub?.plan || 'none', sub?.status)}</td>
      <td>
        \${overrideStatus === 'suspended' ? '<span class="badge badge-red">Suspended</span>' : statusBadge(sub?.status || 'inactive')}
      </td>
      <td>
        <span style="font-weight:700;color:#00F0FF">\${energy ? Number(energy.balance_credits).toFixed(1) : '—'}</span>
        <span style="color:#64748B;font-size:11px"> credits</span>
      </td>
      <td style="color:#94A3B8">\${u.strategy_count}</td>
      <td style="color:#00F0FF;font-weight:600">\${u.connected_accounts || 0}</td>
      <td style="color:#64748B;font-size:11px">\${timeAgo(u.created_at)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openUserModal('\${u.id}')">View</button>
      </td>
    </tr>\`;
  }).join('');
}

// ── User Modal ────────────────────────────────────────────────────────────────
async function openUserModal(userId) {
  currentUserId = userId;
  document.getElementById('user-modal').classList.add('open');
  document.getElementById('modal-user-email').textContent = 'Loading…';
  document.getElementById('modal-user-id').textContent = userId;
  try {
    const d = await api('GET', '/api/users/' + userId);
    renderUserModal(d);
  } catch (e) {
    toast(e.message, 'error');
    closeModal();
  }
}

function closeModal() {
  document.getElementById('user-modal').classList.remove('open');
  currentUserId = null;
}

function showModalTab(name) {
  ['overview', 'plan', 'strategies', 'agents', 'ai', 'transactions'].forEach(t => {
    document.getElementById('modal-' + t).classList.toggle('active', t === name);
  });
  document.querySelectorAll('#modal-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick').includes("'" + name + "'"));
  });
}

function renderUserModal(d) {
  const u = d.user;
  const sub = d.subscription;
  const energy = d.energy;
  const override = d.status_override;

  document.getElementById('modal-user-email').textContent = u.email;
  document.getElementById('modal-user-id').textContent = u.id;

  const isSuspended = override?.status === 'suspended';
  document.getElementById('modal-actions').innerHTML = \`
    <button class="btn btn-ghost btn-sm" onclick="openCreditModal('\${u.id}', '\${u.email}')">⚡ Adjust Credits</button>
    <button class="btn btn-primary btn-sm" onclick="showModalTab('plan')">🎯 Change Plan</button>
    \${isSuspended
      ? \`<button class="btn btn-warn btn-sm" onclick="unsuspendUser('\${u.id}')">✅ Unsuspend</button>\`
      : \`<button class="btn btn-warn btn-sm" onclick="suspendUser('\${u.id}')">🚫 Suspend</button>\`
    }
    <button class="btn btn-danger btn-sm" onclick="terminateUser('\${u.id}', '\${u.email}')">🗑️ Terminate Account</button>
    <button class="btn btn-ghost btn-sm" onclick="sendNotifToUser('\${u.id}', '\${u.email}')">🔔 Send Notification</button>
  \`;

  // Overview
  document.getElementById('modal-overview').innerHTML = \`
    <div class="detail-grid" style="margin-bottom:16px">
      <div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">\${u.email}</div></div>
      <div class="detail-item"><div class="detail-label">Full Name</div><div class="detail-value">\${u.full_name || '—'}</div></div>
      <div class="detail-item"><div class="detail-label">User ID</div><div class="detail-value" style="font-size:11px;word-break:break-all">\${u.id}</div></div>
      <div class="detail-item"><div class="detail-label">Joined</div><div class="detail-value">\${fmtDate(u.created_at)}</div></div>
      <div class="detail-item"><div class="detail-label">Last Sign In</div><div class="detail-value">\${timeAgo(u.last_sign_in_at)}</div></div>
      <div class="detail-item"><div class="detail-label">Email Verified</div><div class="detail-value">\${u.email_confirmed_at ? '✅ Yes' : '❌ No'}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card" style="background:#0B0F19">
        <div style="font-size:12px;color:#64748B;font-weight:700;margin-bottom:10px">SUBSCRIPTION</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          \${planBadge(sub?.plan || 'none', sub?.status)} \${statusBadge(isSuspended ? 'suspended' : (sub?.status || 'inactive'))}
        </div>
        <div style="font-size:12px;color:#94A3B8">Period end: \${sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : '—'}</div>
        \${isSuspended ? \`<div style="margin-top:8px;font-size:12px;color:#F59E0B">Reason: \${override?.reason || 'No reason given'}</div>\` : ''}
      </div>
      <div class="card" style="background:#0B0F19">
        <div style="font-size:12px;color:#64748B;font-weight:700;margin-bottom:10px">ENERGY</div>
        <div style="font-size:26px;font-weight:800;color:#00F0FF">\${energy ? Number(energy.balance_credits).toFixed(1) : '—'}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">credits available</div>
        <div style="margin-top:8px;font-size:12px;color:#94A3B8">Total consumed: \${energy ? Number(energy.lifetime_consumed).toFixed(1) : '—'}</div>
        <div style="font-size:12px;color:#94A3B8">Total purchased: \${energy ? Number(energy.lifetime_credits).toFixed(1) : '—'}</div>
      </div>
    </div>
    <div style="margin-top:16px">
      <div style="font-size:12px;color:#64748B;font-weight:700;margin-bottom:8px">PUSH TOKENS (\${(d.push_tokens || []).length})</div>
      \${d.push_tokens.length === 0 ? '<div style="color:#64748B;font-size:12px">No push tokens registered (app not installed or notifications not enabled)</div>' :
        d.push_tokens.map(t => \`<div style="font-size:11px;color:#94A3B8;background:#0B0F19;padding:6px 10px;border-radius:6px;margin-bottom:4px;word-break:break-all">\${t.token} <span style="color:#475569">(\${t.platform})</span></div>\`).join('')
      }
    </div>
  \`;

  // Plan Management
  const PLAN_DEFS = [
    { key: 'none',     label: 'No Plan (Free)',  credits: 0,   color: '#475569', icon: '⭕', price: '$0/mo' },
    { key: 'starter',  label: 'Starter',         credits: 100, color: '#00F0FF', icon: '🌱', price: '$20/mo' },
    { key: 'pro',      label: 'Pro',             credits: 300, color: '#7C3AED', icon: '🚀', price: '$45/mo' },
    { key: 'pro_plus', label: 'Pro+',            credits: 600, color: '#F59E0B', icon: '⭐', price: '$100/mo' },
  ];
  const currentPlanKey = sub?.plan || 'none';
  document.getElementById('modal-plan').innerHTML = \`
    <div style="margin-bottom:18px;padding:16px;background:#0B0F19;border-radius:12px;border:1px solid #1E293B">
      <div style="font-size:11px;color:#64748B;font-weight:700;margin-bottom:6px">CURRENT PLAN</div>
      <div style="display:flex;align-items:center;gap:10px">
        \${planBadge(currentPlanKey, sub?.status)}
        \${statusBadge(sub?.status || 'inactive')}
        <span style="font-size:12px;color:#64748B">Period end: \${sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : '—'}</span>
      </div>
    </div>

    <div style="font-size:13px;font-weight:700;margin-bottom:12px;color:#E2E8F0">Select New Plan</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px" id="plan-selector">
      \${PLAN_DEFS.map(p => \`
        <div onclick="selectPlanCard('\${p.key}')" id="plancard-\${p.key}" style="
          cursor:pointer;border:2px solid \${p.key === currentPlanKey ? p.color : '#1E293B'};
          border-radius:12px;padding:14px;background:\${p.key === currentPlanKey ? p.color + '15' : '#0B0F19'};
          transition:all .15s;position:relative
        ">
          \${p.key === currentPlanKey ? \`<div style="position:absolute;top:8px;right:8px;font-size:10px;background:\${p.color};color:#020617;padding:2px 6px;border-radius:4px;font-weight:700">CURRENT</div>\` : ''}
          <div style="font-size:20px;margin-bottom:6px">\${p.icon}</div>
          <div style="font-weight:800;color:\${p.color};font-size:14px">\${p.label}</div>
          <div style="font-size:12px;color:#64748B;margin-top:2px">\${p.price}</div>
          <div style="font-size:12px;color:#94A3B8;margin-top:6px">\${p.credits > 0 ? p.credits + ' credits / period' : 'No credits'}</div>
        </div>
      \`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
      <div>
        <label style="display:block;font-size:12px;color:#94A3B8;font-weight:600;margin-bottom:6px">Account Status</label>
        <select class="input" id="plan-status-select" onchange="updatePlanSummary()" style="cursor:pointer">
          <option value="active">Active (full access)</option>
          <option value="trialing">Trialing</option>
          <option value="inactive">Inactive (no access)</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding-top:22px">
        <input type="checkbox" id="plan-grant-credits" checked onchange="updatePlanSummary()" style="width:16px;height:16px;cursor:pointer;accent-color:#00F0FF"/>
        <label for="plan-grant-credits" style="font-size:13px;color:#E2E8F0;cursor:pointer">Grant plan credits to user</label>
      </div>
    </div>

    <div style="background:#00F0FF10;border:1px solid #00F0FF30;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#94A3B8" id="plan-summary">
      Select a plan above to see a summary of changes.
    </div>

    <button class="btn btn-primary" style="width:100%;justify-content:center;padding:11px" onclick="applyPlanChange()">
      Apply Plan Change
    </button>
  \`;

  window._selectedPlan = currentPlanKey;
  document.getElementById('plan-status-select').value = sub?.status === 'active' || sub?.status === 'trialing' ? sub.status : 'active';
  updatePlanSummary();

  // Strategies
  document.getElementById('modal-strategies').innerHTML = d.strategies.length === 0
    ? '<div class="empty">No strategies created</div>'
    : \`<table><thead><tr><th>Title</th><th>Goal</th><th>Platforms</th><th>Status</th><th>Created</th></tr></thead><tbody>
      \${d.strategies.map(s => \`<tr>
        <td style="font-weight:600">\${s.title || '—'}</td>
        <td><span class="tag">\${s.goal || '—'}</span></td>
        <td>\${(s.platforms || []).map(p => \`<span class="tag">\${p}</span>\`).join('')}</td>
        <td>\${s.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
        <td style="font-size:11px;color:#64748B">\${timeAgo(s.created_at)}</td>
      </tr>\`).join('')}
      </tbody></table>\`;

  // Agent Tasks
  document.getElementById('modal-agents').innerHTML = d.agent_tasks.length === 0
    ? '<div class="empty">No agent tasks</div>'
    : \`<table><thead><tr><th>Agent</th><th>Task</th><th>Platform</th><th>Status</th><th>Scheduled</th><th>Executed</th></tr></thead><tbody>
      \${d.agent_tasks.map(t => {
        const colors = { done: 'badge-green', failed: 'badge-red', pending: 'badge-yellow', executing: 'badge-blue', skipped: 'badge-gray' };
        return \`<tr>
          <td><span class="tag">\${t.agent_type}</span></td>
          <td style="font-size:12px">\${t.task_type}</td>
          <td><span class="tag">\${t.platform}</span></td>
          <td><span class="badge \${colors[t.status] || 'badge-gray'}">\${t.status}</span></td>
          <td style="font-size:11px;color:#64748B">\${timeAgo(t.scheduled_at)}</td>
          <td style="font-size:11px;color:#64748B">\${t.executed_at ? timeAgo(t.executed_at) : '—'}</td>
        </tr>\`;
      }).join('')}
      </tbody></table>\`;

  // AI Usage
  document.getElementById('modal-ai').innerHTML = d.ai_usage.length === 0
    ? '<div class="empty">No AI operations logged</div>'
    : \`<table><thead><tr><th>Operation</th><th>Model</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th><th>Time</th></tr></thead><tbody>
      \${d.ai_usage.map(l => \`<tr>
        <td><span class="tag">\${l.operation}</span></td>
        <td style="font-size:11px;color:#94A3B8">\${l.model}</td>
        <td style="color:#64748B">\${fmtN(l.input_tokens)}</td>
        <td style="color:#64748B">\${fmtN(l.output_tokens)}</td>
        <td style="color:#F59E0B">$\${(Number(l.actual_cost_usd) || 0).toFixed(4)}</td>
        <td style="font-size:11px;color:#64748B">\${timeAgo(l.created_at)}</td>
      </tr>\`).join('')}
      </tbody></table>\`;

  // Transactions
  document.getElementById('modal-transactions').innerHTML = d.recent_transactions.length === 0
    ? '<div class="empty">No transactions</div>'
    : \`<table><thead><tr><th>Type</th><th>Credits</th><th>Balance After</th><th>Description</th><th>Time</th></tr></thead><tbody>
      \${d.recent_transactions.map(t => {
        const isCredit = Number(t.credits) >= 0;
        return \`<tr>
          <td><span class="badge \${isCredit ? 'badge-green' : 'badge-red'}">\${t.type}</span></td>
          <td style="font-weight:700;color:\${isCredit ? '#10B981' : '#EF4444'}">\${isCredit ? '+' : ''}\${Number(t.credits).toFixed(1)}</td>
          <td style="color:#00F0FF">\${Number(t.balance_after).toFixed(1)}</td>
          <td style="font-size:12px;color:#94A3B8">\${t.description || t.operation || '—'}</td>
          <td style="font-size:11px;color:#64748B">\${timeAgo(t.created_at)}</td>
        </tr>\`;
      }).join('')}
      </tbody></table>\`;
}

// ── Plan Management ───────────────────────────────────────────────────────────
const PLAN_CREDITS_MAP = { none: 0, starter: 100, pro: 300, pro_plus: 600 };
const PLAN_COLORS_MAP = { none: '#475569', starter: '#00F0FF', pro: '#7C3AED', pro_plus: '#F59E0B' };
const PLAN_LABELS_MAP = { none: 'No Plan', starter: 'Starter', pro: 'Pro', pro_plus: 'Pro+' };

function selectPlanCard(planKey) {
  if (!window._selectedPlan) window._selectedPlan = 'none';
  const oldKey = window._selectedPlan;
  const allKeys = ['none', 'starter', 'pro', 'pro_plus'];
  const colors = PLAN_COLORS_MAP;

  allKeys.forEach(k => {
    const el = document.getElementById('plancard-' + k);
    if (!el) return;
    if (k === planKey) {
      el.style.borderColor = colors[k];
      el.style.background = colors[k] + '20';
    } else {
      el.style.borderColor = '#1E293B';
      el.style.background = '#0B0F19';
    }
  });

  window._selectedPlan = planKey;
  if (planKey === 'none') {
    const sel = document.getElementById('plan-status-select');
    if (sel) sel.value = 'inactive';
    const cb = document.getElementById('plan-grant-credits');
    if (cb) cb.checked = false;
  }
  updatePlanSummary();
}

function updatePlanSummary() {
  const el = document.getElementById('plan-summary');
  if (!el) return;
  const plan = window._selectedPlan || 'none';
  const status = document.getElementById('plan-status-select')?.value || 'active';
  const grantCredits = document.getElementById('plan-grant-credits')?.checked;
  const credits = PLAN_CREDITS_MAP[plan] || 0;
  const color = PLAN_COLORS_MAP[plan];
  const label = PLAN_LABELS_MAP[plan];

  const creditsLine = grantCredits && credits > 0
    ? '✅ Will grant <strong style="color:#00F0FF">' + credits + ' credits</strong> to the user energy balance'
    : credits > 0 ? '⚠️ Credits will NOT be granted (checkbox unchecked)' : '⭕ No credits for this plan';
  const periodLine = plan !== 'none' ? '<div style="color:#64748B;font-size:11px;margin-top:4px">Billing period set to today + 30 days</div>' : '';
  el.innerHTML = \`
    <div style="font-weight:700;color:\${color};margin-bottom:6px">→ \${label} · \${status}</div>
    <div style="color:#94A3B8">\${creditsLine}</div>
    \${periodLine}
  \`;
}

async function applyPlanChange() {
  if (!currentUserId) return;
  const plan = window._selectedPlan || 'none';
  const status = document.getElementById('plan-status-select')?.value || 'active';
  const grantCredits = document.getElementById('plan-grant-credits')?.checked || false;
  const label = PLAN_LABELS_MAP[plan];

  if (!confirm(\`Change plan to \${label} (\${status})?\${grantCredits && PLAN_CREDITS_MAP[plan] > 0 ? \`\\nThis will also grant \${PLAN_CREDITS_MAP[plan]} credits to the user.\` : ''}\`)) return;

  try {
    const d = await api('POST', '/api/users/' + currentUserId + '/plan', { plan, status, grantCredits });
    toast(\`Plan changed to \${label}\${d.credits_granted > 0 ? ' + ' + d.credits_granted + ' credits granted' : ''}\`, 'success');
    openUserModal(currentUserId);
    loadUsers();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
}

// ── User Actions ──────────────────────────────────────────────────────────────
async function suspendUser(id) {
  const reason = prompt('Reason for suspension (shown to support team):');
  if (reason === null) return;
  try {
    await api('POST', '/api/users/' + id + '/suspend', { reason });
    toast('User suspended', 'success');
    openUserModal(id);
    loadUsers();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
}

async function unsuspendUser(id) {
  try {
    await api('POST', '/api/users/' + id + '/unsuspend');
    toast('User unsuspended', 'success');
    openUserModal(id);
    loadUsers();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
}

async function terminateUser(id, email) {
  if (!confirm('PERMANENTLY DELETE account for ' + email + '?\\n\\nThis deletes all auth data and cannot be undone.')) return;
  if (!confirm('Final confirmation: Delete ' + email + '?')) return;
  try {
    await api('DELETE', '/api/users/' + id);
    toast('Account terminated', 'success');
    closeModal();
    loadUsers();
    loadStats();
  } catch (e) { toast(e.message, 'error'); }
}

function openCreditModal(id, email) {
  closeModal();
  showSection('credits');
  document.getElementById('credit-user').value = email || id;
  document.getElementById('nav-credits').click();
}

function sendNotifToUser(id, email) {
  closeModal();
  showSection('notifications');
  document.getElementById('notif-target-type').value = 'user';
  updateNotifTarget();
  document.getElementById('notif-user').value = email || id;
}

// ── Credits ───────────────────────────────────────────────────────────────────
async function applyCredit() {
  const userInput = document.getElementById('credit-user').value.trim();
  const type = document.getElementById('credit-type').value;
  const amount = document.getElementById('credit-amount').value;
  const reason = document.getElementById('credit-reason').value.trim();
  if (!userInput || !amount) return toast('Fill in user and amount', 'error');

  let userId = userInput;
  if (userInput.includes('@')) {
    const found = allUsers.find(u => u.email?.toLowerCase() === userInput.toLowerCase());
    if (!found) return toast('User not found. Load users first.', 'error');
    userId = found.id;
  }

  try {
    const d = await api('POST', '/api/users/' + userId + '/credits', { amount, type, reason });
    toast(\`Credits \${type === 'credit' ? 'added' : 'deducted'}. New balance: \${Number(d.new_balance).toFixed(1)}\`, 'success');
    document.getElementById('credit-amount').value = '';
    document.getElementById('credit-reason').value = '';
    loadCreditLog();
    loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadCreditLog() {
  try {
    const logs = await api('GET', '/api/action-logs');
    const creditLogs = logs.filter(l => l.action_type === 'credit_credit' || l.action_type === 'credit_debit');
    const el = document.getElementById('credit-log');
    if (!creditLogs.length) { el.innerHTML = '<div class="empty">No adjustments yet</div>'; return; }
    el.innerHTML = creditLogs.map(l => {
      const isCredit = l.action_type === 'credit_credit';
      return \`<div style="background:#0B0F19;border:1px solid #1E293B;border-radius:8px;padding:10px 14px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px;color:\${isCredit ? '#10B981' : '#EF4444'};font-weight:700">
            \${isCredit ? '+ ' : '- '}\${l.details?.amount || '?'} credits
          </div>
          <div style="font-size:11px;color:#64748B">\${timeAgo(l.created_at)}</div>
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:4px">\${l.target_user_email || l.target_user_id || '—'}</div>
        <div style="font-size:11px;color:#475569">\${l.details?.reason || ''}</div>
      </div>\`;
    }).join('');
  } catch {}
}

// ── Notifications ─────────────────────────────────────────────────────────────
function updateNotifTarget() {
  const val = document.getElementById('notif-target-type').value;
  document.getElementById('notif-plan-group').style.display = val === 'plan' ? 'flex' : 'none';
  document.getElementById('notif-user-group').style.display = val === 'user' ? 'flex' : 'none';
}

async function sendNotification() {
  const targetType = document.getElementById('notif-target-type').value;
  let target = 'all';
  if (targetType === 'plan') {
    target = 'plan:' + document.getElementById('notif-plan').value;
  } else if (targetType === 'user') {
    const userInput = document.getElementById('notif-user').value.trim();
    if (!userInput) return toast('Enter a user email or ID', 'error');
    if (userInput.includes('@')) {
      const found = allUsers.find(u => u.email?.toLowerCase() === userInput.toLowerCase());
      if (!found) return toast('User not found', 'error');
      target = 'user:' + found.id;
    } else {
      target = 'user:' + userInput;
    }
  }

  const title = document.getElementById('notif-title').value.trim();
  const body = document.getElementById('notif-body').value.trim();
  if (!title || !body) return toast('Title and body required', 'error');

  try {
    const d = await api('POST', '/api/notifications', { target, title, body });
    toast(\`Sent to \${d.sent} device(s)\`, 'success');
    document.getElementById('notif-title').value = '';
    document.getElementById('notif-body').value = '';
    loadNotifHistory();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadNotifHistory() {
  try {
    const data = await api('GET', '/api/notifications');
    const el = document.getElementById('notif-history');
    if (!data.length) { el.innerHTML = '<div class="empty">No notifications sent yet</div>'; return; }
    el.innerHTML = data.map(n => \`
      <div style="background:#0B0F19;border:1px solid #1E293B;border-radius:8px;padding:10px 14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="font-weight:700;font-size:13px">\${n.title}</div>
          <div style="font-size:11px;color:#64748B">\${timeAgo(n.sent_at)}</div>
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:3px">\${n.body}</div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <span class="tag">\${n.target}</span>
          <span class="badge badge-green">\${n.recipients_count} delivered</span>
        </div>
      </div>
    \`).join('');
  } catch {}
}

// ── Admin Logs ────────────────────────────────────────────────────────────────
async function loadAdminLogs() {
  try {
    const logs = await api('GET', '/api/action-logs');
    const tbody = document.getElementById('admin-logs-body');
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No actions logged yet</td></tr>'; return; }
    const actionColors = {
      terminate: 'badge-red', suspend: 'badge-red', unsuspend: 'badge-green',
      credit_credit: 'badge-green', credit_debit: 'badge-yellow',
      send_notification: 'badge-blue',
    };
    tbody.innerHTML = logs.map(l => \`<tr>
      <td style="font-size:11px;color:#64748B">\${fmtDate(l.created_at)}</td>
      <td><span class="badge \${actionColors[l.action_type] || 'badge-gray'}">\${l.action_type}</span></td>
      <td style="font-size:12px">\${l.target_user_email || l.target_user_id || '—'}</td>
      <td style="font-size:11px;color:#64748B">\${JSON.stringify(l.details).substring(0, 100)}</td>
    </tr>\`).join('');
  } catch {}
}

// ── Deletion Requests ─────────────────────────────────────────────────────────
async function loadDeletionRequests() {
  try {
    const requests = await api('GET', '/api/account-deletions');
    const tbody = document.getElementById('deletions-table-body');
    if (!tbody) return;
    if (!requests.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No deletion requests yet</td></tr>';
      const badge = document.getElementById('deletion-badge');
      if (badge) badge.style.display = 'none';
      return;
    }
    const pending = requests.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('deletion-badge');
    if (badge) {
      if (pending > 0) { badge.style.display = 'inline'; badge.textContent = pending; }
      else badge.style.display = 'none';
    }
    tbody.innerHTML = requests.map(r => \`<tr>
      <td>
        <div style="font-weight:600;font-size:13px">\${r.user_email || '—'}</div>
        <div style="font-size:11px;color:#64748B">\${r.user_id}</div>
      </td>
      <td style="font-size:12px;color:#94A3B8;max-width:200px">\${r.reason || '<span style="color:#334155">No reason given</span>'}</td>
      <td><span class="badge \${r.status === 'pending' ? 'badge-red' : r.status === 'approved' ? 'badge-green' : 'badge-gray'}">\${r.status}</span></td>
      <td style="font-size:11px;color:#64748B">\${fmtDate(r.created_at)}</td>
      <td>
        \${r.status === 'pending' ? \`
          <div style="display:flex;gap:6px">
            <button class="btn btn-danger btn-sm" onclick="approveDeletion('\${r.id}', '\${r.user_email || r.user_id}')">✓ Delete Account</button>
            <button class="btn btn-ghost btn-sm" onclick="dismissDeletion('\${r.id}')">✕ Dismiss</button>
          </div>
        \` : \`<span style="font-size:11px;color:#475569">Reviewed by \${r.reviewed_by || '—'}</span>\`}
      </td>
    </tr>\`).join('');
  } catch (e) {
    const tbody = document.getElementById('deletions-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty">Failed to load deletion requests</td></tr>';
  }
}

async function approveDeletion(id, email) {
  if (!confirm(\`PERMANENTLY DELETE account for \${email}?\\n\\nThis cannot be undone.\`)) return;
  try {
    await api('POST', \`/api/account-deletions/\${id}/approve\`);
    showToast('Account deleted successfully', 'success');
    loadDeletionRequests();
    loadStats();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function dismissDeletion(id) {
  try {
    await api('POST', \`/api/account-deletions/\${id}/dismiss\`);
    showToast('Deletion request dismissed', 'success');
    loadDeletionRequests();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function loadCMAStats() {
  try {
    const days = document.getElementById('cma-days-select')?.value || '7';
    const d = await api('GET', \`/api/cma/stats?days=\${days}\`);

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setEl('cma-saved-credits', fmtN(Math.round(d.totalSavedCredits)));
    setEl('cma-saved-usd',    '$' + (d.totalSavedUsd || 0).toFixed(4));
    setEl('cma-events',       fmtN(d.events));
    setEl('cma-ratio',        Math.round((d.economyRatio || 0) * 100) + '%');
    setEl('cma-burn-rate',    fmtN(Math.round(d.systemBurnRate)) + ' credits/hr');

    // Live status
    const ls = d.liveStatus || {};
    const liveEl = document.getElementById('cma-live-status');
    if (liveEl) {
      const overrideColor = ls.dynamicEconomyOverride ? '#F59E0B' : '#10B981';
      const overrideLabel = ls.dynamicEconomyOverride ? '⚠️ Economy Override ACTIVE — all eligible ops routed to cheap models' : '✓ Standard routing — economy override inactive';
      liveEl.innerHTML = \`
        <div style="margin-bottom:8px;color:\${overrideColor};font-weight:700">\${overrideLabel}</div>
        <div style="color:#64748B;font-size:11px">Active cooldowns: \${ls.activeSystemCooldowns?.length || 0} operations</div>
        \${(ls.activeSystemCooldowns || []).map(c => \`<div style="font-size:11px;color:#94A3B8;margin-top:4px">• \${c.operation}: \${c.cooldownEndsIn}s remaining</div>\`).join('')}
      \`;
    }

    // By operation
    const opEl = document.getElementById('cma-by-op');
    if (opEl) {
      const ops = d.byOperation || {};
      const opKeys = Object.keys(ops).sort((a, b) => ops[b] - ops[a]);
      opEl.innerHTML = opKeys.length
        ? opKeys.map(op => \`
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1E293B">
            <span style="color:#CBD5E1">\${op}</span>
            <span style="color:#10B981;font-weight:700">\${ops[op]} credits saved</span>
          </div>
        \`).join('')
        : '<div style="color:#64748B">No economy routing events yet</div>';
    }
  } catch (e) {
    console.error('CMA stats error:', e);
  }
}

// ── AI PROVIDER MODEL CREDITS ─────────────────────────────────────────────────
async function loadModelCredits() {
  const errEl = document.getElementById('mc-error');
  const updEl = document.getElementById('mc-updated');
  if (updEl) updEl.textContent = 'Loading…';
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  try {
    const d = await api('GET', '/api/cma/model-credits');
    if (updEl) updEl.textContent = 'Updated ' + new Date().toLocaleTimeString();

    const fmt = v => v == null ? '—' : '$' + Number(v).toFixed(4);
    const fmtC = n => n === 0 ? '$0.0000' : '$' + Number(n).toFixed(4);

    // ── OpenAI ──────────────────────────────────────────────────────
    const oai = (d.providers || []).find(p => p.id === 'openai') || {};
    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

    setEl('mc-oai-internal', fmtC(oai.internalSpendUsd ?? 0));
    setEl('mc-oai-live',     oai.liveSpendUsd != null ? fmt(oai.liveSpendUsd) : '—');

    // Limits + progress bar
    const limRow = document.getElementById('mc-oai-limits-row');
    if (oai.hardLimitUsd != null) {
      if (limRow) limRow.style.display = 'block';
      setEl('mc-oai-soft', oai.softLimitUsd != null ? fmt(oai.softLimitUsd) : '—');
      setEl('mc-oai-hard', fmt(oai.hardLimitUsd));
      const pct = oai.liveSpendUsd != null ? Math.min(100, (oai.liveSpendUsd / oai.hardLimitUsd) * 100) : 0;
      const bar = document.getElementById('mc-oai-bar');
      const pctEl = document.getElementById('mc-oai-pct');
      if (bar) bar.style.width = pct + '%';
      if (pctEl) pctEl.textContent = pct.toFixed(1) + '% of hard limit used';
    } else {
      if (limRow) limRow.style.display = 'none';
    }

    // API error message
    const oaiErrEl = document.getElementById('mc-oai-api-error');
    if (oaiErrEl) {
      if (oai.apiError) {
        oaiErrEl.style.display = 'block';
        oaiErrEl.textContent = '⚠ OpenAI billing API: ' + oai.apiError;
      } else {
        oaiErrEl.style.display = 'none';
      }
    }

    // Model breakdown
    const oaiBd = document.getElementById('mc-oai-breakdown');
    if (oaiBd) {
      const bd = oai.modelBreakdown || {};
      const keys = Object.keys(bd);
      oaiBd.innerHTML = keys.length ? keys.map(m => \`
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1E293B">
          <span style="color:#CBD5E1">\${m}</span>
          <span style="color:#10B981">\${fmt(bd[m].usd)} &nbsp; <span style="color:#64748B">\${bd[m].calls} calls</span></span>
        </div>
      \`).join('') : '<span style="color:#64748B">No usage this month</span>';
    }

    // ── Google ──────────────────────────────────────────────────────
    const goog = (d.providers || []).find(p => p.id === 'google') || {};
    setEl('mc-goog-internal', fmtC(goog.internalSpendUsd ?? 0));

    const googBd = document.getElementById('mc-goog-breakdown');
    if (googBd) {
      const bd = goog.modelBreakdown || {};
      const keys = Object.keys(bd);
      googBd.innerHTML = keys.length ? keys.map(m => \`
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1E293B">
          <span style="color:#CBD5E1">\${m}</span>
          <span style="color:#10B981">\${fmt(bd[m].usd)} &nbsp; <span style="color:#64748B">\${bd[m].calls} calls</span></span>
        </div>
      \`).join('') : '<span style="color:#64748B">No usage this month</span>';
    }

    // ── Total ───────────────────────────────────────────────────────
    setEl('mc-total', '$' + Number(d.totalSpendUsd ?? 0).toFixed(4));

  } catch (e) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Failed to load provider balances: ' + e.message; }
    if (updEl) updEl.textContent = 'Error';
    console.error('Model credits error:', e);
  }
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function setSseStatus(color, text) {
  ['sse-dot', 'sse-dot-2', 'sse-dot-activity'].forEach(id => { const el = document.getElementById(id); if (el) el.style.background = color; });
  ['sse-status', 'sse-status-2', 'sse-status-activity'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = text; });
}

function connectSSE() {
  if (sseRetryTimer) { clearTimeout(sseRetryTimer); sseRetryTimer = null; }
  if (evtSource) { evtSource.close(); evtSource = null; }

  // If no valid token, don't even try
  if (!TOKEN) return;

  const url = '/admin/api/stream?token=' + encodeURIComponent(TOKEN);
  try { evtSource = new EventSource(url); } catch (e) { scheduleSSERetry(); return; }

  setSseStatus('#F59E0B', 'Connecting…');

  evtSource.onopen = () => {
    sseRetryCount = 0;
    setSseStatus('#10B981', 'Live');
  };

  // Named "connected" event — server sends this immediately on open so onopen fires
  // even when the proxy buffers the initial response headers
  evtSource.addEventListener('connected', () => {
    sseRetryCount = 0;
    setSseStatus('#10B981', 'Live');
  });

  evtSource.onerror = () => {
    if (evtSource) { evtSource.close(); evtSource = null; }
    scheduleSSERetry();
  };

  attachSSEListeners();
}

function scheduleSSERetry() {
  sseRetryCount++;
  const MAX_RETRIES = 20;
  if (sseRetryCount > MAX_RETRIES) {
    // Give up on SSE — agent network map uses polling fallback, show Polling status
    setSseStatus('#F59E0B', 'Polling');
    return;
  }
  // Exponential backoff: 2s, 4s, 8s … capped at 30s
  const delay = Math.min(2000 * Math.pow(1.5, sseRetryCount - 1), 30000);
  const label = sseRetryCount <= 3 ? 'Reconnecting…' : \`Retry \${sseRetryCount}/\${MAX_RETRIES}\`;
  setSseStatus('#EF4444', label);
  sseRetryTimer = setTimeout(connectSSE, delay);
}

function attachSSEListeners() {
  if (!evtSource) return;

  evtSource.addEventListener('activity', e => {
    const events = JSON.parse(e.data);
    events.forEach(ev => addActivityEvent(ev));
  });

  evtSource.addEventListener('credit_adjusted', e => {
    const d = JSON.parse(e.data);
    addActivityEvent({ type: 'credit_adjusted', payload: d });
    loadStats();
  });

  evtSource.addEventListener('user_suspended', e => {
    const d = JSON.parse(e.data);
    addActivityEvent({ type: 'user_suspended', payload: d });
    loadStats();
  });

  evtSource.addEventListener('user_terminated', e => {
    const d = JSON.parse(e.data);
    addActivityEvent({ type: 'user_terminated', payload: d });
    loadUsers();
    loadStats();
  });

  evtSource.addEventListener('notification_sent', e => {
    const d = JSON.parse(e.data);
    addActivityEvent({ type: 'notification_sent', payload: d });
  });

  evtSource.addEventListener('plan_changed', e => {
    const d = JSON.parse(e.data);
    addActivityEvent({ type: 'plan_changed', payload: d });
    loadStats();
    loadUsers();
  });

  evtSource.addEventListener('deletion_request', e => {
    const d = JSON.parse(e.data);
    addActivityEvent({ type: 'deletion_request', payload: d });
    loadDeletionRequests();
    const badge = document.getElementById('deletion-badge');
    if (badge) {
      badge.style.display = 'inline';
      badge.textContent = (parseInt(badge.textContent || '0') + 1).toString();
    }
    showToast('⚠️ New deletion request from ' + (d.email || d.userId), 'error');
  });

  evtSource.addEventListener('deletion_approved', () => { loadDeletionRequests(); });
  evtSource.addEventListener('deletion_dismissed', () => { loadDeletionRequests(); });

  evtSource.addEventListener('agent_task_started', e => {
    const d = JSON.parse(e.data);
    addAgentNetEvent('started', d);
    updateAgentNetNode(d.agent_type, 'active', d.platform);
  });

  evtSource.addEventListener('agent_task_done', e => {
    const d = JSON.parse(e.data);
    addAgentNetEvent('done', d);
    updateAgentNetNode(d.agent_type, 'done', d.platform);
  });

  evtSource.addEventListener('agent_task_failed', e => {
    const d = JSON.parse(e.data);
    addAgentNetEvent('failed', d);
    updateAgentNetNode(d.agent_type, 'failed', d.platform);
  });

  evtSource.addEventListener('intelligence_cycle', e => {
    const d = JSON.parse(e.data);
    const engMap = { platform: 'eng-ipe', social: 'eng-social', emotional: 'eng-emotional', geo: 'eng-geo', brain: 'eng-brain' };
    const el = document.getElementById(engMap[d.source] || '');
    if (el) {
      el.className = 'badge badge-green';
      el.textContent = 'Running';
      setTimeout(() => { el.className = 'badge badge-blue'; el.textContent = 'Done'; }, 4000);
    }
    addAgentNetEvent('intelligence', d);
  });

  evtSource.addEventListener('agent_learning', e => {
    const d = JSON.parse(e.data);
    addAgentNetEvent('learned', d);
    const el = document.getElementById('eng-brain');
    if (el) { el.className = 'badge badge-purple'; el.textContent = 'Learning'; setTimeout(() => { el.className = 'badge badge-blue'; el.textContent = 'Updated'; }, 3000); }
  });

  evtSource.addEventListener('evolution_entry', e => {
    const entry = JSON.parse(e.data);
    addEvolutionTickerEvent(entry);
    evolutionEntries.unshift(entry);
    renderEvolutionTable(evolutionEntries);
    updateEvolutionKPIs(evolutionEntries);
  });

  evtSource.addEventListener('server_log', e => {
    const d = JSON.parse(e.data);
    appendTermLine(d.level, d.msg, d.ts);
    ['term-sse-dot', 'sse-dot'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.background = '#10B981'; el.style.boxShadow = '0 0 6px #10B981'; setTimeout(() => { el.style.boxShadow = ''; }, 400); }
    });
    ['term-sse-status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'Live'; });
  });
}

// ── Terminal ─────────────────────────────────────────────────────────────────
let termLines = [];
let termPaused = false;
let termFilter = '';
let termLineCount = 0;

function setTermFilter(f) {
  termFilter = f;
  ['all','info','warn','error','sched','agent','energy'].forEach(k => {
    const el = document.getElementById('term-filter-' + k);
    if (el) el.style.borderColor = '';
  });
  const key = f === '' ? 'all' : f.toLowerCase();
  const btn = document.getElementById('term-filter-' + key);
  if (btn) btn.style.borderColor = '#00F0FF';
  renderTerminal();
}

function renderTerminal() {
  const el = document.getElementById('terminal-output');
  if (!el) return;
  const filtered = termFilter ? termLines.filter(l => l.msg.includes(termFilter) || l.level.includes(termFilter.toUpperCase())) : termLines;
  el.innerHTML = filtered.length === 0
    ? '<div style="color:#475569;font-style:italic">No matching log lines.</div>'
    : filtered.slice(-300).map(l => {
        const color = l.level === 'ERROR' ? '#EF4444' : l.level === 'WARN' ? '#F59E0B' : l.level === 'INFO' ? '#00F0FF' : '#94A3B8';
        const tsStr = l.ts ? new Date(l.ts).toLocaleTimeString() : '';
        const escaped = l.msg.replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return \`<div style="color:\${color};margin-bottom:1px"><span style="color:#475569;user-select:none;margin-right:8px;\${tsStr ? '' : 'display:none'}">\${tsStr}</span><span style="color:\${l.level === 'ERROR' ? '#EF4444' : l.level === 'WARN' ? '#F59E0B' : '#3B82F6'};font-weight:700;margin-right:8px">\${l.level}</span>\${escaped}</div>\`;
      }).join('');
  el.scrollTop = el.scrollHeight;
}

function clearTerminal() {
  termLines = [];
  termLineCount = 0;
  const el = document.getElementById('terminal-output');
  if (el) el.innerHTML = '<div style="color:#475569;font-style:italic">Terminal cleared.</div>';
  const cnt = document.getElementById('term-line-count');
  if (cnt) cnt.textContent = '0 lines';
}

function appendTermLine(level, msg, ts) {
  if (termPaused) return;
  termLines.push({ level: (level || 'LOG').toUpperCase(), msg: msg || '', ts });
  if (termLines.length > 1000) termLines.shift();
  termLineCount++;
  const cnt = document.getElementById('term-line-count');
  if (cnt) cnt.textContent = termLineCount + ' lines';
  const el = document.getElementById('terminal-output');
  if (!el) return;
  if (termFilter && !msg.includes(termFilter) && !(level || '').toUpperCase().includes(termFilter.toUpperCase())) return;
  const wasAtBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
  const color = level === 'ERROR' ? '#EF4444' : level === 'WARN' ? '#F59E0B' : level === 'INFO' ? '#00F0FF' : '#94A3B8';
  const tsStr = ts ? new Date(ts).toLocaleTimeString() : '';
  const escaped = (msg || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const div = document.createElement('div');
  div.style.cssText = \`color:\${color};margin-bottom:1px\`;
  div.innerHTML = \`<span style="color:#475569;user-select:none;margin-right:8px">\${tsStr}</span><span style="color:\${level === 'ERROR' ? '#EF4444' : level === 'WARN' ? '#F59E0B' : '#3B82F6'};font-weight:700;margin-right:8px">\${(level||'LOG').toUpperCase()}</span>\${escaped}\`;
  if (el.children.length === 1 && el.children[0].style.fontStyle === 'italic') el.innerHTML = '';
  el.appendChild(div);
  while (el.children.length > 300) el.removeChild(el.firstChild);
  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

function addActivityEvent(ev) {
  activityLog.unshift(ev);
  if (activityLog.length > 200) activityLog.pop();

  const icons = {
    new_user: { icon: '👤', color: '#10B981', label: 'New user registered' },
    new_strategy: { icon: '🎯', color: '#00F0FF', label: 'Strategy created' },
    agent_task: { icon: '🤖', color: '#7C3AED', label: 'Agent task' },
    credit_purchase: { icon: '⚡', color: '#F59E0B', label: 'Credit purchase' },
    credit_adjusted: { icon: '⚡', color: '#00F0FF', label: 'Credits adjusted' },
    user_suspended: { icon: '🚫', color: '#EF4444', label: 'User suspended' },
    user_terminated: { icon: '🗑️', color: '#EF4444', label: 'Account terminated' },
    user_unsuspended: { icon: '✅', color: '#10B981', label: 'User unsuspended' },
    notification_sent: { icon: '🔔', color: '#3B82F6', label: 'Notification sent' },
    deletion_request: { icon: '⚠️', color: '#EF4444', label: 'Account deletion request' },
    plan_changed: { icon: '🎯', color: '#00F0FF', label: 'Plan changed' },
  };
  const cfg = icons[ev.type] || { icon: '📌', color: '#64748B', label: ev.type };
  const p = ev.payload;
  const detail = p.email || p.userId || (p.title ? \`"\${p.title}"\` : JSON.stringify(p).substring(0, 60));

  const item = document.createElement('div');
  item.className = 'activity-item';
  item.style.borderLeft = \`3px solid \${cfg.color}\`;
  item.innerHTML = \`
    <div class="activity-icon" style="background:\${cfg.color}20">\${cfg.icon}</div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:600">\${cfg.label}</div>
      <div style="font-size:11px;color:#94A3B8;margin-top:2px">\${detail}</div>
    </div>
    <div style="font-size:10px;color:#475569;white-space:nowrap">just now</div>
  \`;

  ['activity-full', 'live-feed'].forEach(feedId => {
    const feed = document.getElementById(feedId);
    if (!feed) return;
    if (feed.children.length === 1 && feed.children[0].classList.contains('empty')) feed.innerHTML = '';
    feed.insertBefore(item.cloneNode(true), feed.firstChild);
    while (feed.children.length > 100) feed.removeChild(feed.lastChild);
  });
}

// ── Agent Network Graph ───────────────────────────────────────────────────────
const agentNetState = {
  agents: {
    SALESMAN:  { x: 200, y: 120, status: 'idle', platform: null, tasks: 0, lastSeen: null },
    AWARENESS: { x: 480, y: 120, status: 'idle', platform: null, tasks: 0, lastSeen: null },
    PROMOTION: { x: 200, y: 320, status: 'idle', platform: null, tasks: 0, lastSeen: null },
    LAUNCH:    { x: 480, y: 320, status: 'idle', platform: null, tasks: 0, lastSeen: null },
  },
  platforms: {
    facebook:  { x: 100, y: 220, color: '#1877F2' },
    instagram: { x: 340, y: 50,  color: '#E1306C' },
    twitter:   { x: 580, y: 220, color: '#1DA1F2' },
    linkedin:  { x: 340, y: 390, color: '#0A66C2' },
    tiktok:    { x: 680, y: 310, color: '#69C9D0' },
  },
  brain: { x: 340, y: 220 },
  activeEdges: [],
};

const AGENT_COLORS = { SALESMAN: '#10B981', AWARENESS: '#00F0FF', PROMOTION: '#F59E0B', LAUNCH: '#A78BFA' };
const STATUS_COLORS = { idle: '#475569', active: '#10B981', done: '#00F0FF', failed: '#EF4444' };

function renderAgentNetGraph() {
  const svg = document.getElementById('agent-network-svg');
  if (!svg) return;
  const W = svg.clientWidth || 740;
  const H = 480;
  const agents = agentNetState.agents;
  const platforms = agentNetState.platforms;
  const brain = agentNetState.brain;

  let html = \`<defs>
    <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="bgGrad" cx="50%" cy="50%"><stop offset="0%" stop-color="#1E293B" stop-opacity="0.4"/><stop offset="100%" stop-color="#0B0F19" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="\${W}" height="\${H}" fill="#0B0F19"/>
  <circle cx="\${W/2}" cy="\${H/2}" r="200" fill="url(#bgGrad)"/>\`;

  // Draw brain → agent edges
  Object.entries(agents).forEach(([name, agent]) => {
    const sc = STATUS_COLORS[agent.status] || '#475569';
    const opacity = agent.status !== 'idle' ? 0.6 : 0.15;
    html += \`<line x1="\${brain.x}" y1="\${brain.y}" x2="\${agent.x}" y2="\${agent.y}" stroke="\${sc}" stroke-width="1.5" stroke-dasharray="5 4" opacity="\${opacity}"/>\`;
  });

  // Draw agent → platform edges for active connections
  agentNetState.activeEdges.forEach(edge => {
    const a = agents[edge.agent];
    const p = platforms[edge.platform];
    if (!a || !p) return;
    html += \`<line x1="\${a.x}" y1="\${a.y}" x2="\${p.x}" y2="\${p.y}" stroke="\${AGENT_COLORS[edge.agent]}" stroke-width="2" opacity="0.7" filter="url(#glow)"/>\`;
  });

  // Draw platform nodes
  Object.entries(platforms).forEach(([name, p]) => {
    html += \`<circle cx="\${p.x}" cy="\${p.y}" r="18" fill="\${p.color}" opacity="0.15" stroke="\${p.color}" stroke-width="1.5"/>
    <text x="\${p.x}" y="\${p.y + 4}" text-anchor="middle" fill="\${p.color}" font-size="9" font-weight="700">\${name.slice(0,2).toUpperCase()}</text>
    <text x="\${p.x}" y="\${p.y + 30}" text-anchor="middle" fill="#475569" font-size="9">\${name}</text>\`;
  });

  // Draw AI Brain node
  html += \`<circle cx="\${brain.x}" cy="\${brain.y}" r="28" fill="rgba(0,240,255,0.08)" stroke="#00F0FF" stroke-width="2" filter="url(#glow)"/>
  <text x="\${brain.x}" y="\${brain.y - 3}" text-anchor="middle" fill="#00F0FF" font-size="9" font-weight="700">AI</text>
  <text x="\${brain.x}" y="\${brain.y + 9}" text-anchor="middle" fill="#00F0FF" font-size="9" font-weight="700">BRAIN</text>\`;

  // Draw agent nodes
  Object.entries(agents).forEach(([name, agent]) => {
    const color = AGENT_COLORS[name] || '#64748B';
    const sc = STATUS_COLORS[agent.status] || '#475569';
    const pulse = agent.status === 'active' ? \`<circle cx="\${agent.x}" cy="\${agent.y}" r="30" fill="none" stroke="\${color}" stroke-width="1" opacity="0.3"><animate attributeName="r" from="26" to="40" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite"/></circle>\` : '';
    html += \`\${pulse}
    <circle cx="\${agent.x}" cy="\${agent.y}" r="26" fill="\${color}" opacity="0.12" stroke="\${color}" stroke-width="2" filter="url(#glow)"/>
    <circle cx="\${agent.x + 16}" cy="\${agent.y - 16}" r="6" fill="\${sc}" stroke="#0B0F19" stroke-width="1.5"/>
    <text x="\${agent.x}" y="\${agent.y - 4}" text-anchor="middle" fill="\${color}" font-size="8" font-weight="700">\${name.slice(0,4)}</text>
    <text x="\${agent.x}" y="\${agent.y + 8}" text-anchor="middle" fill="#64748B" font-size="7">\${agent.tasks} tasks</text>
    <text x="\${agent.x}" y="\${agent.y + 42}" text-anchor="middle" fill="\${color}" font-size="9" font-weight="700">\${name}</text>\`;
  });

  svg.innerHTML = html;
}

function updateAgentNetNode(agentType, status, platform) {
  const agent = agentNetState.agents[agentType];
  if (!agent) return;
  agent.status = status;
  agent.platform = platform;
  agent.lastSeen = new Date().toISOString();
  if (status === 'active') {
    agent.tasks++;
    if (platform) {
      agentNetState.activeEdges = agentNetState.activeEdges.filter(e => e.agent !== agentType);
      agentNetState.activeEdges.push({ agent: agentType, platform: platform.toLowerCase() });
      setTimeout(() => {
        agentNetState.activeEdges = agentNetState.activeEdges.filter(e => !(e.agent === agentType && e.platform === platform.toLowerCase()));
        if (agentNetState.agents[agentType]) agentNetState.agents[agentType].status = 'idle';
        renderAgentNetGraph();
        updateAgentNetStatusPanel();
      }, 8000);
    }
  }
  renderAgentNetGraph();
  updateAgentNetStatusPanel();
}

function updateAgentNetStatusPanel() {
  const el = document.getElementById('agentnet-status');
  if (!el) return;
  const agents = agentNetState.agents;
  el.innerHTML = Object.entries(agents).map(([name, a]) => {
    const color = AGENT_COLORS[name] || '#64748B';
    const sc = STATUS_COLORS[a.status] || '#475569';
    const ago = a.lastSeen ? timeAgo(a.lastSeen) : 'Never';
    return \`<div style="display:flex;justify-content:space-between;align-items:center">
      <span style="color:\${color};font-size:12px;font-weight:700">\${name}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;color:#64748B">\${a.tasks} tasks · \${ago}</span>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:\${sc}"></span>
      </div>
    </div>\`;
  }).join('');
}

function addAgentNetEvent(type, data) {
  const feed = document.getElementById('agentnet-feed');
  if (!feed) return;
  if (feed.children.length === 1 && feed.children[0].classList.contains('empty')) feed.innerHTML = '';
  const icons = { started: '▶', done: '✓', failed: '✗', intelligence: '🧠', learned: '💡' };
  const colors = { started: '#00F0FF', done: '#10B981', failed: '#EF4444', intelligence: '#A78BFA', learned: '#F59E0B' };
  const desc = data.agent_type ? \`\${data.agent_type} → \${data.platform || 'AI Brain'}\` : (data.source ? \`\${data.source} engine fired\` : JSON.stringify(data).slice(0, 50));
  const item = document.createElement('div');
  item.style.cssText = \`font-size:11px;color:\${colors[type] || '#94A3B8'};display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1E293B\`;
  item.innerHTML = \`<span style="font-weight:700">\${icons[type] || '·'}</span><span style="flex:1">\${desc}</span><span style="color:#475569;white-space:nowrap">now</span>\`;
  feed.insertBefore(item, feed.firstChild);
  while (feed.children.length > 30) feed.removeChild(feed.lastChild);
}

// ── Agent Network Polling ─────────────────────────────────────────────────────
// The map always works via REST polling regardless of whether SSE is connected.
// Polling runs every 5s while the agentnet section is visible; SSE events are
// applied on top for real-time overlays when the connection is healthy.
function startAgentNetPolling() {
  stopAgentNetPolling();
  loadAgentNetwork();
  agentNetPoller = setInterval(loadAgentNetwork, 5000);
}

function stopAgentNetPolling() {
  if (agentNetPoller) { clearInterval(agentNetPoller); agentNetPoller = null; }
}

/* ═══════════════════════════════════════════════════════════════════
   AI SELF-EVOLUTION LOG
═══════════════════════════════════════════════════════════════════ */
let evolutionPoller = null;
let evolutionEntries = [];

const EVO_TYPE_COLORS = {
  prompt_tweak:      '#818CF8',
  threshold_change:  '#38BDF8',
  strategy_shift:    '#F59E0B',
  tone_adjustment:   '#A78BFA',
  benchmark:         '#10B981',
  self_improvement:  '#EC4899',
};

function evoTypeBadge(t) {
  const color = EVO_TYPE_COLORS[t] || '#64748B';
  return \`<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:\${color}20;color:\${color};border:1px solid \${color}40;white-space:nowrap">\${t || '—'}</span>\`;
}

function evoAgentBadge(a) {
  const map = { SALESMAN:'#10B981', AWARENESS:'#38BDF8', PROMOTION:'#F59E0B', LAUNCH:'#EC4899', CMA:'#818CF8', IPE:'#00F0FF' };
  const c = map[a] || '#64748B';
  return \`<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:\${c}20;color:\${c};border:1px solid \${c}40">\${a || 'SYSTEM'}</span>\`;
}

function evoTruncate(v, max) {
  if (v == null) return '<span style="color:#475569">—</span>';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > max ? \`<span title="\${s.replace(/"/g,'&quot;')}">\${s.slice(0,max)}…</span>\` : s;
}

async function loadEvolutionLog() {
  const type = document.getElementById('evo-type-filter')?.value || '';
  const url = '/api/evolution/log?limit=100' + (type ? '&type=' + encodeURIComponent(type) : '');
  try {
    const data = await api('GET', url);
    evolutionEntries = data.entries || [];
    renderEvolutionTable(evolutionEntries);
    updateEvolutionKPIs(evolutionEntries);
  } catch(e) {
    document.getElementById('evo-log-body').innerHTML = \`<tr><td colspan="7" style="padding:20px;text-align:center;color:#EF4444">Error: \${e.message}</td></tr>\`;
  }
}

function renderEvolutionTable(entries) {
  const tbody = document.getElementById('evo-log-body');
  const badge = document.getElementById('evo-count-badge');
  if (badge) badge.textContent = entries.length + ' entries';
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:24px;text-align:center;color:#475569">No evolution cycles yet — the Lead Discovery agent runs every 3 hours and will populate this log.</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(e => {
    const adopted   = Array.isArray(e.adopted_sources)      ? e.adopted_sources.length      : 0;
    const scaledBack= Array.isArray(e.scaled_back_sources)  ? e.scaled_back_sources.length  : 0;
    const ideas     = Array.isArray(e.new_source_ideas)     ? e.new_source_ideas.length     : 0;
    const analysis  = e.analysis  ? (e.analysis.length  > 80 ? \`<span title="\${e.analysis.replace(/"/g,'&quot;')}">\${e.analysis.slice(0,80)}…</span>\` : e.analysis) : '—';
    const rec       = e.overall_recommendation ? (e.overall_recommendation.length > 60 ? \`<span title="\${e.overall_recommendation.replace(/"/g,'&quot;')}">\${e.overall_recommendation.slice(0,60)}…</span>\` : e.overall_recommendation) : '—';
    return \`<tr style="border-bottom:1px solid #0F172A">
      <td style="padding:9px 14px;color:#64748B;white-space:nowrap;font-size:11px">\${timeAgo(e.created_at)}</td>
      <td style="padding:9px 14px">\${evoAgentBadge(e.agent)}</td>
      <td style="padding:9px 14px;color:#94A3B8;max-width:200px;font-size:11px">\${analysis}</td>
      <td style="padding:9px 14px;color:#E2E8F0;max-width:180px;font-size:11px">\${rec}</td>
      <td style="padding:9px 14px;text-align:right"><span style="color:#10B981;font-weight:700">\${adopted}</span></td>
      <td style="padding:9px 14px;text-align:right"><span style="color:#EF4444;font-weight:700">\${scaledBack}</span></td>
      <td style="padding:9px 14px;text-align:right"><span style="color:#818CF8;font-weight:700">\${ideas}</span></td>
    </tr>\`;
  }).join('');
}

function updateEvolutionKPIs(entries) {
  const totalEl   = document.getElementById('evo-total');
  const h24El     = document.getElementById('evo-24h');
  const avgEl     = document.getElementById('evo-avg-delta');
  const lastEl    = document.getElementById('evo-last-time');
  const lastTypeEl= document.getElementById('evo-last-type');

  if (totalEl) totalEl.textContent = entries.length;

  const cutoff = Date.now() - 86400000;
  const recent = entries.filter(e => new Date(e.created_at).getTime() > cutoff);
  if (h24El) h24El.textContent = recent.length;

  const adoptedCounts = entries.map(e => Array.isArray(e.adopted_sources) ? e.adopted_sources.length : 0);
  const avgAdopted = adoptedCounts.length ? (adoptedCounts.reduce((a,b)=>a+b,0)/adoptedCounts.length) : 0;
  if (avgEl) avgEl.textContent = adoptedCounts.length ? avgAdopted.toFixed(1) : '—';

  if (entries.length) {
    const last = entries[0];
    if (lastEl) lastEl.textContent = timeAgo(last.created_at);
    if (lastTypeEl) lastTypeEl.textContent = last.agent || '—';
  }

  renderEvolutionChart(entries);
}

function renderEvolutionChart(entries) {
  const svg = document.getElementById('evo-chart-svg');
  const emptyEl = document.getElementById('evo-chart-empty');
  if (!svg) return;

  const data = entries.slice().reverse();
  if (!data.length) {
    svg.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  svg.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';

  const W = svg.clientWidth || 800;
  const H = 180;
  const PAD = { top: 16, right: 20, bottom: 28, left: 40 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const adoptedVals   = data.map(e => Array.isArray(e.adopted_sources)     ? e.adopted_sources.length     : 0);
  const scaledVals    = data.map(e => Array.isArray(e.scaled_back_sources)  ? e.scaled_back_sources.length : 0);
  const maxV = Math.max(...adoptedVals, ...scaledVals, 1);

  const n = data.length;
  const barW = Math.max(4, Math.min(24, (cW / (n * 2.5))));
  const gap  = cW / Math.max(n, 1);

  const scaleY = (v) => PAD.top + cH - (v / maxV) * cH;

  // Bar pairs + x-axis labels
  const bars = data.map((e, i) => {
    const x = PAD.left + i * gap;
    const aH = (adoptedVals[i] / maxV) * cH;
    const sH = (scaledVals[i]  / maxV) * cH;
    const d  = new Date(e.created_at);
    const label = (i % Math.max(1, Math.floor(n / 6)) === 0 || i === n - 1)
      ? \`<text x="\${x + barW}" y="\${H - 6}" text-anchor="middle" fill="#475569" font-size="9">\${d.getMonth()+1}/\${d.getDate()}</text>\`
      : '';
    return \`
      <rect x="\${x}" y="\${PAD.top + cH - aH}" width="\${barW}" height="\${aH}" fill="#10B981" opacity="0.8" rx="2">
        <title>\${e.agent}: \${adoptedVals[i]} adopted, \${scaledVals[i]} scaled back — \${new Date(e.created_at).toLocaleString()}</title>
      </rect>
      <rect x="\${x + barW + 2}" y="\${PAD.top + cH - sH}" width="\${barW}" height="\${sH}" fill="#EF4444" opacity="0.7" rx="2">
        <title>\${e.agent}: \${scaledVals[i]} scaled back</title>
      </rect>
      \${label}
    \`;
  }).join('');

  // Y-axis ticks
  const yTicks = [0, Math.ceil(maxV/2), maxV].map(v => {
    return \`<text x="\${PAD.left - 6}" y="\${scaleY(v) + 4}" text-anchor="end" fill="#475569" font-size="9">\${v}</text>
    <line x1="\${PAD.left}" y1="\${scaleY(v)}" x2="\${PAD.left + cW}" y2="\${scaleY(v)}" stroke="#1E293B" stroke-width="1" stroke-dasharray="3,3"/>\`;
  }).join('');

  svg.innerHTML = \`
    <line x1="\${PAD.left}" y1="\${PAD.top}" x2="\${PAD.left}" y2="\${PAD.top+cH}" stroke="#1E293B" stroke-width="1"/>
    <line x1="\${PAD.left}" y1="\${PAD.top+cH}" x2="\${PAD.left+cW}" y2="\${PAD.top+cH}" stroke="#1E293B" stroke-width="1"/>
    \${yTicks}
    \${bars}
  \`;
}

function addEvolutionTickerEvent(entry) {
  const ticker = document.getElementById('evo-ticker');
  if (!ticker) return;
  const empty = ticker.querySelector('.empty');
  if (empty) empty.remove();
  const adopted   = Array.isArray(entry.adopted_sources)     ? entry.adopted_sources.length     : 0;
  const scaledBack= Array.isArray(entry.scaled_back_sources) ? entry.scaled_back_sources.length : 0;
  const color = adopted > scaledBack ? '#10B981' : scaledBack > adopted ? '#EF4444' : '#818CF8';
  const div = document.createElement('div');
  div.style.cssText = \`display:flex;align-items:flex-start;gap:8px;padding:6px 10px;border-radius:6px;background:\${color}10;border:1px solid \${color}25;font-size:11px;animation:fadeIn .3s ease\`;
  div.innerHTML = \`<span style="color:\${color};font-size:14px;line-height:1">●</span>
    <div style="flex:1;min-width:0">
      <span style="color:\${color};font-weight:700">\${entry.agent || 'AI'}</span>
      <span style="color:#64748B;margin:0 4px">·</span>
      <span style="color:#10B981">+\${adopted} adopted</span>
      <span style="color:#64748B;margin:0 4px">/</span>
      <span style="color:#EF4444">−\${scaledBack} scaled back</span>
      \${entry.analysis ? \`<div style="color:#64748B;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${entry.analysis.slice(0, 80)}</div>\` : ''}
    </div>
    <span style="color:#475569;white-space:nowrap">\${timeAgo(entry.created_at)}</span>\`;
  ticker.insertBefore(div, ticker.firstChild);
  while (ticker.children.length > 20) ticker.removeChild(ticker.lastChild);
}

function clearEvolutionFeed() {
  const ticker = document.getElementById('evo-ticker');
  if (ticker) ticker.innerHTML = '<div class="empty">Waiting for evolution events…</div>';
}

function startEvolutionPolling() {
  stopEvolutionPolling();
  evolutionPoller = setInterval(loadEvolutionLog, 30000);
}

function stopEvolutionPolling() {
  if (evolutionPoller) { clearInterval(evolutionPoller); evolutionPoller = null; }
}

async function loadAgentNetwork() {
  try {
    const tasks = await api('GET', '/api/agent-network');
    if (tasks && tasks.agents) {
      tasks.agents.forEach(a => {
        if (agentNetState.agents[a.agent_type]) {
          agentNetState.agents[a.agent_type].tasks = a.total || 0;
          // Mark as active if any running/pending in the last hour
          agentNetState.agents[a.agent_type].status = a.running > 0 ? 'active' : (a.done > 0 || a.total > 0 ? 'done' : 'idle');
          // Wire up active platform edges from the last active platform
          if (a.running > 0 && a.platforms && a.platforms.length > 0) {
            const plat = a.platforms[a.platforms.length - 1];
            if (agentNetState.platforms[plat]) {
              agentNetState.activeEdges = agentNetState.activeEdges.filter(e => e.agent !== a.agent_type);
              agentNetState.activeEdges.push({ agent: a.agent_type, platform: plat });
            }
          }
        }
      });
    }
    renderAgentNetGraph();
    updateAgentNetStatusPanel();
    // If SSE has given up (Polling mode), update status indicator to confirm data is live
    const ssEl = document.getElementById('sse-status-2');
    if (ssEl && ssEl.textContent === 'Polling') {
      setSseStatus('#F59E0B', 'Polling ✓');
    }
  } catch (e) {
    renderAgentNetGraph();
    updateAgentNetStatusPanel();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   APMA — Autonomous Political Marketing Agent
═══════════════════════════════════════════════════════════════════ */
let apmaSelectedClientId = null;

async function loadAPMASection() {
  await Promise.all([loadAPMAStats(), loadAPMAClients(), loadDesktopReleases(), apmaCheckMigrationStatus()]);
}

async function apmaCheckMigrationStatus() {
  const badge = document.getElementById('apma-migration-badge');
  const btn = document.getElementById('apma-migration-btn');
  if (!badge) return;
  badge.textContent = 'Checking schema…';
  badge.style.background = '#1E293B';
  badge.style.color = '#64748B';
  try {
    const data = await api('GET', '/admin/api/apma-migration/status');
    if (data.migrated) {
      badge.textContent = '✓ Schema up-to-date';
      badge.style.background = '#14532D';
      badge.style.color = '#4ADE80';
      btn.style.display = 'none';
    } else if (data.missing && data.missing[0] === 'SUPABASE_DB_URL not configured') {
      badge.textContent = '⚠ Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD on Railway to auto-migrate';
      badge.style.background = '#451A03';
      badge.style.color = '#FB923C';
      btn.style.display = 'none';
    } else {
      badge.textContent = '⚠ Missing: ' + (data.missing || []).join(', ');
      badge.style.background = '#450A0A';
      badge.style.color = '#F87171';
      btn.style.display = 'inline-flex';
    }
  } catch(e) {
    badge.textContent = '? Status unknown';
    badge.style.background = '#1E293B';
    badge.style.color = '#64748B';
  }
}

async function apmaRunMigration() {
  const btn = document.getElementById('apma-migration-btn');
  btn.textContent = 'Applying…'; btn.disabled = true;
  try {
    const data = await api('POST', '/admin/api/apma-migration/run');
    if (data.ok) {
      showToast('Migration applied successfully!', 'success');
    } else {
      showToast('Migration failed: ' + data.message, 'error');
    }
    await apmaCheckMigrationStatus();
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.textContent = '⚡ Apply Migration'; btn.disabled = false;
  }
}

/* ── APMA Live Cycle Monitor (polling) ────────────────────────────────────── */
let _apmaMonitorTimer = null;
let _apmaMonitorSeq   = 0;

const APMA_EVENT_COLOURS = {
  start:           '#818CF8',
  perception_start:'#38BDF8',
  perception_done: '#22D3EE',
  score_updated:   '#34D399',
  decision_start:  '#FBBF24',
  decision_done:   '#F59E0B',
  action_start:    '#FB923C',
  action_done:     '#22C55E',
  action_resume:   '#F472B6',
  cycle_complete:  '#A78BFA',
  prediction_start:'#60A5FA',
  prediction_done: '#93C5FD',
};

function _apmaEventHtml(ev) {
  const colour = APMA_EVENT_COLOURS[ev.event] || '#94A3B8';
  const ts = new Date(ev.ts).toLocaleTimeString();
  const label = ev.event.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
  let detail = '';
  if (ev.data.client)          detail = ' — ' + ev.data.client;
  else if (ev.data.executed != null) detail = ' — ' + ev.data.executed + ' ok / ' + ev.data.failed + ' fail';
  else if (ev.data.sample_size) detail = ' — ' + ev.data.sample_size + ' samples, sentiment ' + (ev.data.overall_sentiment ?? 0).toFixed(2);
  else if (ev.data.narrative_score != null) detail = ' — score ' + ev.data.narrative_score.toFixed(2);
  else if (ev.data.total_actions) detail = ' — ' + ev.data.total_actions + ' actions';
  return '<div><span style="color:#475569">[' + ts + ']</span> <span style="color:' + colour + ';font-weight:600">' + label + '</span><span style="color:#94A3B8">' + detail + '</span></div>';
}

async function _apmaFetchEvents() {
  try {
    const data = await api('GET', '/api/apma/events?since=' + _apmaMonitorSeq);
    if (!data || !data.events) return;
    if (data.events.length === 0) return;
    _apmaMonitorSeq = data.latest_seq;
    const feed = document.getElementById('apma-monitor-feed');
    if (!feed) return;
    const wasEmpty = feed.children.length === 1 && feed.children[0].style && feed.children[0].style.color === 'rgb(71, 85, 105)';
    if (wasEmpty) feed.innerHTML = '';
    data.events.forEach(ev => { feed.insertAdjacentHTML('beforeend', _apmaEventHtml(ev)); });
    feed.scrollTop = feed.scrollHeight;
    const dot = document.getElementById('apma-monitor-dot');
    const status = document.getElementById('apma-monitor-status');
    if (dot) dot.style.background = '#22C55E';
    if (status) status.textContent = 'Live — seq ' + _apmaMonitorSeq;
  } catch {}
}

function startAPMAMonitor() {
  if (_apmaMonitorTimer) return;
  const dot = document.getElementById('apma-monitor-dot');
  const status = document.getElementById('apma-monitor-status');
  if (dot) dot.style.background = '#FBBF24';
  if (status) status.textContent = 'Polling…';
  _apmaFetchEvents();
  _apmaMonitorTimer = setInterval(_apmaFetchEvents, 5000);
}

function stopAPMAMonitor() {
  if (!_apmaMonitorTimer) return;
  clearInterval(_apmaMonitorTimer);
  _apmaMonitorTimer = null;
  const dot = document.getElementById('apma-monitor-dot');
  const status = document.getElementById('apma-monitor-status');
  if (dot) dot.style.background = '#475569';
  if (status) status.textContent = 'Idle';
}

function clearAPMAMonitorLog() {
  const feed = document.getElementById('apma-monitor-feed');
  if (feed) feed.innerHTML = '<span style="color:#475569">Log cleared.</span>';
  _apmaMonitorSeq = 0;
}

/* ── Desktop Releases ─────────────────────────────────────────────────────── */
async function loadDesktopReleases() {
  const tbody = document.getElementById('desktop-releases-body');
  if (!tbody) return;
  try {
    const data = await api('GET', '/api/apma/desktop-releases');
    if (!data.releases || !data.releases.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748B;padding:20px">No desktop releases published yet.</td></tr>';
      return;
    }
    tbody.innerHTML = data.releases.map(function(r) {
      return '<tr style="border-bottom:1px solid #1E293B">' +
        '<td style="padding:8px 12px;font-weight:700;color:#F1F5F9">' + r.version + '</td>' +
        '<td style="padding:8px 12px;font-size:11px;color:#94A3B8">' + new Date(r.released_at).toLocaleDateString() + '</td>' +
        '<td style="padding:8px 12px;max-width:320px"><a href="' + r.store_url + '" target="_blank" style="color:#6366F1;font-size:11px;word-break:break-all">' + r.store_url + '</a></td>' +
        '<td style="padding:8px 12px"><span style="color:' + (r.force_update ? '#EF4444' : '#475569') + ';font-size:12px">' + (r.force_update ? 'Yes' : 'No') + '</span></td>' +
        '<td style="padding:8px 12px"><span style="padding:2px 8px;border-radius:99px;font-size:11px;background:rgba(34,197,94,.15);color:#22C55E">Published</span></td>' +
        '</tr>';
    }).join('');
  } catch(e) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#EF4444;padding:20px">Failed to load releases.</td></tr>';
    console.error('[DesktopReleases]', e.message);
  }
}

async function publishDesktopRelease() {
  const version = document.getElementById('dr-version').value.trim();
  const url     = document.getElementById('dr-url').value.trim();
  const notes   = document.getElementById('dr-notes').value.trim();
  const force   = document.getElementById('dr-force').checked;
  const min     = document.getElementById('dr-min').checked;

  if (!version || !url) { showToast('Version and download URL are required.', 'error'); return; }

  const btn = document.getElementById('dr-publish-btn');
  btn.disabled = true;
  btn.textContent = 'Publishing…';

  try {
    await api('POST', '/api/apma/desktop-releases', { version, download_url: url, notes, force_update: force, is_min_supported: min });
    showToast('Desktop release v' + version + ' published! Clients will be notified on next launch.', 'success');
    document.getElementById('dr-version').value = '';
    document.getElementById('dr-url').value     = '';
    document.getElementById('dr-notes').value   = '';
    document.getElementById('dr-force').checked = false;
    document.getElementById('dr-min').checked   = false;
    await loadDesktopReleases();
  } catch(e) {
    showToast('Failed to publish: ' + e.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Publish Release';
  }
}

async function loadAPMAStats() {
  try {
    const data = await api('GET', '/api/apma/stats');
    document.getElementById('apma-stat-clients').textContent   = data.active_clients ?? 0;
    document.getElementById('apma-stat-campaigns').textContent = data.active_campaigns ?? 0;
    document.getElementById('apma-stat-actions').textContent   = data.actions_24h ?? 0;
    document.getElementById('apma-stat-blogs').textContent     = data.live_blogs ?? 0;
    document.getElementById('apma-stat-personas').textContent  = data.active_personas ?? 0;
  } catch(e) { console.error('[APMA stats]', e.message); }
}

async function loadAPMAClients() {
  const list = document.getElementById('apma-client-list');
  list.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748B;padding:20px">Loading...</td></tr>';
  try {
    const data = await api('GET', '/api/apma/clients');
    if (!data.clients.length) {
      list.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748B;padding:20px">No clients yet — create one below.</td></tr>';
      return;
    }
    list.innerHTML = data.clients.map(c => \`
      <tr>
        <td><strong style="color:#F1F5F9">\${c.name}</strong></td>
        <td><span style="font-size:11px;color:#94A3B8">\${c.country}</span></td>
        <td><span style="padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:\${c.goal==='improve'?'rgba(34,197,94,.15)':'rgba(239,68,68,.15)'};color:\${c.goal==='improve'?'#22C55E':'#EF4444'}">\${c.goal}</span></td>
        <td style="font-weight:700;color:\${scoreColor(c.narrative_score)}">\${(c.narrative_score||0).toFixed(3)}</td>
        <td><span style="padding:2px 8px;border-radius:99px;font-size:11px;background:\${c.status==='active'?'rgba(34,197,94,.15)':'rgba(100,116,139,.15)'};color:\${c.status==='active'?'#22C55E':'#94A3B8'}">\${c.status}</span></td>
        <td>
          <button onclick="loadAPMACampaigns('\${c.id}','\${c.name}')" style="background:#6366F1;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer">Campaigns</button>
          <button onclick="apmaRotateKey('\${c.id}')" style="background:transparent;color:#F59E0B;border:1px solid rgba(245,158,11,.3);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;margin-left:4px">Rotate Key</button>
        </td>
      </tr>
    \`).join('');
  } catch(e) {
    list.innerHTML = \`<tr><td colspan="6" style="color:#EF4444;padding:12px">\${e.message}</td></tr>\`;
  }
}

async function loadAPMACampaigns(clientId, clientName) {
  apmaSelectedClientId = clientId;
  document.getElementById('apma-campaigns-title').textContent = 'Campaigns — ' + clientName;
  document.getElementById('apma-campaigns-panel').style.display = 'block';
  const list = document.getElementById('apma-campaign-list');
  list.innerHTML = '<tr><td colspan="6" style="color:#64748B;text-align:center;padding:16px">Loading…</td></tr>';
  try {
    const data = await api('GET', '/api/apma/clients/'+clientId+'/campaigns');
    if (!data.campaigns.length) {
      list.innerHTML = '<tr><td colspan="6" style="color:#64748B;text-align:center;padding:16px">No campaigns yet.</td></tr>';
      return;
    }
    list.innerHTML = data.campaigns.map(c => \`
      <tr id="camp-row-\${c.id}">
        <td style="color:#F1F5F9;font-weight:500">
          \${c.name}
          \${c.campaign_type ? '<br><span style="font-size:10px;color:#64748B;text-transform:capitalize">'+c.campaign_type+(c.campaign_subtype?'/'+c.campaign_subtype:'')+'</span>' : ''}
        </td>
        <td>
          <span id="camp-status-badge-\${c.id}" style="padding:2px 8px;border-radius:99px;font-size:11px;background:\${c.status==='active'?'rgba(34,197,94,.15)':c.status==='paused'?'rgba(245,158,11,.15)':'rgba(100,116,139,.15)'};color:\${c.status==='active'?'#22C55E':c.status==='paused'?'#F59E0B':'#94A3B8'}">\${c.status}</span>
        </td>
        <td style="font-weight:700;color:\${scoreColor(c.narrative_score_current)}">\${(c.narrative_score_current||0).toFixed(3)} / \${(c.narrative_score_target||0.6).toFixed(2)}</td>
        <td style="color:#94A3B8;font-size:12px">\${c.start_date||'—'}</td>
        <td style="color:#64748B;font-size:11px">\${c.duration_months ? c.duration_months+'mo' : '—'}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button id="camp-pause-btn-\${c.id}" onclick="apmaToggleCampaign('\${c.id}','\${c.status}')"
              style="background:\${c.status==='active'?'rgba(245,158,11,.15)':'rgba(34,197,94,.15)'};color:\${c.status==='active'?'#F59E0B':'#22C55E'};border:1px solid \${c.status==='active'?'rgba(245,158,11,.3)':'rgba(34,197,94,.3)'};border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">
              \${c.status==='active'?'⏸ Pause':'▶ Resume'}
            </button>
            <button onclick="apmaViewAnalytics('\${c.id}','\${c.name}')" style="background:transparent;color:#38BDF8;border:1px solid rgba(56,189,248,.3);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">📊 Analytics</button>
            <button onclick="apmaViewOverview('\${c.id}')" style="background:transparent;color:#818CF8;border:1px solid rgba(129,140,248,.3);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">Overview</button>
            <button onclick="apmaTrigger('\${c.id}')" style="background:#22C55E;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">▶ Trigger</button>
          </div>
        </td>
      </tr>
    \`).join('');
  } catch(e) {
    list.innerHTML = \`<tr><td colspan="6" style="color:#EF4444;padding:12px">\${e.message}</td></tr>\`;
  }
}

async function apmaToggleCampaign(id, currentStatus) {
  const btn = document.getElementById('camp-pause-btn-'+id);
  const badge = document.getElementById('camp-status-badge-'+id);
  const newStatus = currentStatus === 'active' ? 'paused' : 'active';
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    const res = await api('PATCH', '/api/apma/campaigns/'+id+'/status', { status: newStatus });
    const s = res.campaign.status;
    if (badge) {
      badge.textContent = s;
      badge.style.background = s==='active'?'rgba(34,197,94,.15)':s==='paused'?'rgba(245,158,11,.15)':'rgba(100,116,139,.15)';
      badge.style.color = s==='active'?'#22C55E':s==='paused'?'#F59E0B':'#94A3B8';
    }
    if (btn) {
      btn.textContent = s==='active'?'⏸ Pause':'▶ Resume';
      btn.style.background = s==='active'?'rgba(245,158,11,.15)':'rgba(34,197,94,.15)';
      btn.style.color = s==='active'?'#F59E0B':'#22C55E';
      btn.style.borderColor = s==='active'?'rgba(245,158,11,.3)':'rgba(34,197,94,.3)';
      btn.setAttribute('onclick', \`apmaToggleCampaign('\${id}','\${s}')\`);
      btn.disabled = false;
    }
    showToast('Campaign '+s+' successfully', 'success');
  } catch(e) {
    showToast('Error: '+e.message, 'error');
    if (btn) { btn.textContent = currentStatus==='active'?'⏸ Pause':'▶ Resume'; btn.disabled = false; }
  }
}

async function apmaViewAnalytics(id, name) {
  const panel = document.getElementById('apma-analytics-panel');
  const content = document.getElementById('apma-analytics-content');
  const title = document.getElementById('apma-analytics-title');
  panel.style.display = 'block';
  title.textContent = 'Analytics — '+name;
  content.innerHTML = '<div style="color:#64748B;text-align:center;padding:40px">Loading analytics…</div>';
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
  try {
    const d = await api('GET', '/api/apma/campaigns/'+id+'/analytics?days=90');
    const hist = d.sentiment_history || [];
    const maxSentIdx = hist.length - 1;

    // Build SVG line chart for sentiment
    const svgW = 560, svgH = 100;
    let svgPath = '', svgArea = '';
    if (hist.length > 1) {
      const scores = hist.map(h => h.score);
      const minS = Math.min(...scores, -1), maxS = Math.max(...scores, 1);
      const xs = hist.map((_, i) => (i / (hist.length-1)) * (svgW-40) + 20);
      const ys = hist.map(h => svgH - ((h.score - minS) / (maxS - minS)) * (svgH-20) - 10);
      svgPath = 'M'+xs.map((x,i)=>x+','+ys[i]).join(' L');
      svgArea = 'M'+xs[0]+','+(svgH-10)+' L'+xs.map((x,i)=>x+','+ys[i]).join(' L')+' L'+xs[maxSentIdx]+','+(svgH-10)+' Z';
    }

    // Bar chart helpers
    const maxType = d.by_type?.length ? Math.max(...d.by_type.map(t=>t.total)) : 1;
    const maxPlat = d.by_platform?.length ? Math.max(...d.by_platform.map(p=>p.total)) : 1;

    content.innerHTML = \`
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        <div style="background:#131C2E;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Narrative Score</div>
          <div style="font-size:28px;font-weight:700;color:\${scoreColor(d.campaign?.narrative_score_current||0)}">\${(d.campaign?.narrative_score_current||0).toFixed(3)}</div>
        </div>
        <div style="background:#131C2E;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Total Actions (90d)</div>
          <div style="font-size:28px;font-weight:700;color:#818CF8">\${d.total_actions||0}</div>
        </div>
        <div style="background:#131C2E;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Success Rate</div>
          <div style="font-size:28px;font-weight:700;color:#22C55E">\${Math.round((d.success_rate||0)*100)}%</div>
        </div>
        <div style="background:#131C2E;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Blogs Live</div>
          <div style="font-size:28px;font-weight:700;color:#F59E0B">\${d.blogs?.filter(b=>b.status==='live').length||0}</div>
        </div>
      </div>

      <div style="background:#131C2E;border-radius:8px;padding:14px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Narrative Score Trend (90 days)</div>
        \${hist.length > 1 ? \`
        <svg viewBox="0 0 \${svgW} \${svgH}" style="width:100%;height:100px;display:block">
          <defs>
            <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#818CF8" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="#818CF8" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <line x1="20" y1="\${svgH/2}" x2="\${svgW-20}" y2="\${svgH/2}" stroke="#334155" stroke-dasharray="4,4" stroke-width="1"/>
          <path d="\${svgArea}" fill="url(#sentGrad)"/>
          <path d="\${svgPath}" fill="none" stroke="#818CF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        \` : '<div style="color:#64748B;text-align:center;padding:24px;font-size:12px">No sentiment data yet — runs automatically with each campaign cycle.</div>'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div style="background:#131C2E;border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Actions by Type</div>
          \${(d.by_type||[]).map(t=>\`
            <div style="margin-bottom:7px">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
                <span style="color:#E2E8F0;text-transform:capitalize">\${t.type.replace(/_/g,' ')}</span>
                <span style="color:#64748B">\${t.total} (\${Math.round(t.rate*100)}% ok)</span>
              </div>
              <div style="height:6px;background:#1E293B;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:\${Math.round(t.total/maxType*100)}%;background:#6366F1;border-radius:3px;transition:width .4s"></div>
              </div>
            </div>
          \`).join('')||'<div style="color:#64748B;font-size:12px">No action data yet.</div>'}
        </div>
        <div style="background:#131C2E;border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Actions by Platform</div>
          \${(d.by_platform||[]).map((p,i)=>{const colors=['#1DA1F2','#1877F2','#FF4500','#25D366','#229ED9','#0A66C2','#FF0050'];const c=colors[i%colors.length];return\`
            <div style="margin-bottom:7px">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
                <span style="color:#E2E8F0;text-transform:capitalize">\${p.platform}</span>
                <span style="color:#64748B">\${p.total}</span>
              </div>
              <div style="height:6px;background:#1E293B;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:\${Math.round(p.total/maxPlat*100)}%;background:\${c};border-radius:3px;transition:width .4s"></div>
              </div>
            </div>
          \`}).join('')||'<div style="color:#64748B;font-size:12px">No platform data yet.</div>'}
        </div>
      </div>

      \${d.strategies?.length ? \`
      <div style="background:#131C2E;border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Strategy Effectiveness (last 30 runs)</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="color:#64748B;font-size:10px;text-transform:uppercase">
              <th style="padding:6px 10px;text-align:left">Date</th>
              <th style="padding:6px 10px;text-align:right">Actions Done</th>
              <th style="padding:6px 10px;text-align:right">Effectiveness</th>
            </tr></thead>
            <tbody>\${d.strategies.map(s=>\`
              <tr style="border-top:1px solid #1E293B">
                <td style="padding:6px 10px;color:#E2E8F0">\${s.plan_date||'—'}</td>
                <td style="padding:6px 10px;text-align:right;color:#94A3B8">\${s.actions_done||0}/\${s.actions_total||0}</td>
                <td style="padding:6px 10px;text-align:right;font-weight:600;color:\${(s.effectiveness||0)>=0.6?'#22C55E':(s.effectiveness||0)>=0.3?'#F59E0B':'#EF4444'}">\${s.effectiveness!=null?Math.round(s.effectiveness*100)+'%':'—'}</td>
              </tr>
            \`).join('')}</tbody>
          </table>
        </div>
      </div>
      \` : ''}
    \`;
  } catch(e) {
    content.innerHTML = \`<div style="color:#EF4444;padding:12px">\${e.message}</div>\`;
  }
}

async function apmaViewOverview(campaignId) {
  try {
    const data = await api('GET', '/api/apma/campaigns/'+campaignId+'/overview');
    const score = data.campaign.narrative_score_current || 0;
    document.getElementById('apma-overview-content').innerHTML = \`
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        <div style="background:#263348;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Narrative Score</div>
          <div style="font-size:28px;font-weight:700;color:\${scoreColor(score)}">\${score.toFixed(3)}</div>
        </div>
        <div style="background:#263348;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Total Posts</div>
          <div style="font-size:28px;font-weight:700;color:#818CF8">\${data.campaign.total_posts||0}</div>
        </div>
        <div style="background:#263348;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Blog Articles</div>
          <div style="font-size:28px;font-weight:700;color:#22C55E">\${data.blogs.reduce((a,b)=>a+b.article_count,0)}</div>
        </div>
        <div style="background:#263348;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:11px;color:#64748B">Strategies Run</div>
          <div style="font-size:28px;font-weight:700;color:#F59E0B">\${data.strategies.length}</div>
        </div>
      </div>
      <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px">RECENT ACTIONS</div>
      \${data.recent_actions.slice(0,10).map(a=>\`
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#263348;border-radius:6px;margin-bottom:4px">
          <span style="color:#E2E8F0;text-transform:capitalize">\${a.action_type} on \${a.platform}</span>
          <span style="color:\${a.success?'#22C55E':'#EF4444'};font-size:12px">\${a.success?'✓':'✗'} \${new Date(a.executed_at).toLocaleTimeString()}</span>
        </div>
      \`).join('')}
    \`;
    document.getElementById('apma-overview-panel').style.display = 'block';
  } catch(e) {
    showToast('Error loading overview: ' + e.message, 'error');
  }
}

async function apmaTrigger(campaignId) {
  if (!confirm('Manually trigger a full APMA cycle for this campaign?')) return;
  try {
    const data = await api('POST', '/api/apma/campaigns/'+campaignId+'/trigger');
    showToast('✓ ' + data.message, 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function apmaRotateKey(clientId) {
  if (!confirm('Rotate the API key for this client? The old key will stop working immediately.')) return;
  try {
    const data = await api('POST', '/api/apma/clients/'+clientId+'/rotate-key');
    showApiKeyModal(data.api_key, 'API Key Rotated');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function apmaCreateClient() {
  const name = document.getElementById('apma-new-name').value.trim();
  const country = document.getElementById('apma-new-country').value.trim().toUpperCase();
  const goal = document.getElementById('apma-new-goal').value;
  const keywords = document.getElementById('apma-new-keywords').value.trim();
  const targets = document.getElementById('apma-new-targets').value.trim();
  if (!name || !country) { showToast('Name and country code are required.', 'error'); return; }
  const btn = document.getElementById('apma-create-btn');
  btn.textContent = 'Creating…'; btn.disabled = true;
  try {
    const data = await api('POST', '/api/apma/clients', {
      name, country,
      goal: goal || 'improve',
      keywords: keywords ? keywords.split(',').map(k=>k.trim()).filter(Boolean) : [],
      target_entities: targets ? targets.split(',').map(t=>t.trim()).filter(Boolean) : [],
    });
    showApiKeyModal(data.api_key, 'Client Created — Save Your API Key');
    document.getElementById('apma-new-name').value='';
    document.getElementById('apma-new-country').value='';
    document.getElementById('apma-new-keywords').value='';
    document.getElementById('apma-new-targets').value='';
    await loadAPMAClients();
    await loadAPMAStats();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
  finally { btn.textContent = 'Create Client'; btn.disabled = false; }
}

async function apmaCreateCampaign() {
  if (!apmaSelectedClientId) { showToast('Select a client first.', 'error'); return; }
  const name = document.getElementById('apma-camp-name').value.trim();
  const keywords = document.getElementById('apma-camp-keywords').value.trim();
  const platforms = document.getElementById('apma-camp-platforms').value.trim();
  const campaign_type = document.getElementById('apma-camp-type').value;
  const campaign_subtype = document.getElementById('apma-camp-subtype').value;
  const duration_months = parseInt(document.getElementById('apma-camp-duration').value, 10);
  if (!name || !keywords) { showToast('Campaign name and keywords are required.', 'error'); return; }
  const btn = document.getElementById('apma-camp-btn');
  btn.textContent = 'Creating…'; btn.disabled = true;
  try {
    const result = await api('POST', '/api/apma/clients/'+apmaSelectedClientId+'/campaigns', {
      name,
      keywords: keywords.split(',').map(k=>k.trim()).filter(Boolean),
      platforms: platforms ? platforms.split(',').map(p=>p.trim().toLowerCase()).filter(Boolean) : ['twitter','facebook','reddit'],
      campaign_type,
      campaign_subtype,
      duration_months,
    });
    showToast('Campaign "' + result.campaign.name + '" created successfully!', 'success');
    document.getElementById('apma-camp-name').value='';
    document.getElementById('apma-camp-keywords').value='';
    document.getElementById('apma-camp-platforms').value='';
    document.getElementById('apma-new-campaign-form').style.display='none';
    await loadAPMACampaigns(apmaSelectedClientId, document.getElementById('apma-campaigns-title').textContent.replace('Campaigns — ',''));
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
  finally { btn.textContent = 'Create Campaign'; btn.disabled = false; }
}

function scoreColor(score) {
  if (score >= 0.3) return '#22C55E';
  if (score >= 0) return '#F59E0B';
  return '#EF4444';
}

// ── Feature Flags ─────────────────────────────────────────────────────────────
let ffGlobalFlags = [];

async function loadFeatureFlags() {
  try {
    const data = await api('GET', '/api/feature-flags');
    ffGlobalFlags = data.flags || [];
    renderGlobalFlags();
  } catch(e) { showToast('Error loading flags: ' + e.message, 'error'); }
}

function renderGlobalFlags() {
  const el = document.getElementById('ff-global-list');
  if (!ffGlobalFlags.length) { el.innerHTML = '<div class="empty">No flags found \u2014 run backend/feature_flags_migration.sql in Supabase first.</div>'; return; }
  el.innerHTML = ffGlobalFlags.map(function(f) {
    const bg   = f.enabled ? '#22C55E' : '#374151';
    const knob = f.enabled ? 'right:3px' : 'left:3px';
    const chk  = f.enabled ? 'checked' : '';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:8px;background:#0D1625;margin-bottom:4px;gap:12px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:600;color:#E2E8F0">' + f.label + '</div>' +
        '<div style="font-size:11px;color:#475569;margin-top:2px">' + (f.description || '') + ' <code style="color:#475569;font-size:10px">' + f.flag_key + '</code></div>' +
      '</div>' +
      '<label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0">' +
        '<input type="checkbox" ' + chk + ' onchange="toggleGlobalFlag(\\'' + f.flag_key + '\\',this.checked)" style="opacity:0;width:0;height:0;position:absolute">' +
        '<div id="ff-toggle-' + f.flag_key + '" style="width:44px;height:24px;border-radius:12px;background:' + bg + ';transition:background .2s;position:relative;flex-shrink:0">' +
          '<div style="position:absolute;top:3px;' + knob + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>' +
        '</div>' +
      '</label>' +
    '</div>';
  }).join('');
}

async function toggleGlobalFlag(key, enabled) {
  try {
    await api('PUT', '/api/feature-flags/' + key, { enabled });
    const f = ffGlobalFlags.find(x => x.flag_key === key);
    if (f) f.enabled = enabled;
    renderGlobalFlags();
    const el = document.getElementById('ff-save-status');
    if (el) { el.style.opacity = '1'; setTimeout(() => el.style.opacity = '0', 1800); }
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function loadUserOverrides() {
  const userId = document.getElementById('ff-user-id-input').value.trim();
  if (!userId) return;
  const el = document.getElementById('ff-user-overrides-list');
  el.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await api('GET', '/api/feature-flags/user/' + userId);
    const overrides = data.overrides || [];
    if (!ffGlobalFlags.length) await loadFeatureFlags();
    el.innerHTML = ffGlobalFlags.map(function(f) {
      const ov = overrides.find(function(o) { return o.flag_key === f.flag_key; });
      const effectiveEnabled = ov !== undefined ? ov.enabled : f.enabled;
      const hasOverride = ov !== undefined;
      const bg   = effectiveEnabled ? '#22C55E' : '#374151';
      const knob = effectiveEnabled ? 'right:2px' : 'left:2px';
      const chk  = effectiveEnabled ? 'checked' : '';
      const ovBadge = hasOverride
        ? '<span style="font-size:10px;background:#6366F130;color:#818CF8;border:1px solid #6366F150;border-radius:4px;padding:1px 6px">override</span>'
        : '<span style="font-size:10px;color:#475569">global default</span>';
      const rmBtn = hasOverride
        ? '<button onclick="removeUserOverride(\\'' + userId + '\\',\\'' + f.flag_key + '\\')" title="Remove override" style="background:#1E293B;border:1px solid #334155;color:#94A3B8;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer">\u2715</button>'
        : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:8px;background:#0D1625;margin-bottom:4px;gap:12px">' +
        '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:13px;font-weight:600;color:#E2E8F0">' + f.label + '</span>' + ovBadge +
        '</div></div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">' +
          '<label style="position:relative;display:inline-flex;align-items:center;cursor:pointer">' +
            '<input type="checkbox" ' + chk + ' onchange="setUserOverride(\\'' + userId + '\\',\\'' + f.flag_key + '\\',this.checked)" style="opacity:0;width:0;height:0;position:absolute">' +
            '<div style="width:40px;height:22px;border-radius:11px;background:' + bg + ';transition:background .2s;position:relative">' +
              '<div style="position:absolute;top:2px;' + knob + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>' +
            '</div>' +
          '</label>' + rmBtn +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) { el.innerHTML = '<div class="empty" style="color:#EF4444">Error: ' + e.message + '</div>'; }
}

async function setUserOverride(userId, key, enabled) {
  try {
    await api('PUT', '/api/feature-flags/user/' + userId + '/' + key, { enabled });
    await loadUserOverrides();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function removeUserOverride(userId, key) {
  try {
    await api('DELETE', '/api/feature-flags/user/' + userId + '/' + key);
    await loadUserOverrides();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ── API Key Modal ─────────────────────────────────────────────────────────────
function showApiKeyModal(apiKey, title) {
  document.getElementById('api-key-modal-title').textContent = title || 'API Key';
  document.getElementById('api-key-modal-value').textContent = apiKey;
  document.getElementById('api-key-modal-copy-btn').textContent = 'Copy';
  document.getElementById('api-key-modal').style.display = 'flex';
}

function closeApiKeyModal() {
  document.getElementById('api-key-modal').style.display = 'none';
}

function copyApiKey() {
  const key = document.getElementById('api-key-modal-value').textContent;
  navigator.clipboard.writeText(key).then(() => {
    const btn = document.getElementById('api-key-modal-copy-btn');
    btn.textContent = '✓ Copied!';
    btn.style.background = '#22C55E';
    setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = '#6366F1'; }, 2000);
  }).catch(() => {
    const el = document.getElementById('api-key-modal-value');
    const range = document.createRange();
    range.selectNode(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
}

</script>

<!-- ── API Key Modal ──────────────────────────────────────────────────────── -->
<div id="api-key-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;align-items:center;justify-content:center;">
  <div style="background:#1E293B;border:1px solid #334155;border-radius:16px;padding:32px;width:540px;max-width:95vw;box-shadow:0 24px 60px rgba(0,0,0,.6);" onclick="event.stopPropagation()">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div id="api-key-modal-title" style="font-size:17px;font-weight:700;color:#F1F5F9"></div>
        <div style="font-size:12px;color:#F59E0B;margin-top:4px">⚠ This key is shown only once — copy it now and store it securely.</div>
      </div>
      <button onclick="closeApiKeyModal()" style="background:none;border:none;color:#64748B;cursor:pointer;font-size:22px;line-height:1;">✕</button>
    </div>
    <div style="background:#0B1120;border:1px solid #1E293B;border-radius:8px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">
      <code id="api-key-modal-value" style="flex:1;font-family:monospace;font-size:13px;color:#00F0FF;word-break:break-all;user-select:all;line-height:1.5;"></code>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button onclick="closeApiKeyModal()" style="background:#263348;border:1px solid #334155;color:#94A3B8;border-radius:8px;padding:10px 20px;font-size:13px;cursor:pointer;">Close</button>
      <button id="api-key-modal-copy-btn" onclick="copyApiKey()" style="background:#6366F1;border:none;color:#fff;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer;transition:background .2s;">Copy</button>
    </div>
  </div>
</div>

</body>
</html>`;

export default router;
