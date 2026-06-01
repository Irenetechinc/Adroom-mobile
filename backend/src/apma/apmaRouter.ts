import { Router } from 'express';
import crypto from 'crypto';
import { getServiceSupabaseClient } from '../config/supabase';
import { apmaOAuthStates } from './apmaOAuthStore';
import { apmaOrchestrator } from './apmaOrchestrator';
import { apmaHumanizerService } from './apmaHumanizerService';
import { apmaPerceptionService } from './apmaPerceptionService';
import { apmaDecisionService } from './apmaDecisionService';
import { apmaClientProfileService } from './apmaClientProfileService';
import { registerSSEClient, unregisterSSEClient } from '../events/sseBroadcast';
import { getAPMAEvents, getLatestSeq } from './apmaEventLog';

export const apmaAdminRouter = Router();   // mounted at /admin/apma  (admin-JWT protected in adminRouter)
export const apmaClientRouter = Router();  // mounted at /api/apma/client  (APMA API-key protected)

// ─── APMA CLIENT AUTH MIDDLEWARE ──────────────────────────────────────────────
async function apmaClientAuth(req: any, res: any, next: any) {
  const apiKey = req.headers['x-apma-key'] as string || req.query.key as string;
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  const sb = getServiceSupabaseClient();
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const { data: client } = await sb
    .from('apma_clients')
    .select('id, name, status')
    .eq('api_key_hash', hash)
    .eq('status', 'active')
    .single();
  if (!client) return res.status(401).json({ error: 'Invalid or inactive API key' });
  req.apmaClientId = client.id;
  req.apmaClientName = client.name;
  next();
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES  (mounted inside adminRouter with admin-JWT already applied)
// ════════════════════════════════════════════════════════════════════════════

// ─── List all APMA clients ────────────────────────────────────────────────
apmaAdminRouter.get('/clients', async (_req, res) => {
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb
    .from('apma_clients')
    .select('id, name, slug, country, goal, status, narrative_score, target_score, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ clients: data ?? [] });
});

// ─── Create APMA client ───────────────────────────────────────────────────
apmaAdminRouter.post('/clients', async (req, res) => {
  const { name, country, goal, target_entities, target_score } = req.body;
  if (!name || !country) return res.status(400).json({ error: 'name and country required' });
  const sb = getServiceSupabaseClient();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const { data, error } = await sb.from('apma_clients').insert({
    name, slug, country,
    goal: goal || 'improve',
    target_entities: target_entities || [],
    target_score: target_score ?? 0.6,
    api_key: apiKey,
    api_key_hash: apiKeyHash,
    status: 'active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Seed country-appropriate personas asynchronously so the response is instant
  setImmediate(() => apmaHumanizerService.seedPersonas(data.id, country || 'US').catch(console.error));
  res.json({ client: data, api_key: apiKey, message: 'Store the API key securely — it will not be shown again. Personas are being generated in the background.' });
});

// ─── Update APMA client ───────────────────────────────────────────────────
apmaAdminRouter.patch('/clients/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'country', 'goal', 'target_entities', 'status', 'target_score', 'contract_signed'];
  const updates: any = {};
  for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
  updates.updated_at = new Date().toISOString();
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb.from('apma_clients').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ client: data });
});

// ─── Rotate API key ───────────────────────────────────────────────────────
apmaAdminRouter.post('/clients/:id/rotate-key', async (req, res) => {
  const { id } = req.params;
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const sb = getServiceSupabaseClient();
  await sb.from('apma_clients').update({ api_key: apiKey, api_key_hash: apiKeyHash }).eq('id', id);
  res.json({ api_key: apiKey, message: 'Key rotated. Store the new key securely.' });
});

// ─── SSE cycle monitor ────────────────────────────────────────────────────
apmaAdminRouter.get('/cycle-monitor', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  try { res.write('event: connected\ndata: {"message":"APMA cycle monitor connected"}\n\n'); } catch {}
  registerSSEClient(res);
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); }
    catch { clearInterval(ping); unregisterSSEClient(res); }
  }, 15000);
  req.on('close', () => { clearInterval(ping); unregisterSSEClient(res); });
});

