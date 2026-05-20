import { Router } from 'express';
import crypto from 'crypto';
import { getServiceSupabaseClient } from '../config/supabase';
import { apmaOrchestrator } from './apmaOrchestrator';
import { apmaHumanizerService } from './apmaHumanizerService';
import { apmaPerceptionService } from './apmaPerceptionService';
import { apmaDecisionService } from './apmaDecisionService';

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
  await apmaHumanizerService.seedPersonas(data.id).catch(() => {});
  res.json({ client: data, api_key: apiKey, message: 'Store the API key securely — it will not be shown again.' });
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

// ─── Create campaign for client ───────────────────────────────────────────
apmaAdminRouter.post('/clients/:clientId/campaigns', async (req, res) => {
  const { clientId } = req.params;
  const { name, goal, platforms, keywords, target_score, end_date } = req.body;
  if (!name || !keywords?.length) return res.status(400).json({ error: 'name and keywords required' });
  const sb = getServiceSupabaseClient();
  const { data: client } = await sb.from('apma_clients').select('goal').eq('id', clientId).single();
  const { data, error } = await sb.from('apma_campaigns').insert({
    client_id: clientId,
    name,
    goal: goal || client?.goal || 'improve',
    platforms: platforms || ['twitter', 'facebook', 'reddit'],
    keywords,
    narrative_score_target: target_score ?? 0.6,
    end_date: end_date ?? null,
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
