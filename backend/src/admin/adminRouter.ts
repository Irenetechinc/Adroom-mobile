import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getServiceSupabaseClient } from '../config/supabase';

const router = Router();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ADMIN@ADROOMAI.COM').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mEGER2200@DAV1960?';
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || crypto.randomBytes(64).toString('hex');

// ─── SSE broadcast registry ──────────────────────────────────────────────────
const sseClients = new Set<Response>();

function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((c) => { try { c.write(msg); } catch { sseClients.delete(c); } });
}

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
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (email.toLowerCase() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return res.json({ token: signToken(ADMIN_EMAIL), email: ADMIN_EMAIL });
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
    });

    res.json({
      success: true,
      plan,
      status: effectiveStatus,
      credits_granted: grantCredits && planCredits > 0 ? planCredits : 0,
      new_balance: newBalance,
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

// ─── SSE REAL-TIME STREAM ─────────────────────────────────────────────────────
router.get('/api/stream', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sseClients.add(res);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); sseClients.delete(res); }
  }, 20000);

  const pollActivity = setInterval(async () => {
    try {
      const sb = getServiceSupabaseClient();
      const since = new Date(Date.now() - 30000).toISOString();
      const [newUsers, newStrategies, newAgentTasks, newTx] = await Promise.all([
        sb.from('energy_accounts').select('user_id, created_at').gte('created_at', since),
        sb.from('strategies').select('id, title, user_id, created_at').gte('created_at', since),
        sb.from('agent_tasks').select('id, agent_type, task_type, platform, status, user_id, created_at').gte('created_at', since).neq('status', 'pending'),
        sb.from('energy_transactions').select('user_id, type, credits, description, created_at').gte('created_at', since).in('type', ['topup', 'subscription_grant', 'trial_grant']),
      ]);

      const events: any[] = [];
      (newUsers.data || []).forEach(u => events.push({ type: 'new_user', payload: u }));
      (newStrategies.data || []).forEach(s => events.push({ type: 'new_strategy', payload: s }));
      (newAgentTasks.data || []).forEach(t => events.push({ type: 'agent_task', payload: t }));
      (newTx.data || []).forEach(t => events.push({ type: 'credit_purchase', payload: t }));

      if (events.length > 0) {
        const msg = `event: activity\ndata: ${JSON.stringify(events)}\n\n`;
        try { res.write(msg); } catch {}
      }
    } catch {}
  }, 10000);

  req.on('close', () => {
    clearInterval(ping);
    clearInterval(pollActivity);
    sseClients.delete(res);
  });
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
    <div class="nav-section">MONITORING</div>
    <button class="nav-item" onclick="showSection('activity')" id="nav-activity">
      <span>📡</span> Live Activity
    </button>
    <button class="nav-item" onclick="showSection('logs')" id="nav-logs">
      <span>📋</span> Admin Logs
    </button>
    <button class="nav-item" onclick="showSection('cma')" id="nav-cma">
      <span>💰</span> CMA Savings
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

      <!-- ───────────── LIVE ACTIVITY ───────────── -->
      <div id="section-activity" class="section">
        <div class="section-header">
          <div class="section-title">Live Activity Feed</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="sse-dot" id="sse-dot-2" style="background:#EF4444"></div>
            <span style="font-size:12px;color:#64748B" id="sse-status-2">Connecting…</span>
          </div>
        </div>
        <div class="card" style="padding:16px">
          <div class="activity-feed" id="activity-full" style="max-height:600px">
            <div class="empty">Waiting for events…</div>
          </div>
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
  connectSSE();
}

if (TOKEN) {
  api('GET', '/api/stats').then(() => initApp()).catch(() => {
    localStorage.removeItem('admin_token');
    TOKEN = '';
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
const SECTIONS = ['dashboard', 'users', 'credits', 'notifications', 'activity', 'logs', 'cma'];
const TITLES = { dashboard: 'Dashboard', users: 'All Users', credits: 'Credit Management', notifications: 'Push Notifications', activity: 'Live Activity', logs: 'Admin Logs', cma: 'CMA Savings Dashboard' };

function showSection(name) {
  SECTIONS.forEach(s => {
    document.getElementById('section-' + s).classList.toggle('active', s === name);
    const nav = document.getElementById('nav-' + s);
    if (nav) nav.classList.toggle('active', s === name);
  });
  document.getElementById('page-title').textContent = TITLES[name] || name;
  if (name === 'cma') { loadCMAStats(); loadModelCredits(); }
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
function connectSSE() {
  if (evtSource) evtSource.close();
  const url = '/admin/api/stream?token=' + encodeURIComponent(TOKEN);
  evtSource = new EventSource(url);

  evtSource.onopen = () => {
    ['sse-dot', 'sse-dot-2'].forEach(id => { const el = document.getElementById(id); if (el) el.style.background = '#10B981'; });
    ['sse-status', 'sse-status-2'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'Live'; });
  };

  evtSource.onerror = () => {
    ['sse-dot', 'sse-dot-2'].forEach(id => { const el = document.getElementById(id); if (el) el.style.background = '#EF4444'; });
    ['sse-status', 'sse-status-2'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'Reconnecting…'; });
    setTimeout(connectSSE, 5000);
  };

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
</script>
</body>
</html>`;

export default router;