// ─── Create campaign for client ───────────────────────────────────────────
apmaAdminRouter.post('/clients/:clientId/campaigns', async (req, res) => {
  const { clientId } = req.params;
  const {
    name, goal, platforms, keywords, target_score, end_date,
    campaign_type, campaign_subtype, duration_months,
  } = req.body;
  if (!name || !keywords?.length) return res.status(400).json({ error: 'name and keywords required' });
  const sb = getServiceSupabaseClient();
  const { data: client } = await sb.from('apma_clients').select('goal').eq('id', clientId).single();

  // Compute end_date from duration_months if not provided
  const computedEndDate = end_date ?? (duration_months
    ? new Date(Date.now() + (duration_months as number) * 30 * 86_400_000).toISOString().split('T')[0]
    : null);

  const { data, error } = await sb.from('apma_campaigns').insert({
    client_id: clientId,
    name,
    goal: goal || client?.goal || 'improve',
    campaign_type: campaign_type || 'gubernatorial',
    campaign_subtype: campaign_subtype || 'build',
    duration_months: duration_months || 12,
    platforms: platforms || ['twitter', 'facebook', 'reddit'],
    keywords,
    narrative_score_target: target_score ?? 0.6,
    end_date: computedEndDate,
    status: 'active',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ campaign: data });
});

// ─── List campaigns ───────────────────────────────────────────────────────
apmaAdminRouter.get('/clients/:clientId/campaigns', async (req, res) => {
  const { clientId } = req.params;
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb
    .from('apma_campaigns')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ campaigns: data ?? [] });
});

// ─── Get full campaign overview (admin) ───────────────────────────────────
apmaAdminRouter.get('/campaigns/:id/overview', async (req, res) => {
  const { id } = req.params;
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb.from('apma_campaigns').select('*').eq('id', id).single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const [actions, strategies, blogs, groups, sentiment] = await Promise.all([
    sb.from('apma_actions').select('action_type, success, executed_at').eq('campaign_id', id).order('executed_at', { ascending: false }).limit(50),
    sb.from('political_strategies').select('plan_date, status, actions_total, actions_done, effectiveness').eq('campaign_id', id).order('plan_date', { ascending: false }).limit(14),
    sb.from('apma_blog_sites').select('name, domain, status, article_count').eq('campaign_id', id),
    sb.from('apma_social_groups').select('platform, name, member_count, status').eq('campaign_id', id),
    sb.from('apma_sentiment_history').select('score, recorded_at').eq('campaign_id', id).order('recorded_at', { ascending: true }).limit(200),
  ]);

  res.json({
    campaign,
    recent_actions: actions.data ?? [],
    strategies: strategies.data ?? [],
    blogs: blogs.data ?? [],
    groups: groups.data ?? [],
    sentiment_history: sentiment.data ?? [],
  });
});

// ─── Pause / Resume campaign in realtime ──────────────────────────────────
apmaAdminRouter.patch('/campaigns/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'paused', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be active, paused, or completed' });
  }
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb
    .from('apma_campaigns')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, name, status, client_id')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ campaign: data });
});

// ─── Full campaign analytics (admin) ──────────────────────────────────────
apmaAdminRouter.get('/campaigns/:id/analytics', async (req, res) => {
  const { id } = req.params;
  const days = Math.min(180, parseInt(String(req.query.days ?? '90'), 10));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const sb = getServiceSupabaseClient();

  const [campaignRes, sentimentRes, actionsRes, blogsRes, strategiesRes] = await Promise.all([
    sb.from('apma_campaigns').select('*').eq('id', id).single(),
    sb.from('apma_sentiment_history').select('score, recorded_at').eq('campaign_id', id).gte('recorded_at', since).order('recorded_at', { ascending: true }),
    sb.from('apma_actions').select('action_type, platform, success, executed_at').eq('campaign_id', id).gte('executed_at', since),
    sb.from('apma_blog_sites').select('name, domain, article_count, status').eq('campaign_id', id),
    sb.from('political_strategies').select('plan_date, effectiveness, actions_total, actions_done').eq('campaign_id', id).order('plan_date', { ascending: false }).limit(30),
  ]);

  if (!campaignRes.data) return res.status(404).json({ error: 'Campaign not found' });

  const byType: Record<string, { total: number; success: number }> = {};
  const byPlatform: Record<string, { total: number; success: number }> = {};
  const byDay: Record<string, number> = {};
  let successCount = 0;

  for (const a of (actionsRes.data ?? []) as any[]) {
    if (!byType[a.action_type]) byType[a.action_type] = { total: 0, success: 0 };
    byType[a.action_type].total++;
    if (a.success) { byType[a.action_type].success++; successCount++; }

    if (!byPlatform[a.platform]) byPlatform[a.platform] = { total: 0, success: 0 };
    byPlatform[a.platform].total++;
    if (a.success) byPlatform[a.platform].success++;

    const day = (a.executed_at as string).split('T')[0];
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  const total = actionsRes.data?.length ?? 0;

  res.json({
    campaign: campaignRes.data,
    sentiment_history: sentimentRes.data ?? [],
    by_type: Object.entries(byType).sort((a, b) => b[1].total - a[1].total)
      .map(([type, v]) => ({ type, total: v.total, success: v.success, rate: v.total > 0 ? v.success / v.total : 0 })),
    by_platform: Object.entries(byPlatform).sort((a, b) => b[1].total - a[1].total)
      .map(([platform, v]) => ({ platform, total: v.total, success: v.success, rate: v.total > 0 ? v.success / v.total : 0 })),
    by_day: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    total_actions: total,
    success_rate: total > 0 ? successCount / total : 0,
    blogs: blogsRes.data ?? [],
    strategies: strategiesRes.data ?? [],
  });
});

// ─── Manually trigger a perception + planning cycle ───────────────────────
apmaAdminRouter.post('/campaigns/:id/trigger', async (req, res) => {
  const { id } = req.params;
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('id', id)
    .single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ message: 'Cycle triggered. Running in background.' });
  setImmediate(() => apmaOrchestrator.runCycle().catch(console.error));
});

// ─── Persona management ───────────────────────────────────────────────────
apmaAdminRouter.get('/clients/:clientId/personas', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb.from('apma_personas').select('id, name, age, location, writing_style, platforms, active, usage_count').eq('client_id', req.params.clientId).order('usage_count', { ascending: false });
  res.json({ personas: data ?? [] });
});

apmaAdminRouter.patch('/personas/:id', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { active } = req.body;
  await sb.from('apma_personas').update({ active }).eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Self-improvement logs ────────────────────────────────────────────────
apmaAdminRouter.get('/self-improvement', async (_req, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb.from('apma_self_improvement_logs').select('*').order('created_at', { ascending: false }).limit(50);
  res.json({ logs: data ?? [] });
});

apmaAdminRouter.post('/self-improvement/:id/deploy', async (req, res) => {
  const sb = getServiceSupabaseClient();
  await sb.from('apma_self_improvement_logs').update({ deployed: true }).eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Client Intelligence Profile ─────────────────────────────────────────
apmaAdminRouter.get('/campaigns/:id/profile', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('id', req.params.id)
    .single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  try {
    const profile = await apmaClientProfileService.getLatestProfile(campaign.client_id, campaign.id);
    if (!profile) {
      // Auto-generate on first request
      const generated = await apmaClientProfileService.buildClientProfile(campaign.apma_clients, campaign);
      return res.json({ profile: generated });
    }
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apmaAdminRouter.post('/campaigns/:id/profile/refresh', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('id', req.params.id)
    .single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  try {
    const profile = await apmaClientProfileService.buildClientProfile(campaign.apma_clients, campaign);
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── APMA Social Accounts (multi-account per platform) ───────────────────
apmaAdminRouter.get('/clients/:clientId/social-accounts', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb
    .from('apma_social_accounts')
    .select('*')
    .eq('client_id', req.params.clientId)
    .order('created_at', { ascending: false });
  res.json({ accounts: data ?? [] });
});

apmaAdminRouter.post('/clients/:clientId/social-accounts', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { platform, account_type, account_id, account_name, access_token, refresh_token, token_expires_at, phone_number, waba_id, meta } = req.body;
  if (!platform || !account_id || !account_name || !access_token) {
    return res.status(400).json({ error: 'platform, account_id, account_name, access_token required' });
  }
  const { data, error } = await sb.from('apma_social_accounts').insert({
    client_id: req.params.clientId,
    platform, account_type: account_type || 'page', account_id, account_name,
    access_token, refresh_token, token_expires_at, phone_number, waba_id,
    meta: meta || {},
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ account: data });
});

apmaAdminRouter.patch('/social-accounts/:id', async (req, res) => {
  const sb = getServiceSupabaseClient();
  const { active } = req.body;
  const { data, error } = await sb
    .from('apma_social_accounts')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ account: data });
});

apmaAdminRouter.delete('/social-accounts/:id', async (req, res) => {
  const sb = getServiceSupabaseClient();
  await sb.from('apma_social_accounts').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Desktop app releases (admin: publish + list) ─────────────────────────
apmaAdminRouter.get('/desktop-releases', async (_req, res) => {
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb
    .from('app_releases')
    .select('version, released_at, store_url, force_update, is_min_supported, changelog_md')
    .eq('platform', 'desktop')
    .eq('is_published', true)
    .order('released_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ releases: data ?? [] });
});

apmaAdminRouter.post('/desktop-releases', async (req, res) => {
  const { version, download_url, notes, force_update, is_min_supported } = req.body as {
    version?: string;
    download_url?: string;
    notes?: string;
    force_update?: boolean;
    is_min_supported?: boolean;
  };
  if (!version?.trim() || !download_url?.trim()) {
    return res.status(400).json({ error: 'version and download_url are required' });
  }
  const sb = getServiceSupabaseClient();
  const { error } = await sb.from('app_releases').insert({
    platform: 'desktop',
    version: version.trim(),
    store_url: download_url.trim(),
    changelog_md: notes?.trim() ?? '',
    force_update: !!force_update,
    is_min_supported: !!is_min_supported,
    is_published: true,
    released_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── Recent cycle events (for admin live monitor polling) ─────────────────
apmaAdminRouter.get('/events', (req, res) => {
  const since = req.query.since != null ? parseInt(String(req.query.since), 10) : undefined;
  const events = getAPMAEvents(since);
  res.json({ events, latest_seq: getLatestSeq() });
});

// ─── Predicted political events for a campaign (admin) ────────────────────
apmaAdminRouter.get('/campaigns/:id/predicted-events', async (req, res) => {
  const { id } = req.params;
  const horizon = Math.min(90, Math.max(7, parseInt(String(req.query.horizon ?? '30'), 10))) as 7 | 30 | 90;
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('id', id)
    .single();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  try {
    const client = campaign.apma_clients;
    const events = await apmaDecisionService.predictUpcomingEvents(client, campaign, horizon as 7 | 30 | 90);
    res.json({ events, campaign_id: id, horizon });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Predicted events for ALL active campaigns (admin calendar) ────────────
apmaAdminRouter.get('/predicted-events', async (req, res) => {
  const horizon = Math.min(90, Math.max(7, parseInt(String(req.query.horizon ?? '30'), 10))) as 7 | 30 | 90;
  const sb = getServiceSupabaseClient();
  const { data: rows } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('status', 'active');
  const results: any[] = [];
  for (const row of rows ?? []) {
    try {
      const evts = await apmaDecisionService.predictUpcomingEvents(row.apma_clients, row, horizon);
      for (const e of evts) results.push({ ...e, campaign_id: row.id, campaign_name: row.name, client_name: row.apma_clients?.name });
    } catch { /* skip failed */ }
  }
  results.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ events: results, horizon });
});

// ─── System stats ─────────────────────────────────────────────────────────
apmaAdminRouter.get('/stats', async (_req, res) => {
  const sb = getServiceSupabaseClient();
  const [clients, campaigns, actions, blogs, personas] = await Promise.all([
    sb.from('apma_clients').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('apma_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('apma_actions').select('id', { count: 'exact', head: true }).gte('executed_at', new Date(Date.now() - 86_400_000).toISOString()),
    sb.from('apma_blog_sites').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    sb.from('apma_personas').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);
  res.json({
    active_clients: clients.count ?? 0,
    active_campaigns: campaigns.count ?? 0,
    actions_24h: actions.count ?? 0,
    live_blogs: blogs.count ?? 0,
    active_personas: personas.count ?? 0,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CLIENT API ROUTES  (for desktop app — API key auth)
// ════════════════════════════════════════════════════════════════════════════

apmaClientRouter.use(apmaClientAuth);

// ─── Recent cycle events (desktop app live monitor polling) ──────────────
apmaClientRouter.get('/events', async (req: any, res) => {
  const since = req.query.since != null ? parseInt(String(req.query.since), 10) : undefined;
  // Resolve the client's active campaign_id for filtering
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('id')
    .eq('client_id', req.apmaClientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  const events = getAPMAEvents(since, campaign?.id);
  res.json({ events, latest_seq: getLatestSeq() });
});

apmaClientRouter.get('/dashboard', async (req: any, res) => {
  const data = await apmaOrchestrator.getClientDashboard(req.apmaClientId);
  if (!data) return res.status(404).json({ error: 'No active campaign found' });
  res.json(data);
});

apmaClientRouter.get('/campaigns', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb
    .from('apma_campaigns')
    .select('id, name, status, start_date, narrative_score_current, narrative_score_target, total_posts, total_comments, total_blogs, updated_at')
    .eq('client_id', req.apmaClientId)
    .order('created_at', { ascending: false });
  res.json({ campaigns: data ?? [] });
});

apmaClientRouter.get('/sentiment-trend', async (req: any, res) => {
  const days = Math.min(90, parseInt(String(req.query.days ?? '30'), 10));
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb.from('apma_campaigns').select('id').eq('client_id', req.apmaClientId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).single();
  if (!campaign) return res.json({ trend: [] });
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb.from('apma_sentiment_history').select('score, recorded_at').eq('campaign_id', campaign.id).gte('recorded_at', since).order('recorded_at', { ascending: true });
  res.json({ trend: data ?? [] });
});

apmaClientRouter.get('/recommendations', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb.from('apma_campaigns').select('id').eq('client_id', req.apmaClientId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).single();
  if (!campaign) return res.json({ recommendations: [] });
  const { data } = await sb.from('apma_recommendations').select('id, text, priority, status, created_at, implemented_at').eq('campaign_id', campaign.id).order('created_at', { ascending: false }).limit(20);
  res.json({ recommendations: data ?? [] });
});

apmaClientRouter.post('/veto/:recId', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data: rec } = await sb.from('apma_recommendations').select('client_id, veto_deadline').eq('id', req.params.recId).single();
  if (!rec || rec.client_id !== req.apmaClientId) return res.status(403).json({ error: 'Not authorized' });
  if (rec.veto_deadline && new Date(rec.veto_deadline) < new Date()) {
    return res.status(400).json({ error: 'Veto window has expired — action already executed' });
  }
  await sb.from('apma_recommendations').update({ status: 'vetoed' }).eq('id', req.params.recId);
  res.json({ ok: true, message: 'Action vetoed successfully' });
});

apmaClientRouter.get('/actions', async (req: any, res) => {
  const since24h = req.query.since ?? new Date(Date.now() - 86_400_000).toISOString();
  const sb = getServiceSupabaseClient();
  const { data } = await sb
    .from('apma_actions')
    .select('action_type, platform, success, executed_at')
    .eq('client_id', req.apmaClientId)
    .gte('executed_at', since24h)
    .order('executed_at', { ascending: false })
    .limit(200);
  const counts: Record<string, number> = {};
  for (const a of (data ?? []) as any[]) {
    counts[a.action_type] = (counts[a.action_type] ?? 0) + 1;
  }
  res.json({ actions: data ?? [], counts });
});

apmaClientRouter.get('/blogs', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb.from('apma_blog_sites').select('id, name, domain, status, article_count, monthly_visits, created_at').eq('client_id', req.apmaClientId).order('created_at', { ascending: false });
  res.json({ blogs: data ?? [] });
});

// ─── Strategies with live performance metrics ──────────────────────────────
apmaClientRouter.get('/strategies', async (req: any, res) => {
  const sb = getServiceSupabaseClient();

  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('id')
    .eq('client_id', req.apmaClientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!campaign) return res.json({ strategies: [] });

  const limit = Math.min(30, Math.max(1, parseInt(String(req.query.limit ?? '14'), 10)));

  const { data: strategies } = await sb
    .from('political_strategies')
    .select('id, plan_date, status, actions_total, actions_done, effectiveness, created_at')
    .eq('campaign_id', campaign.id)
    .order('plan_date', { ascending: false })
    .limit(limit);

  if (!strategies?.length) return res.json({ strategies: [] });

  const strategyIds = strategies.map((s: any) => s.id);

  const { data: perfRows } = await sb
    .from('agent_performance')
    .select('strategy_id, platform, agent_type, impressions, reach, likes, comments, shares, paid_equivalent_usd')
    .in('strategy_id', strategyIds);

  type PerfAgg = {
    impressions: number; reach: number; likes: number;
    comments: number; shares: number; paid_equivalent_usd: number;
    post_count: number;
    by_platform: Record<string, { impressions: number; likes: number; comments: number; shares: number }>;
    by_agent: Record<string, number>;
  };

  const perfMap: Record<string, PerfAgg> = {};
  for (const sid of strategyIds) {
    perfMap[sid] = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, paid_equivalent_usd: 0, post_count: 0, by_platform: {}, by_agent: {} };
  }

  for (const row of (perfRows ?? []) as any[]) {
    const agg = perfMap[row.strategy_id];
    if (!agg) continue;
    agg.impressions        += row.impressions        ?? 0;
    agg.reach              += row.reach              ?? 0;
    agg.likes              += row.likes              ?? 0;
    agg.comments           += row.comments           ?? 0;
    agg.shares             += row.shares             ?? 0;
    agg.paid_equivalent_usd += row.paid_equivalent_usd ?? 0;
    agg.post_count         += 1;

    const p = row.platform ?? 'unknown';
    if (!agg.by_platform[p]) agg.by_platform[p] = { impressions: 0, likes: 0, comments: 0, shares: 0 };
    agg.by_platform[p].impressions += row.impressions ?? 0;
    agg.by_platform[p].likes       += row.likes       ?? 0;
    agg.by_platform[p].comments    += row.comments    ?? 0;
    agg.by_platform[p].shares      += row.shares      ?? 0;

    const at = row.agent_type ?? 'unknown';
    agg.by_agent[at] = (agg.by_agent[at] ?? 0) + 1;
  }

  const result = (strategies as any[]).map((s) => ({
    ...s,
    performance: perfMap[s.id] ?? null,
    has_performance: (perfMap[s.id]?.post_count ?? 0) > 0,
  }));

  res.json({ strategies: result, campaign_id: campaign.id });
});

// ─── Client intelligence profile ──────────────────────────────────────────
apmaClientRouter.get('/profile', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('client_id', req.apmaClientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!campaign) return res.json({ profile: null });
  try {
    const profile = await apmaClientProfileService.getLatestProfile(campaign.client_id, campaign.id);
    if (!profile) {
      const generated = await apmaClientProfileService.buildClientProfile(campaign.apma_clients, campaign);
      return res.json({ profile: generated });
    }
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apmaClientRouter.post('/profile/refresh', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('client_id', req.apmaClientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!campaign) return res.json({ profile: null });
  try {
    const profile = await apmaClientProfileService.buildClientProfile(campaign.apma_clients, campaign);
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Self-improvement logs (client-facing) ────────────────────────────────
apmaClientRouter.get('/self-improvement', async (_req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb
    .from('apma_self_improvement_logs')
    .select('id, skill_name, description, performance_delta, deployed, created_at, test_result')
    .order('created_at', { ascending: false })
    .limit(50);
  res.json({ logs: data ?? [] });
});

// ─── Social accounts (client-facing — full CRUD for APMA operator) ────────
apmaClientRouter.get('/social-accounts', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data } = await sb
    .from('apma_social_accounts')
    .select('id, platform, account_type, account_name, active, last_used_at, usage_count, phone_number, created_at')
    .eq('client_id', req.apmaClientId)
    .order('created_at', { ascending: false });
  res.json({ accounts: data ?? [] });
});

apmaClientRouter.post('/social-accounts', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { platform, account_type, account_id, account_name, access_token, phone_number, waba_id, meta } = req.body;
  if (!platform || !account_id || !account_name || !access_token) {
    return res.status(400).json({ error: 'platform, account_id, account_name, access_token required' });
  }
  const { data, error } = await sb.from('apma_social_accounts').insert({
    client_id: req.apmaClientId,
    platform, account_type: account_type || 'page', account_id, account_name,
    access_token, phone_number, waba_id, meta: meta || {},
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ account: data });
});

apmaClientRouter.patch('/social-accounts/:id', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { active } = req.body;
  const { data: existing } = await sb.from('apma_social_accounts').select('client_id').eq('id', req.params.id).single();
  if (!existing || existing.client_id !== req.apmaClientId) return res.status(403).json({ error: 'Not authorized' });
  const { data, error } = await sb.from('apma_social_accounts')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ account: data });
});

apmaClientRouter.delete('/social-accounts/:id', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data: existing } = await sb.from('apma_social_accounts').select('client_id').eq('id', req.params.id).single();
  if (!existing || existing.client_id !== req.apmaClientId) return res.status(403).json({ error: 'Not authorized' });
  await sb.from('apma_social_accounts').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Real-time opposition intelligence ────────────────────────────────────
apmaClientRouter.get('/opposition', async (req: any, res) => {
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns').select('id, name, keywords, goal')
    .eq('client_id', req.apmaClientId).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).single();
  if (!campaign) return res.json({ threats: [], momentum: 0, total_opposition_signals: 0, sentiment_history_7d: [] });

  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [oppConvs, sentHist, recent7d] = await Promise.all([
    sb.from('political_conversations')
      .select('narrative_cluster, sentiment_score, platform, content_summary, recorded_at')
      .eq('campaign_id', campaign.id).lt('sentiment_score', -0.25)
      .gte('recorded_at', since30d).order('recorded_at', { ascending: false }).limit(300),
    sb.from('apma_sentiment_history').select('score, recorded_at')
      .eq('campaign_id', campaign.id).gte('recorded_at', since30d)
      .order('recorded_at', { ascending: true }),
    sb.from('political_conversations').select('narrative_cluster, sentiment_score')
      .eq('campaign_id', campaign.id).lt('sentiment_score', -0.2).gte('recorded_at', since7d),
  ]);

  const clusterMap: Record<string, { count: number; sum: number; platforms: Set<string>; trending: boolean; samples: string[] }> = {};
  const recentClusters = new Set((recent7d.data ?? []).map((c: any) => c.narrative_cluster));

  for (const c of (oppConvs.data ?? []) as any[]) {
    const key = c.narrative_cluster || 'general';
    if (!clusterMap[key]) clusterMap[key] = { count: 0, sum: 0, platforms: new Set(), trending: false, samples: [] };
    clusterMap[key].count++;
    clusterMap[key].sum += c.sentiment_score ?? 0;
    clusterMap[key].platforms.add(c.platform);
    if (c.content_summary && clusterMap[key].samples.length < 3) clusterMap[key].samples.push(c.content_summary);
    clusterMap[key].trending = recentClusters.has(key);
  }

  const threats = Object.entries(clusterMap)
    .map(([cluster, d]) => ({ cluster, volume: d.count, avg_sentiment: d.count > 0 ? d.sum / d.count : 0, platforms: Array.from(d.platforms), trending: d.trending, samples: d.samples }))
    .sort((a, b) => b.volume - a.volume).slice(0, 15);

  const hist = (sentHist.data ?? []) as any[];
  const half = Math.floor(hist.length / 2);
  const avg = (arr: any[]) => arr.length ? arr.reduce((s, x) => s + x.score, 0) / arr.length : 0;
  const momentum = hist.length > 1 ? avg(hist.slice(half)) - avg(hist.slice(0, half)) : 0;

  res.json({ campaign_name: campaign.name, threats, momentum, total_opposition_signals: (oppConvs.data ?? []).length, sentiment_history_7d: hist.slice(-14) });
});

// ─── Client analytics dashboard ───────────────────────────────────────────
apmaClientRouter.get('/analytics', async (req: any, res) => {
  const days = Math.min(90, parseInt(String(req.query.days ?? '30'), 10));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb.from('apma_campaigns')
    .select('id, name, narrative_score_current, narrative_score_target, total_posts, total_comments, total_blogs')
    .eq('client_id', req.apmaClientId).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).single();
  if (!campaign) return res.json({ analytics: null });

  const [actionsRes, sentRes] = await Promise.all([
    sb.from('apma_actions').select('action_type, platform, success, executed_at').eq('campaign_id', campaign.id).gte('executed_at', since),
    sb.from('apma_sentiment_history').select('score, recorded_at').eq('campaign_id', campaign.id).gte('recorded_at', since).order('recorded_at', { ascending: true }),
  ]);

  const byType: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let successCount = 0;

  for (const a of (actionsRes.data ?? []) as any[]) {
    byType[a.action_type] = (byType[a.action_type] ?? 0) + 1;
    byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + 1;
    const day = (a.executed_at as string).split('T')[0];
    byDay[day] = (byDay[day] ?? 0) + 1;
    if (a.success) successCount++;
  }

  const total = actionsRes.data?.length ?? 0;
  res.json({
    campaign,
    by_type: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    by_platform: Object.entries(byPlatform).sort((a, b) => b[1] - a[1]).map(([platform, count]) => ({ platform, count })),
    by_day: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    total,
    success_rate: total > 0 ? successCount / total : 0,
    sentiment_trend: sentRes.data ?? [],
  });
});

// ─── Predicted events (client-facing calendar) ────────────────────────────
apmaClientRouter.get('/predicted-events', async (req: any, res) => {
  const horizon = Math.min(90, Math.max(7, parseInt(String(req.query.horizon ?? '30'), 10))) as 7 | 30 | 90;
  const sb = getServiceSupabaseClient();
  const { data: campaign } = await sb
    .from('apma_campaigns')
    .select('*, apma_clients!apma_campaigns_client_id_fkey(*)')
    .eq('client_id', req.apmaClientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!campaign) return res.json({ events: [], horizon });
  try {
    const client = campaign.apma_clients;
    const events = await apmaDecisionService.predictUpcomingEvents(client, campaign, horizon);
    res.json({ events, campaign_id: campaign.id, horizon });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OAuth start — client initiates platform OAuth flow ───────────────────
apmaClientRouter.post('/oauth/start/:platform', apmaClientAuth, async (req: any, res) => {
  const { platform } = req.params;
  const clientId: string = req.apmaClientId;

  const base = (process.env.PUBLIC_BASE_URL ?? 'https://api.adroomai.com').replace(/\/+$/, '');
  const redir = (p: string) => `${base}/api/apma/oauth/callback/${p}`;

  const stateId = crypto.randomBytes(20).toString('hex');
  let authUrl: string;
  let codeVerifier: string | undefined;

  switch (platform) {
    case 'facebook':
    case 'instagram': {
      const FB_APP_ID = process.env.FB_APP_ID;
      if (!FB_APP_ID) return res.status(500).json({ error: 'Facebook App ID not configured on server. Set FB_APP_ID.' });
      const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish,public_profile';
      authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(redir('facebook'))}&scope=${encodeURIComponent(scope)}&state=${stateId}&response_type=code`;
      break;
    }
    case 'twitter': {
      const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
      if (!TWITTER_CLIENT_ID) return res.status(500).json({ error: 'Twitter Client ID not configured on server. Set TWITTER_CLIENT_ID.' });
      codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const scope = 'tweet.read tweet.write users.read offline.access';
      authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${TWITTER_CLIENT_ID}&redirect_uri=${encodeURIComponent(redir('twitter'))}&scope=${encodeURIComponent(scope)}&state=${stateId}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
      break;
    }
    case 'linkedin': {
      const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
      if (!LINKEDIN_CLIENT_ID) return res.status(500).json({ error: 'LinkedIn Client ID not configured on server. Set LINKEDIN_CLIENT_ID.' });
      const scope = 'r_liteprofile r_emailaddress w_member_social';
      authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(redir('linkedin'))}&scope=${encodeURIComponent(scope)}&state=${stateId}`;
      break;
    }
    case 'reddit': {
      const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
      if (!REDDIT_CLIENT_ID) return res.status(500).json({ error: 'Reddit Client ID not configured on server. Set REDDIT_CLIENT_ID.' });
      const scope = 'submit identity';
      authUrl = `https://www.reddit.com/api/v1/authorize?client_id=${REDDIT_CLIENT_ID}&response_type=code&state=${stateId}&redirect_uri=${encodeURIComponent(redir('reddit'))}&duration=permanent&scope=${encodeURIComponent(scope)}`;
      break;
    }
    default:
      return res.status(400).json({ error: `OAuth is not available for ${platform}. Use manual token setup.` });
  }

  apmaOAuthStates.set(stateId, {
    clientId,
    platform,
    status: 'pending',
    codeVerifier,
    expiresAt: Date.now() + 10 * 60_000,
  });

  res.json({ authUrl, stateId });
});

// ─── OAuth poll — desktop polls to check if OAuth completed ──────────────
apmaClientRouter.get('/oauth/poll/:stateId', apmaClientAuth, async (req: any, res) => {
  const { stateId } = req.params;
  const clientId: string = req.apmaClientId;

  const st = apmaOAuthStates.get(stateId);
  if (!st) return res.json({ status: 'expired', error: 'OAuth session expired or not found. Please start again.' });
  if (st.clientId !== clientId) return res.status(403).json({ error: 'Forbidden' });

  if (st.status === 'pending') return res.json({ status: 'pending' });

  if (st.status === 'error') {
    apmaOAuthStates.delete(stateId);
    return res.json({ status: 'error', error: st.error });
  }

  const sb = getServiceSupabaseClient();
  const { data: accounts } = await sb
    .from('apma_social_accounts')
    .select('id, platform, account_type, account_name, active, last_used_at, usage_count, phone_number, created_at')
    .in('id', st.accountIds ?? []);

  apmaOAuthStates.delete(stateId);
  return res.json({ status: 'completed', accounts: accounts ?? [] });
});
