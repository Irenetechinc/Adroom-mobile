import express, { type Request } from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import dotenv from 'dotenv';
import { EngagementService } from './services/engagement';
import { CreativeService } from './services/creativeService';
import { getSupabaseClient, getServiceSupabaseClient, getAnonSupabaseClient } from './config/supabase';
import {
  sendSignupConfirmationEmail,
  sendPasswordResetEmail,
} from './services/resendEmailService';
import { MemoryRetriever, type MemoryContext } from './services/memoryRetriever';
import { DecisionEngine, type AIStrategy } from './services/decisionEngine';
import { AIEngine } from './config/ai-models';
import { ScraperService } from './services/scraperService';
import { AgentOrchestrator } from './agents/agentOrchestrator';
import { SchedulerService } from './services/scheduler';
import { energyService, PLANS, TOPUP_PACKS } from './services/energyService';
import { flutterwaveService } from './services/flutterwaveService';
import { pushService } from './services/pushService';
import { energyCheck, deductEnergyForUser } from './services/energyMiddleware';
import { checkFeatureAccess, getSubscriptionGuard, SUBSCRIPTION_PLAN_LIMITS } from './services/subscriptionGuard';
import adminRouter from './admin/adminRouter';
import authPagesRouter from './auth/authPagesRouter';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

/**
 * Build the public, externally-reachable base URL of the backend.
 * Used to point Resend email `redirectTo` URLs at our own /auth/* HTML pages
 * (which work in any browser) instead of the `adroom://` deep links (which
 * only work inside an installed mobile app).
 *
 * Order of precedence:
 *   1. PUBLIC_BASE_URL env var (set this on Railway to your custom domain)
 *   2. Inferred from the incoming request (works behind Railway's proxy)
 */
function getPublicBaseUrl(req: Request): string {
  const fromEnv = process.env.PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}`;
}

// Behind Railway's load balancer / Replit proxy, trust the X-Forwarded-* hop
// so req.protocol returns the public scheme (https) instead of the internal
// http used between the proxy and our process.
app.set('trust proxy', true);
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;

const scraperService = new ScraperService();
const creativeService = new CreativeService();
const decisionEngine = new DecisionEngine();

if (!VERIFY_TOKEN) {
  console.warn('[Server] WARNING: FB_VERIFY_TOKEN not set — Facebook webhook verification disabled.');
}

type OAuthPlatform = 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'tiktok' | 'whatsapp';
function buildDeepLink(platform: OAuthPlatform, query: Record<string, string | undefined>) {
  const url = new URL(`adroom://auth/${platform}/callback`);
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string' && v.length > 0) url.searchParams.set(k, v);
  }
  return url.toString();
}

// Middleware to parse JSON bodies
app.use(bodyParser.json({ limit: '10mb' }));

// Admin panel
app.use('/admin', adminRouter);

// Public auth pages opened from Resend email links (signup verified +
// password reset form). Mounted before the /api routes so they're reachable
// in a browser without an Authorization header.
app.use(authPagesRouter);

// Root endpoint
app.get('/', (_req, res) => {
  res.send('AdRoom Backend is running.');
});

/**
 * GET /api/app/version — public version + changelog feed used by the mobile
 * app on launch. Drives the "What's New" modal and the force-update gate.
 *
 * Query params:
 *   platform — 'android' | 'ios' (defaults to 'android')
 *   current  — installed app version, e.g. '2.2.7'
 *
 * No auth: must work before sign-in and on the very first launch.
 */
function semverCompareInt(a: string, b: string): number {
  const parse = (v: string) => {
    const core = (v || '0.0.0').split('-')[0].split('+')[0];
    const p = core.split('.').map((n) => parseInt(n, 10));
    return [p[0] || 0, p[1] || 0, p[2] || 0];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

app.get('/api/app/version', async (req, res) => {
  try {
    const platformRaw = String(req.query.platform || 'android').toLowerCase();
    const platform = platformRaw === 'ios' ? 'ios' : 'android';
    const current = String(req.query.current || '0.0.0');

    const svc = getServiceSupabaseClient();
    const { data: rows, error } = await svc
      .from('app_releases')
      .select('platform, version, is_min_supported, force_update, store_url, changelog_md, released_at')
      .in('platform', ['all', platform])
      .eq('is_published', true)
      .order('released_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[AppVersion] Supabase error:', error.message);
      // Fail open: never brick the app on a query error.
      return res.json({
        currentVersion: current,
        latestVersion: null,
        minSupportedVersion: null,
        storeUrl: null,
        updateAvailable: false,
        forceUpdate: false,
        changelog: [],
      });
    }

    const releases = (rows ?? []).slice().sort((a, b) =>
      semverCompareInt(b.version, a.version),
    );
    const latest = releases[0];
    const minSupported = releases
      .filter((r) => r.is_min_supported)
      .sort((a, b) => semverCompareInt(b.version, a.version))[0];

    const updateAvailable = latest
      ? semverCompareInt(current, latest.version) < 0
      : false;
    const belowMin = minSupported
      ? semverCompareInt(current, minSupported.version) < 0
      : false;
    // A release row can also force the update directly (e.g. a hotfix).
    const exactRowForcesUpdate = releases.some(
      (r) => r.force_update && semverCompareInt(r.version, current) > 0,
    );
    const forceUpdate = belowMin || exactRowForcesUpdate;

    res.json({
      currentVersion: current,
      latestVersion: latest?.version ?? null,
      minSupportedVersion: minSupported?.version ?? null,
      storeUrl: latest?.store_url ?? null,
      updateAvailable,
      forceUpdate,
      changelog: releases.map((r) => ({
        version: r.version,
        releasedAt: r.released_at,
        notes: r.changelog_md ?? '',
      })),
    });
  } catch (err: any) {
    console.error('[AppVersion] Error:', err.message);
    // Fail open.
    res.json({
      currentVersion: String(req.query.current || '0.0.0'),
      latestVersion: null,
      minSupportedVersion: null,
      storeUrl: null,
      updateAvailable: false,
      forceUpdate: false,
      changelog: [],
    });
  }
});

app.get('/auth/facebook/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const error_description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
  res.redirect(buildDeepLink('facebook', { code, state, error, error_description }));
});

app.get('/auth/instagram/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const error_description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
  res.redirect(buildDeepLink('instagram', { code, state, error, error_description }));
});

app.get('/auth/twitter/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const error_description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
  res.redirect(buildDeepLink('twitter', { code, state, error, error_description }));
});

app.get('/auth/linkedin/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const error_description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
  res.redirect(buildDeepLink('linkedin', { code, state, error, error_description }));
});

app.get('/auth/tiktok/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const auth_code = typeof req.query.auth_code === 'string' ? req.query.auth_code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const error_description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
  // TikTok uses both 'code' and 'auth_code' depending on API version
  res.redirect(buildDeepLink('tiktok', { code: code || auth_code, state, error, error_description }));
});

app.get('/auth/whatsapp/callback', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  const error_description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
  res.redirect(buildDeepLink('whatsapp', { code, state, error, error_description }));
});

/**
 * POST /api/auth/whatsapp/exchange
 * Exchanges an OAuth code for a WhatsApp Business access token.
 * Uses the same Facebook OAuth infrastructure — no manual credentials needed.
 */
app.post('/api/auth/whatsapp/exchange', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
  if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri are required' });
  if (!FB_APP_ID || !FB_APP_SECRET) return res.status(500).json({ error: 'FB_APP_ID and FB_APP_SECRET are not configured' });

  try {
    const params = new URLSearchParams({
      client_id: FB_APP_ID,
      redirect_uri: redirectUri,
      client_secret: FB_APP_SECRET,
      code,
    });
    const exchangeRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`);
    const data: any = await exchangeRes.json();
    if (!exchangeRes.ok) return res.status(exchangeRes.status).json(data);
    return res.status(200).json({ access_token: data.access_token });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'WhatsApp token exchange failed' });
  }
});

/**
 * POST /api/auth/whatsapp/phone-numbers
 * Given a user access token, fetches all WhatsApp Business phone number IDs
 * associated with the authenticated user's Meta Business accounts.
 * This eliminates any manual credential entry for the user.
 */
app.post('/api/auth/whatsapp/phone-numbers', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });

  try {
    // Fetch WhatsApp Business Accounts linked to this user
    const wabaRes = await fetch(
      `https://graph.facebook.com/v18.0/me/whatsapp_business_accounts?fields=id,name&access_token=${access_token}`
    );
    const wabaData: any = await wabaRes.json();

    if (!wabaRes.ok || !wabaData.data?.length) {
      // User may not have a WABA yet — return empty so the UI can show a helpful message
      return res.status(200).json({ phone_numbers: [] });
    }

    const phoneNumbers: any[] = [];
    for (const waba of (wabaData.data as any[]).slice(0, 5)) {
      try {
        const phonesRes = await fetch(
          `https://graph.facebook.com/v18.0/${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${access_token}`
        );
        const phonesData: any = await phonesRes.json();
        if (phonesData.data) {
          for (const phone of phonesData.data as any[]) {
            phoneNumbers.push({
              id: phone.id,
              name: phone.verified_name || waba.name || 'WhatsApp Business',
              phone: phone.display_phone_number,
              waba_id: waba.id,
            });
          }
        }
      } catch { /* skip this WABA on error */ }
    }

    return res.status(200).json({ phone_numbers: phoneNumbers });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to fetch phone numbers' });
  }
});

app.post('/api/auth/facebook/exchange', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
  if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri are required' });
  if (!FB_APP_ID || !FB_APP_SECRET) return res.status(500).json({ error: 'FB_APP_ID and FB_APP_SECRET are not configured' });

  try {
    const params = new URLSearchParams({
      client_id: FB_APP_ID,
      redirect_uri: redirectUri,
      client_secret: FB_APP_SECRET,
      code,
    });
    const exchangeRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`);
    const data: any = await exchangeRes.json();
    if (!exchangeRes.ok) return res.status(exchangeRes.status).json(data);
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Facebook token exchange failed' });
  }
});

app.post('/api/auth/linkedin/exchange', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
  if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri are required' });
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.status(500).json({ error: 'LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are not configured' });
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: LINKEDIN_CLIENT_ID,
      client_secret: LINKEDIN_CLIENT_SECRET,
    });

    const exchangeRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data: any = await exchangeRes.json();
    if (!exchangeRes.ok) return res.status(exchangeRes.status).json(data);
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'LinkedIn token exchange failed' });
  }
});

app.post('/api/auth/twitter/exchange', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
  const codeVerifier = typeof req.body?.codeVerifier === 'string' ? req.body.codeVerifier : undefined;
  if (!code || !redirectUri || !codeVerifier) {
    return res.status(400).json({ error: 'code, redirectUri, and codeVerifier are required' });
  }
  if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
    return res.status(500).json({ error: 'TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET are not configured' });
  }

  try {
    const basic = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: TWITTER_CLIENT_ID,
      code_verifier: codeVerifier,
    });

    const exchangeRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    });

    const data: any = await exchangeRes.json();
    if (!exchangeRes.ok) return res.status(exchangeRes.status).json(data);
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Twitter token exchange failed' });
  }
});

app.post('/api/auth/tiktok/exchange', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined;
  if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri are required' });
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    return res.status(500).json({ error: 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are not configured on the server' });
  }
  try {
    // TikTok Login Kit (content API) token exchange
    const body = new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const exchangeRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data: any = await exchangeRes.json();
    if (!exchangeRes.ok) return res.status(exchangeRes.status).json(data);

    console.log(`[Auth] TikTok token exchanged for open_id: ${data.open_id}`);
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'TikTok token exchange failed' });
  }
});

/**
 * Platform Configs — get all connected platform statuses for the current user
 */
app.get('/api/platform-configs', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { data: configs } = await supabase
      .from('ad_configs')
      .select('platform, page_id, page_name, ad_account_id, instagram_account_id, person_urn, org_urn, open_id, updated_at')
      .eq('user_id', user.id);

    const connected: Record<string, any> = {};
    for (const c of configs || []) {
      connected[c.platform] = {
        platform: c.platform,
        page_id: c.page_id,
        page_name: c.page_name,
        ad_account_id: c.ad_account_id,
        instagram_account_id: c.instagram_account_id,
        person_urn: c.person_urn,
        org_urn: c.org_urn,
        open_id: c.open_id,
        updated_at: c.updated_at,
        connected: true,
      };
    }
    return res.status(200).json({ configs: connected });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

/**
 * Platform Configs — disconnect a platform for the current user
 */
app.delete('/api/platform-configs/:platform', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const platform = req.params.platform.toLowerCase();
    console.log(`[Auth] Disconnecting ${platform} for user ${user.id}`);

    const { error } = await supabase
      .from('ad_configs')
      .delete()
      .eq('user_id', user.id)
      .eq('platform', platform);

    if (error) return res.status(500).json({ error: error.message });

    // Realtime broadcast to admin dashboard
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('platform_disconnected', {
        userId: user.id,
        email: user.email,
        platform,
        at: new Date().toISOString(),
      });
    } catch { /* SSE optional */ }

    return res.status(200).json({ disconnected: true, platform });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

/**
 * Platform Configs — pre-flight check whether the user is allowed to connect
 * one more platform under their current plan. Returns the limit + current usage
 * so the chat agent can surface a clear upgrade prompt before invoking OAuth.
 */
app.get('/api/platform-configs/check', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const platform = String(req.query.platform || '').toLowerCase();

    const guard = await getSubscriptionGuard(user.id, supabase);
    if (!guard.allowed) {
      return res.status(200).json({
        allowed: false,
        plan: guard.plan,
        status: guard.status,
        limit: guard.limits.platforms,
        used: 0,
        reason: guard.reason || 'Your subscription is not active.',
      });
    }

    const { data: configs } = await supabase
      .from('ad_configs')
      .select('platform')
      .eq('user_id', user.id);

    const list: any[] = configs || [];
    const alreadyConnected = platform ? list.some((c) => c.platform === platform) : false;
    const used = list.length;
    const limit = guard.limits.platforms;
    // Reconnecting an already-connected platform is always allowed (it's an
    // upsert, not a new slot). New platforms must fit under the plan limit.
    const allowed = alreadyConnected || used < limit;

    return res.status(200).json({
      allowed,
      plan: guard.plan,
      status: guard.status,
      limit,
      used,
      already_connected: alreadyConnected,
      reason: allowed ? undefined :
        `Your ${guard.plan} plan allows ${limit} connected platform${limit === 1 ? '' : 's'}. You've already connected ${used}. Disconnect a platform or upgrade your plan to add more.`,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

/**
 * Platform Configs — notify the admin dashboard that the user just connected
 * a platform via the client-side OAuth flow. The actual ad_configs upsert is
 * still done client-side (RLS protected), but this lets the admin SSE stream
 * pick up the change in realtime instead of waiting for a refresh.
 */
app.post('/api/platform-configs/notify', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const platform = String(req.body?.platform || '').toLowerCase();
    const accountName = req.body?.accountName || null;
    const accountId = req.body?.accountId || null;

    if (!platform) return res.status(400).json({ error: 'platform is required' });

    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('platform_connected', {
        userId: user.id,
        email: user.email,
        platform,
        accountName,
        accountId,
        at: new Date().toISOString(),
      });
    } catch { /* SSE optional */ }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
  }
});

/**
 * GET /webhooks/whatsapp
 * Meta webhook verification handshake. Meta calls this once when you register
 * the webhook URL in the Meta App Dashboard.
 */
app.get('/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verified successfully');
    return res.status(200).send(challenge as string);
  }
  return res.status(403).send('Forbidden');
});

/**
 * POST /webhooks/whatsapp
 * Receives incoming WhatsApp messages from leads who reply to outreach.
 * Stores the message, generates a natural AI reply, and sends it back —
 * all within seconds, building a genuine professional conversation thread.
 */
app.post('/webhooks/whatsapp', async (req, res) => {
  // Always acknowledge immediately to prevent Meta retries
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of (body.entry as any[]) || []) {
      for (const change of (entry.changes as any[]) || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;

        for (const message of (value.messages as any[]) || []) {
          if (message.type !== 'text') continue;

          const fromPhone: string = message.from;
          const text: string = message.text?.body || '';
          const phoneNumberId: string = value.metadata?.phone_number_id;
          const senderName: string = value.contacts?.[0]?.profile?.name || `+${fromPhone}`;

          const serviceSupabase = getServiceSupabaseClient();

          // Find which AdRoom user owns this phone number
          const { data: cfg } = await serviceSupabase
            .from('ad_configs')
            .select('user_id, access_token, page_id, page_name')
            .eq('platform', 'whatsapp')
            .eq('page_id', phoneNumberId)
            .maybeSingle();

          if (!cfg) {
            console.log(`[WhatsApp Webhook] No user owns phone ID ${phoneNumberId} — ignoring`);
            continue;
          }

          // Look up the outreach lead this reply belongs to
          const { data: lead } = await serviceSupabase
            .from('agent_leads')
            .select('*')
            .eq('user_id', cfg.user_id)
            .eq('platform', 'whatsapp')
            .eq('platform_user_id', fromPhone)
            .maybeSingle();

          // Record the incoming message in the interactions feed
          await serviceSupabase.from('messages').insert({
            user_id: cfg.user_id,
            platform: 'whatsapp',
            sender_name: senderName,
            content: text,
            is_replied: false,
            created_at: new Date().toISOString(),
          });

          console.log(`[WhatsApp Webhook] Message from ${senderName} (${fromPhone}): "${text.slice(0, 60)}"`);

          // Build conversation context for the AI
          const conversationHistory: any[] = lead?.conversation_history || [];
          const stage: string = lead?.conversation_stage || 'intro';
          const productContext = lead?.intent_signals?.[0]?.product || '';

          const stageGuidance: Record<string, string> = {
            intro:    'This person is replying to your first message. Build genuine rapport. Ask a relevant follow-up question about their business. No pitching yet.',
            rapport:  'You have exchanged a couple of messages. You know something about their business. Show real interest. You can start to gently hint at how you might help — still no hard sell.',
            value:    'The relationship is warming up. Share one genuinely useful insight or observation about their situation. Make it feel like advice from a knowledgeable friend.',
            soft_ask: 'The rapport is established. You can naturally mention your product or service as a solution to their specific situation. Keep it conversational and low-pressure.',
          };

          const systemPrompt = `You are a professional consultant named ${cfg.page_name || 'Alex'} having a genuine business conversation on WhatsApp. You reached out to this person because you saw an opportunity to help their business. You are warm, smart, and helpful.

CRITICAL RULES:
- You are a human professional. NEVER reference AI, bots, automation, or algorithms under any circumstances.
- Keep messages short: 2-3 sentences maximum. WhatsApp is casual.
- Be direct and natural. Sound like a real person texting.
- Address their exact message specifically — do not give generic responses.
- Never use bullet points or numbered lists. This is a text conversation.
- Do not use emojis unless they use them first.
${productContext ? `- Context: You can help with ${productContext}` : ''}

CURRENT STAGE: ${stageGuidance[stage] || stageGuidance.intro}`;

          const historyText = conversationHistory.slice(-8)
            .map((m: any) => `${m.role === 'user' ? senderName : 'You'}: ${m.content}`)
            .join('\n');

          const fullPrompt = historyText
            ? `${historyText}\n${senderName}: ${text}\n\nWrite only your reply:`
            : `${senderName}: ${text}\n\nWrite only your reply:`;

          const { AIEngine: AIEng } = await import('./config/ai-models');
          const ai = AIEng.getInstance();
          const reply = (await ai.generateText(systemPrompt + '\n\n' + fullPrompt)).trim();

          if (!reply) continue;

          // Send the reply via WhatsApp Cloud API
          const sendRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.access_token}` },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: fromPhone,
              type: 'text',
              text: { body: reply },
            }),
          });

          if (sendRes.ok) {
            console.log(`[WhatsApp Webhook] Replied to ${senderName}: "${reply.slice(0, 60)}"`);

            // Update the message record with the reply
            await serviceSupabase
              .from('messages')
              .update({ is_replied: true, reply_content: reply })
              .eq('user_id', cfg.user_id)
              .eq('platform', 'whatsapp')
              .eq('sender_name', senderName)
              .eq('content', text);

            // Advance conversation stage
            const stageProgression: Record<string, string> = {
              intro: 'rapport', rapport: 'value', value: 'soft_ask', soft_ask: 'soft_ask',
            };
            const nextStage = stageProgression[stage] || 'soft_ask';

            const updatedHistory = [
              ...conversationHistory,
              { role: 'user', content: text, at: new Date().toISOString() },
              { role: 'assistant', content: reply, at: new Date().toISOString() },
            ];

            if (lead) {
              await serviceSupabase
                .from('agent_leads')
                .update({
                  conversation_history: updatedHistory,
                  conversation_stage: nextStage,
                  last_contacted_at: new Date().toISOString(),
                })
                .eq('id', lead.id);
            }
          } else {
            const errData: any = await sendRes.json().catch(() => ({}));
            console.error(`[WhatsApp Webhook] Send failed for ${fromPhone}:`, errData?.error?.message);
          }
        }
      }
    }
  } catch (e: any) {
    console.error('[WhatsApp Webhook] Error:', e.message);
  }
});

/**
 * POST /api/oauth/whatsapp/connect
 * Connects a WhatsApp Business Cloud API account.
 * Body: { phone_number_id, access_token, business_name? }
 * Stores in ad_configs table as platform = 'whatsapp'.
 */
app.post('/api/oauth/whatsapp/connect', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { phone_number_id, access_token, business_name } = req.body;
    if (!phone_number_id || !access_token) {
      return res.status(400).json({ error: 'phone_number_id and access_token are required.' });
    }

    // Verify the credentials work by fetching the phone number profile
    let displayName = business_name || 'WhatsApp Business';
    try {
      const verifyRes = await fetch(
        `https://graph.facebook.com/v19.0/${phone_number_id}?fields=display_phone_number,verified_name&access_token=${access_token}`
      );
      if (verifyRes.ok) {
        const data: any = await verifyRes.json();
        if (data.verified_name) displayName = data.verified_name;
      }
    } catch { /* verification optional — still store if verify fails */ }

    // Upsert into ad_configs
    const { error } = await supabase.from('ad_configs').upsert({
      user_id: user.id,
      platform: 'whatsapp',
      access_token,
      page_id: phone_number_id,
      page_name: displayName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });

    if (error) return res.status(500).json({ error: error.message });

    // Notify admin dashboard
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('platform_connected', {
        userId: user.id,
        email: user.email,
        platform: 'whatsapp',
        accountName: displayName,
        accountId: phone_number_id,
        at: new Date().toISOString(),
      });
    } catch { /* SSE optional */ }

    console.log(`[WhatsApp] Connected for user ${user.id}: ${displayName} (${phone_number_id})`);
    return res.status(200).json({ ok: true, display_name: displayName, phone_number_id });
  } catch (e: any) {
    console.error('[WhatsApp] Connect error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/oauth/whatsapp/send
 * Sends a WhatsApp message using the Cloud API (requires connected account).
 * Body: { to, message }
 */
app.post('/api/oauth/whatsapp/send', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message are required.' });

    const { data: cfg } = await supabase
      .from('ad_configs')
      .select('page_id, access_token')
      .eq('user_id', user.id)
      .eq('platform', 'whatsapp')
      .single();

    if (!cfg) return res.status(400).json({ error: 'WhatsApp Business account not connected.' });

    const phone = to.replace(/\D/g, '');
    const sendRes = await fetch(`https://graph.facebook.com/v19.0/${cfg.page_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.access_token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message },
      }),
    });

    const data: any = await sendRes.json();
    if (!sendRes.ok) return res.status(500).json({ error: data.error?.message || 'WhatsApp send failed.' });

    return res.status(200).json({ ok: true, message_id: data.messages?.[0]?.id });
  } catch (e: any) {
    console.error('[WhatsApp] Send error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Scrape Website for Products — Pro/Pro+ only
 */
app.post('/api/scrape', async (req, res) => {
    const { url } = req.body;
    const authHeader = req.headers.authorization;

    if (!url) return res.status(400).json({ error: 'URL is required.' });
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized.' });

    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Invalid session.' });

        // Enforce subscription: only Pro/Pro+ can scrape websites
        const access = await checkFeatureAccess(user.id, 'websiteScraping', supabase);
        if (!access.allowed) {
            return res.status(403).json({
                error: 'PLAN_LIMIT_EXCEEDED',
                feature: 'websiteScraping',
                plan: access.plan,
                message: access.reason ?? 'Website scraping requires a Pro or Pro+ subscription.',
            });
        }

        // Enforce per-plan website connection limits (Pro: 1, Pro+: 2)
        const svc = getServiceSupabaseClient();
        const guard = await getSubscriptionGuard(user.id, svc as any);
        const maxWebsites = guard.limits.maxWebsites ?? 0;
        if (maxWebsites > 0) {
            const { count: websiteCount } = await svc
                .from('product_memory')
                .select('product_id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .not('website_url', 'is', null);
            const currentCount = websiteCount ?? 0;
            if (currentCount >= maxWebsites) {
                return res.status(403).json({
                    error: 'WEBSITE_LIMIT_REACHED',
                    plan: guard.plan,
                    current: currentCount,
                    max: maxWebsites,
                    message: `Your ${guard.plan === 'pro' ? 'Pro' : 'Pro+'} plan allows up to ${maxWebsites} connected website${maxWebsites > 1 ? 's' : ''}. Disconnect an existing website first, or upgrade your plan.`,
                });
            }
        }

        const products = await scraperService.scrapeWebsite(url, user.id);
        res.status(200).json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Generate Professional Image — Pro/Pro+ only, subject to per-period limit
 */
app.post('/api/creative/image', async (req, res) => {
    const { baseImageUri, productDetails } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized.' });

    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Invalid session.' });

        // Enforce subscription: check image asset limit for this billing period
        const access = await checkFeatureAccess(user.id, 'image_asset', supabase);
        if (!access.allowed) {
            return res.status(403).json({
                error: 'PLAN_LIMIT_EXCEEDED',
                feature: 'image_asset',
                plan: access.plan,
                message: access.reason ?? 'Image generation limit reached for your plan.',
                remaining: access.remaining ?? 0,
            });
        }

        const imageUrl = await creativeService.generateProfessionalImage(baseImageUri, productDetails);

        // Deduct energy and record usage for limit tracking
        await deductEnergyForUser(user.id, 'generate_image', { feature: 'image_asset' });

        res.status(200).json({ url: imageUrl, remaining: (access.remaining ?? 1) - 1 });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Generate AI Video Asset — Pro: 2/period, Pro+: 4/period, Starter: blocked
 */
app.post('/api/creative/generate-video-asset', async (req, res) => {
    const { productName, prompt } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized.' });
    if (!productName) return res.status(400).json({ error: 'productName is required.' });

    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Invalid session.' });

        // Enforce subscription: check video asset limit for this billing period
        const access = await checkFeatureAccess(user.id, 'video_asset', supabase);
        if (!access.allowed) {
            return res.status(403).json({
                error: 'PLAN_LIMIT_EXCEEDED',
                feature: 'video_asset',
                plan: access.plan,
                message: access.reason ?? 'Video generation limit reached for your plan.',
                remaining: access.remaining ?? 0,
            });
        }

        // Check energy before generating
        const energyResult = await energyService.checkEnergy(user.id, 'generate_video_asset');
        if (!energyResult.allowed) {
            return res.status(402).json({
                error: 'INSUFFICIENT_ENERGY',
                message: `Video generation requires ${energyResult.required} energy credits. Current balance: ${energyResult.balance.toFixed(2)}.`,
                balance: energyResult.balance,
                required: energyResult.required,
            });
        }

        const videoUrl = await creativeService.generateVideoAsset(
            { name: productName, description: prompt ?? `Compelling marketing video for ${productName}` },
            'general',
        );

        // Deduct energy and record usage for limit tracking
        await deductEnergyForUser(user.id, 'generate_video_asset', { feature: 'video_asset' });

        console.log(`[VideoAsset] Generated for user ${user.id} (${access.plan} plan). Remaining this period: ${(access.remaining ?? 1) - 1}`);

        res.status(200).json({ url: videoUrl, remaining: (access.remaining ?? 1) - 1 });
    } catch (error: any) {
        console.error('[VideoAsset] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Scan Product Image via Gemini Vision
 */
app.post('/api/ai/scan-product', async (req, res) => {
  const { imageBase64 } = req.body;
  const authHeader = req.headers.authorization;

  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required.' });
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized.' });

  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Invalid session.' });

    const aiEngine = AIEngine.getInstance();
    const scanPrompt = `Analyze this product image in extreme detail. Extract every possible piece of information. Return ONLY a valid JSON object (no markdown, no code blocks) with these exact fields:
{
  "product_name": "name of product",
  "product_type": "type of product",
  "brand": "brand name or null",
  "color": "primary color",
  "visible_features": ["feature1","feature2"],
  "estimated_size": "size if visible",
  "category": "product category",
  "material": "material if apparent",
  "condition": "new/used",
  "packaging": "packaging description",
  "text_detected": "any text visible",
  "suggested_target_audience": "who would buy this",
  "suggested_price_range": "price range estimate",
  "quality_score": 8,
  "description": "detailed product description"
}`;

    // CMA pre-flight: check tier, cap, cooldown, and route to best model
    const { creditManagementAgent: cmaAgent } = await import('./services/creditManagementAgent');
    const cmaScan = await cmaAgent.evaluate(user.id, 'scan_product');
    if (cmaScan.decision === 'deny_tier') {
      return res.status(403).json({ error: 'PLAN_REQUIRED', message: cmaScan.reason });
    }
    if (cmaScan.decision === 'deny_cap') {
      return res.status(429).json({ error: 'DAILY_CAP_REACHED', message: cmaScan.reason });
    }
    if (cmaScan.decision === 'deny_cooldown') {
      return res.status(429).json({ error: 'COOLDOWN_ACTIVE', message: cmaScan.reason });
    }
    const scanEnergyCheck = await energyService.checkEnergy(user.id, 'scan_product');
    if (scanEnergyCheck.balance < cmaScan.credits) {
      return res.status(402).json({
        error: 'INSUFFICIENT_ENERGY',
        message: `Product scan requires ${cmaScan.credits} credits. Current balance: ${scanEnergyCheck.balance.toFixed(2)}.`,
        balance: scanEnergyCheck.balance, required: cmaScan.credits,
      });
    }

    const result = await aiEngine.analyzeImage(imageBase64, scanPrompt);
    // Deduct energy after successful call (CMA-routed cost)
    await deductEnergyForUser(user.id, 'scan_product', { cma_model: cmaScan.model });

    if (result.parsedJson) {
      return res.status(200).json(result.parsedJson);
    }

    // Try to manually parse if the AI returned JSON without code blocks
    try {
      const cleaned = result.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      return res.status(200).json(JSON.parse(cleaned));
    } catch {
      return res.status(200).json({ product_name: 'Unknown Product', description: result.text, quality_score: 5 });
    }
  } catch (error: any) {
    console.error('Scan Product Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate Strategy — full intelligence pipeline with step-by-step logging
 */
app.post('/api/ai/generate-strategy', async (req, res) => {
    const { productId, goal, duration } = req.body;
    const ts = () => new Date().toISOString();
    console.log(`\n[Strategy] ═══════════════════════════════════════`);
    console.log(`[Strategy] [${ts()}] NEW STRATEGY GENERATION REQUEST`);
    console.log(`[Strategy] Product: ${productId} | Goal: ${goal} | Duration: ${duration} days`);
    try {
        const supabase = getSupabaseClient(req as any);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        console.log(`[Strategy] [${ts()}] STEP 1 — Authenticated user: ${user.id}`);
        console.log(`[Strategy] [${ts()}] STEP 2 — Retrieving memory context from all intelligence tables...`);

        // CMA pre-flight: picks model based on tier and checks cap/cooldown
        const { creditManagementAgent: cmaAgent } = await import('./services/creditManagementAgent');
        const cmaResult = await cmaAgent.evaluate(user.id, 'generate_strategy');

        if (cmaResult.decision === 'deny_tier') {
          return res.status(403).json({ error: 'PLAN_REQUIRED', message: cmaResult.reason });
        }
        if (cmaResult.decision === 'deny_cap') {
          return res.status(429).json({ error: 'DAILY_CAP_REACHED', message: cmaResult.reason });
        }
        if (cmaResult.decision === 'deny_cooldown') {
          return res.status(429).json({ error: 'COOLDOWN_ACTIVE', message: cmaResult.reason });
        }

        // Balance check using CMA-determined cost (may be cheaper)
        const energyCheck2 = await energyService.checkEnergy(user.id, 'generate_strategy');
        if (energyCheck2.balance < cmaResult.credits) {
          return res.status(402).json({
            error: 'INSUFFICIENT_ENERGY',
            message: `Strategy generation requires ${cmaResult.credits} credits. Current balance: ${energyCheck2.balance.toFixed(2)}.`,
            balance: energyCheck2.balance, required: cmaResult.credits,
          });
        }

        const economyMode = cmaResult.decision === 'allow_economy';
        const retriever = new MemoryRetriever(supabase);
        const context = await retriever.getAllContext(user.id, productId, 'product');

        console.log(`[Strategy] [${ts()}] STEP 3 — Memory context assembled:`);
        console.log(`[Strategy]   Platform Intelligence: ${context.platformIntelligence?.length || 0} signals`);
        console.log(`[Strategy]   Social Listening: ${context.socialListening?.length || 0} conversations`);
        console.log(`[Strategy]   Emotional Intelligence: ${context.emotionalIntelligence?.length || 0} entries`);
        console.log(`[Strategy]   GEO Narrative: ${context.geoNarrative?.length || 0} snapshots`);
        console.log(`[Strategy]   Strategy History: ${context.history?.length || 0} past strategies`);
        const modelLabel = economyMode ? 'Gemini Flash (economy)' : 'GPT-4o (premium)';
        console.log(`[Strategy] [${ts()}] STEP 4 — Passing context to DecisionEngine [${modelLabel}]...`);
        if (cmaResult.savedCredits > 0) {
          console.log(`[CMA] Economy routing: saved ${cmaResult.savedCredits} credits for this user`);
        }

        const strategy = await decisionEngine.generateStrategy(context, goal, duration, economyMode);

        console.log(`[Strategy] [${ts()}] STEP 5 — Strategy generated successfully`);
        console.log(`[Strategy]   Title: ${strategy.title}`);
        console.log(`[Strategy]   Platforms: ${JSON.stringify(strategy.platforms)}`);
        console.log(`[Strategy]   Est. Reach: ${strategy.estimated_outcomes?.reach || 'N/A'}`);
        console.log(`[Strategy] [${ts()}] STEP 6 — Saving strategy to Supabase...`);

        const { data: savedStrategy, error: saveErr } = await supabase.from('strategies').insert({
            user_id: user.id,
            product_id: productId,
            goal,
            duration,
            title: strategy.title,
            rationale: strategy.rationale,
            platforms: strategy.platforms,
            content_pillars: strategy.content_pillars,
            schedule: strategy.schedule,
            estimated_outcomes: strategy.estimated_outcomes,
            status: 'approved',
            created_at: new Date().toISOString(),
        }).select().single();

        if (saveErr) {
            console.warn(`[Strategy] [${ts()}] Save warning: ${saveErr.message}`);
        } else {
            console.log(`[Strategy] [${ts()}] STEP 7 — Strategy saved with ID: ${savedStrategy?.id}`);
        }

        // Deduct energy after successful generation (CMA-routed — uses economy cost if applicable)
        await deductEnergyForUser(user.id, 'generate_strategy', { economy_mode: economyMode });

        // Generate 7-day content preview asynchronously (lightweight — text only, no images)
        let weekPreview: any[] = [];
        try {
            const previewPrompt = `
You are AdRoom AI. Based on this marketing strategy, generate a concrete 7-day content preview.
Show EXACTLY what will be posted on each of the first 7 days.

STRATEGY:
Title: ${strategy.title}
Goal: ${goal}
Platforms: ${JSON.stringify(strategy.platforms)}
Content Pillars: ${JSON.stringify(strategy.content_pillars)}
Rationale: ${strategy.rationale}
Campaign Duration: ${duration} days

Generate 7 days of preview content. Assign 1 post per day, rotating through platforms.
For TikTok days, include a video script preview.
Make the content feel REAL and ready-to-post.

OUTPUT JSON:
{
  "days": [
    {
      "day": 1,
      "platform": "instagram",
      "task_type": "REEL",
      "headline": "Attention-grabbing headline",
      "body": "Full caption text, 2-4 sentences, ready to post. Include relevant details about the product/service.",
      "hashtags": ["tag1", "tag2", "tag3"],
      "hook": "First 3 seconds hook (for video/reel content)",
      "tiktok_script": null
    }
  ]
}
For any TikTok day, set tiktok_script to:
{
  "hook": "Opening hook text",
  "scene_1": "What to show in first 5 seconds",
  "scene_2": "Middle section content",
  "cta": "Call to action"
}
`;
            const { AIEngine: AIEngineForPreview } = await import('./config/ai-models');
            const aiForPreview = AIEngineForPreview.getInstance();
            const previewResult = await aiForPreview.generateStrategy({}, previewPrompt);
            weekPreview = previewResult.parsedJson?.days || [];
        } catch (previewErr: any) {
            console.warn(`[Strategy] Week preview generation failed (non-fatal): ${previewErr.message}`);
        }

        console.log(`[Strategy] ═══════════════════════════════════════\n`);
        res.status(200).json({ strategy: { ...strategy, week_preview: weekPreview }, strategyId: savedStrategy?.id });
    } catch (error: any) {
        console.error(`[Strategy] [${ts()}] FATAL ERROR:`, error.message);
        console.log(`[Strategy] ═══════════════════════════════════════\n`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Activate Goal Agents — full autonomous campaign execution begins after user approves strategy
 */
app.post('/api/ai/activate-agents', async (req, res) => {
    const { strategyId, goal, platforms, videoUrl } = req.body;
    const ts = () => new Date().toISOString();
    console.log(`\n[AgentActivation] ═══════════════════════════════════════`);
    console.log(`[AgentActivation] [${ts()}] ACTIVATING AUTONOMOUS AGENT`);
    console.log(`[AgentActivation] Strategy: ${strategyId} | Goal: ${goal} | Platforms: ${JSON.stringify(platforms)}`);

    if (!strategyId || !goal) {
        return res.status(400).json({ error: 'strategyId and goal are required' });
    }

    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        // CMA pre-flight: check tier, daily cap, cooldown, and pick model
        const { creditManagementAgent: cmaActivate } = await import('./services/creditManagementAgent');
        const cmaActivateResult = await cmaActivate.evaluate(user.id, 'activate_agents');
        if (cmaActivateResult.decision === 'deny_tier') {
          return res.status(403).json({ error: 'PLAN_REQUIRED', message: cmaActivateResult.reason });
        }
        if (cmaActivateResult.decision === 'deny_cap') {
          return res.status(429).json({ error: 'DAILY_CAP_REACHED', message: cmaActivateResult.reason });
        }
        if (cmaActivateResult.decision === 'deny_cooldown') {
          return res.status(429).json({ error: 'COOLDOWN_ACTIVE', message: cmaActivateResult.reason });
        }

        // Balance check using CMA-determined cost
        const agentEnergyCheck = await energyService.checkEnergy(user.id, 'activate_agents');
        if (agentEnergyCheck.balance < cmaActivateResult.credits) {
          return res.status(402).json({
            error: 'INSUFFICIENT_ENERGY',
            message: `Agent activation requires ${cmaActivateResult.credits} credits. Current balance: ${agentEnergyCheck.balance.toFixed(2)}.`,
            balance: agentEnergyCheck.balance, required: cmaActivateResult.credits,
          });
        }

        // Check subscription plan limits for agents and platforms
        const subGuard = await getSubscriptionGuard(user.id, supabase);
        if (!subGuard.allowed) {
          return res.status(403).json({
            error: 'PLAN_LIMIT_EXCEEDED',
            message: 'An active subscription is required to activate autonomous agents.',
          });
        }

        const planLimits = subGuard.limits;

        // Enforce: Sales agent requires Pro/Pro+
        if (goal?.toLowerCase().includes('sales') || goal?.toLowerCase().includes('lead')) {
          if (!planLimits.agents.sales) {
            return res.status(403).json({
              error: 'PLAN_LIMIT_EXCEEDED',
              feature: 'sales_agent',
              plan: subGuard.plan,
              message: `The Sales Agent is not available on the ${subGuard.plan} plan. Upgrade to Pro or Pro+ to use the Sales Agent.`,
            });
          }
        }

        // Enforce: platform count limit
        const requestedPlatforms: string[] = platforms || [];
        if (requestedPlatforms.length > planLimits.platforms) {
          return res.status(403).json({
            error: 'PLAN_LIMIT_EXCEEDED',
            feature: 'platforms',
            plan: subGuard.plan,
            message: `Your ${subGuard.plan} plan allows autonomous posting on ${planLimits.platforms} platform${planLimits.platforms === 1 ? '' : 's'}. You requested ${requestedPlatforms.length}. Upgrade your plan to add more platforms.`,
            allowed_platforms: planLimits.platforms,
            requested_platforms: requestedPlatforms.length,
          });
        }

        const { data: strategy } = await supabase
            .from('strategies')
            .select('*')
            .eq('id', strategyId)
            .single();

        const activeStrategy = strategy || { id: strategyId, goal, platforms, user_id: user.id, duration: 30 };
        const activePlatforms = (platforms || strategy?.platforms || ['facebook']).slice(0, planLimits.platforms);

        // Store user-supplied video URL in strategy so agents can retrieve it at execution time
        if (videoUrl) {
            await supabase.from('strategies').update({
                current_execution_plan: {
                    ...(strategy?.current_execution_plan || {}),
                    user_video_url: videoUrl,
                }
            }).eq('id', strategyId);
            console.log(`[AgentActivation] User video URL stored for strategy ${strategyId}`);
        }

        console.log(`[AgentActivation] [${ts()}] Launching orchestrator...`);

        // Use service-level client so orchestrator can read all tables
        const orchestrator = new AgentOrchestrator();
        const result = await orchestrator.activateAgent({
            strategyId,
            userId: user.id,
            goal,
            platforms: activePlatforms,
            strategy: activeStrategy
        });

        console.log(`[AgentActivation] [${ts()}] ✓ ${result.agentType} agent active — ${result.tasksScheduled} tasks scheduled`);

        // Deduct activation credits via CMA routing
        await deductEnergyForUser(user.id, 'activate_agents', { agent_type: result.agentType, cma_economy: cmaActivateResult.decision === 'allow_economy' });

        console.log(`[AgentActivation] ═══════════════════════════════════════\n`);

        res.status(200).json({
            activated: true,
            agent_type: result.agentType,
            tasks_scheduled: result.tasksScheduled,
            activated_at: result.activatedAt,
            message: `${result.agentType} agent is running autonomously. ${result.tasksScheduled} tasks scheduled across your campaign duration.`
        });
    } catch (error: any) {
        console.error(`[AgentActivation] [${ts()}] FATAL:`, error.message);
        console.log(`[AgentActivation] ═══════════════════════════════════════\n`);
        res.status(500).json({ activated: false, error: error.message });
    }
});

/**
 * Get Agent Status — live performance, tasks, interventions
 */
app.get('/api/agents/status/:strategyId', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        const orchestrator = new AgentOrchestrator();
        const status = await orchestrator.getAgentStatus(req.params.strategyId);
        res.status(200).json(status);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Agent Tasks — get all tasks for a strategy with their current status
 */
app.get('/api/agents/tasks/:strategyId', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        const { data: tasks } = await supabase
            .from('agent_tasks')
            .select('*')
            .eq('strategy_id', req.params.strategyId)
            .eq('user_id', user.id)
            .order('scheduled_at', { ascending: true })
            .limit(100);

        res.status(200).json({ tasks: tasks || [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Agent Performance — real metrics fetched from platforms
 */
app.get('/api/agents/performance/:strategyId', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        const { data: perf } = await supabase
            .from('agent_performance')
            .select('*')
            .eq('strategy_id', req.params.strategyId)
            .eq('user_id', user.id)
            .order('fetched_at', { ascending: false })
            .limit(50);

        const totals = (perf || []).reduce((acc: any, p: any) => ({
            reach: (acc.reach || 0) + (p.reach || 0),
            likes: (acc.likes || 0) + (p.likes || 0),
            comments: (acc.comments || 0) + (p.comments || 0),
            shares: (acc.shares || 0) + (p.shares || 0),
            paid_equivalent_usd: (acc.paid_equivalent_usd || 0) + (p.paid_equivalent_usd || 0)
        }), {});

        res.status(200).json({ performance: perf || [], totals });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Agent Leads — SALESMAN agent's lead pipeline
 */
app.get('/api/agents/leads/:strategyId', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        const { data: leads } = await supabase
            .from('agent_leads')
            .select('*')
            .eq('strategy_id', req.params.strategyId)
            .eq('user_id', user.id)
            .order('intent_score', { ascending: false });

        res.status(200).json({ leads: leads || [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Agent Interventions — AI decisions the agents made autonomously
 */
app.get('/api/agents/interventions/:strategyId', async (req, res) => {
    try {
        const supabase = getSupabaseClient(req as any);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        const { data: interventions } = await supabase
            .from('agent_interventions')
            .select('*')
            .eq('strategy_id', req.params.strategyId)
            .order('created_at', { ascending: false })
            .limit(20);

        res.status(200).json({ interventions: interventions || [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/strategy/:id/stop — Stop a running strategy, disconnect website, notify user
 */
app.post('/api/strategy/:id/stop', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { id: strategyId } = req.params;
    const { reason = 'user_requested' } = req.body;
    const svc = getServiceSupabaseClient();

    const { data: strategy, error: fetchErr } = await svc
      .from('strategies')
      .select('id, title, user_id, product_id, is_active')
      .eq('id', strategyId)
      .eq('user_id', user.id)
      .single();

    if (fetchErr || !strategy) return res.status(404).json({ error: 'Strategy not found.' });

    await svc
      .from('strategies')
      .update({ is_active: false, status: 'ended', updated_at: new Date().toISOString() })
      .eq('id', strategyId)
      .eq('user_id', user.id);

    // Disconnect the website linked to this strategy's product
    if (strategy.product_id) {
      await svc
        .from('product_memory')
        .update({ website_url: null, last_scraped_at: null })
        .eq('product_id', strategy.product_id)
        .eq('user_id', user.id);
    }

    // Cancel scheduled agent tasks for this strategy
    await svc
      .from('agent_task_queue')
      .update({ status: 'cancelled' })
      .eq('strategy_id', strategyId)
      .in('status', ['pending', 'scheduled']);

    // Send push notification to user
    const { pushService: ps } = await import('./services/pushService');
    const friendlyReason = reason === 'credits_exhausted'
      ? 'Energy credits exhausted'
      : reason === 'user_requested'
      ? 'Stopped by you'
      : reason;
    await ps.notifyStrategyStopped(user.id, strategy.title || 'Your Strategy', friendlyReason);

    res.json({ success: true, strategy_id: strategyId, stopped: true, reason });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/strategy/active-websites — Count of active website-connected strategies for plan limit enforcement
 */
app.get('/api/strategy/active-websites', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const svc = getServiceSupabaseClient();
    const { count } = await svc
      .from('strategies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('status', 'active')
      .not('product_id', 'is', null);

    const { data: sub } = await svc
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', user.id)
      .single();

    const plan = sub?.plan ?? 'none';
    const isActive = sub?.status === 'active' || sub?.status === 'trialing';
    let maxWebsites = 0;
    if (isActive && plan === 'pro') maxWebsites = 1;
    if (isActive && plan === 'pro_plus') maxWebsites = 2;

    res.json({
      activeWebsites: count ?? 0,
      maxWebsites,
      plan,
      canConnect: (count ?? 0) < maxWebsites,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Facebook Webhook Verification
 */
app.get('/webhooks/facebook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

/**
 * Facebook Webhook Event Handler
 */
app.post('/webhooks/facebook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');
    try {
      await EngagementService.handleWebhookEvent(body);
    } catch (error) {
      console.error('Error processing webhook event:', error);
    }
  } else {
    res.sendStatus(404);
  }
});

/**
 * Database Trigger Handler (Supabase)
 */
app.post('/webhooks/database', async (req, res) => {
  const { type, table, record } = req.body;
  try {
    if (table === 'comments' && type === 'INSERT') {
      await EngagementService.handleDatabaseComment(record);
    } else if (table === 'messages' && type === 'INSERT') {
      await EngagementService.handleDatabaseMessage(record);
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing DB webhook:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ══════════════════════════════════════════════════════════════
// ADROOM ENERGY & BILLING ROUTES
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/billing/status — user's energy balance + subscription info
 */
app.get('/api/billing/status', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const summary = await energyService.getUsageSummary(user.id);
    res.status(200).json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/billing/plan-limits — returns user's plan feature limits + current usage
 */
app.get('/api/billing/plan-limits', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const guard = await getSubscriptionGuard(user.id, supabase);
    res.status(200).json({
      plan: guard.plan,
      status: guard.status,
      active: guard.allowed,
      limits: guard.limits,
      usage: guard.usage,
      remaining: {
        imageAssets: Math.max(0, guard.limits.imageAssets - guard.usage.imageAssets),
        videoAssets: Math.max(0, guard.limits.videoAssets - guard.usage.videoAssets),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/start-trial — grant 14-day trial (requires card on file)
 */
app.post('/api/billing/start-trial', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const result = await energyService.grantTrial(user.id);
    if (result.success) {
      // Fire-and-forget push + admin broadcast
      pushService.notifyTrialStarted(user.id, (result as any).credits ?? 50, 14).catch(() => {});
      try {
        const { adminBroadcast } = await import('./admin/adminRouter');
        adminBroadcast('trial_started', { user_id: user.id, credits: (result as any).credits ?? 50 });
      } catch { /* ignore */ }
    }
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/payment-link — generate a Flutterwave payment link
 */
app.post('/api/billing/payment-link', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { amount: rawAmount, type, id } = req.body;
    if (!rawAmount || !type || !id) return res.status(400).json({ error: 'amount, type, id required.' });

    // Ensure amount is always a positive number to avoid Flutterwave treating
    // it as a string or defaulting to a wrong currency amount.
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number.' });
    }

    const txRef = flutterwaveService.generateTxRef('ADROOM');
    const email = user.email || '';

    // Call Flutterwave API to generate a properly signed hosted payment link
    const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '';
    if (!FLW_SECRET_KEY) {
      console.error('[PaymentLink] FLW_SECRET_KEY is not set.');
      return res.status(503).json({ error: 'Payment gateway not configured. Please contact support.' });
    }
    const flwRes = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount,
        currency: 'USD',
        redirect_url: 'adroom://payment-callback',
        customer: { email, name: email },
        customizations: {
          title: type === 'subscription'
            ? `AdRoom ${PLANS[id as keyof typeof PLANS]?.name ?? id} Plan`
            : 'AdRoom Energy Top-Up',
          description: type === 'subscription'
            ? `Monthly subscription — ${id}`
            : `Energy top-up pack — ${id}`,
          logo: 'https://adroom.app/logo.png',
        },
        payment_options: 'card',
        meta: { user_id: user.id, type, plan_or_pack_id: id },
      }),
    });

    const flwData = await flwRes.json();
    if (flwData.status !== 'success' || !flwData.data?.link) {
      console.error('[PaymentLink] Flutterwave error:', JSON.stringify(flwData));
      return res.status(502).json({ error: flwData.message || 'Failed to generate payment link from Flutterwave.' });
    }

    res.status(200).json({ payment_url: flwData.data.link, tx_ref: txRef });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/verify-subscription — verify FLW payment and activate subscription
 */
app.post('/api/billing/verify-subscription', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { transaction_id, tx_ref, plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'plan_id required.' });
    if (!transaction_id && !tx_ref) return res.status(400).json({ error: 'transaction_id or tx_ref required.' });

    const plan = PLANS[plan_id as keyof typeof PLANS];
    if (!plan) return res.status(400).json({ error: `Unknown plan: ${plan_id}` });

    // Verify with Flutterwave — fall back to tx_ref lookup when transaction_id is absent
    let verification = transaction_id
      ? await flutterwaveService.verifyTransaction(transaction_id)
      : await flutterwaveService.verifyByTxRef(tx_ref);

    if (!verification) {
      return res.status(402).json({ error: 'Could not locate transaction via tx_ref.' });
    }
    if (verification.status !== 'success' || verification.data?.status !== 'successful') {
      return res.status(402).json({ error: 'Payment verification failed.', details: verification.message });
    }

    // Confirm amount matches plan
    const paidAmount = verification.data?.amount ?? 0;
    if (paidAmount < plan.price_usd) {
      return res.status(402).json({ error: `Paid amount ($${paidAmount}) is less than plan price ($${plan.price_usd}).` });
    }

    // Extract card token for future recurring charges
    const cardToken = verification.data?.card?.token;
    const cardLast4 = verification.data?.card?.last_4digits;
    const cardBrand = verification.data?.card?.type;
    const billingEmail = verification.data?.customer?.email;

    const result = await energyService.applySubscription(
      user.id, plan_id,
      String(verification.data?.id),
      tx_ref ?? '',
      cardToken, cardLast4, cardBrand, billingEmail,
    );

    // Push + admin broadcast (fire-and-forget)
    pushService.notifyPlanChanged(user.id, plan.name, (result as any).credits ?? plan.energy_credits, (result as any).newBalance ?? 0).catch(() => {});
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('subscription_activated', {
        user_id: user.id, plan_id, plan_name: plan.name, credits: plan.energy_credits, amount: paidAmount,
      });
    } catch { /* ignore */ }

    res.status(200).json({ ...result, message: `${plan.name} plan activated! ${plan.energy_credits} energy credits added.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/verify-topup — verify FLW payment and apply top-up credits
 */
app.post('/api/billing/verify-topup', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { transaction_id, tx_ref, pack_id } = req.body;
    if (!pack_id) return res.status(400).json({ error: 'pack_id required.' });
    if (!transaction_id && !tx_ref) return res.status(400).json({ error: 'transaction_id or tx_ref required.' });

    const pack = TOPUP_PACKS[pack_id as keyof typeof TOPUP_PACKS];
    if (!pack) return res.status(400).json({ error: `Unknown pack: ${pack_id}` });

    let verification = transaction_id
      ? await flutterwaveService.verifyTransaction(transaction_id)
      : await flutterwaveService.verifyByTxRef(tx_ref);

    if (!verification) {
      return res.status(402).json({ error: 'Could not locate transaction via tx_ref.' });
    }
    if (verification.status !== 'success' || verification.data?.status !== 'successful') {
      return res.status(402).json({ error: 'Payment verification failed.', details: verification.message });
    }

    const paidAmount = verification.data?.amount ?? 0;
    if (paidAmount < pack.price_usd) {
      return res.status(402).json({ error: `Paid amount ($${paidAmount}) is less than pack price ($${pack.price_usd}).` });
    }

    const result = await energyService.applyTopUp(user.id, pack_id, String(verification.data?.id), tx_ref ?? '');

    // Push + admin broadcast (fire-and-forget)
    pushService.notifyTopupSuccess(user.id, pack.label, (result as any).credits ?? pack.energy_credits, (result as any).newBalance ?? 0).catch(() => {});
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('topup_completed', {
        user_id: user.id, pack_id, pack_label: pack.label, credits: pack.energy_credits, amount: paidAmount,
      });
    } catch { /* ignore */ }

    res.status(200).json({ ...result, message: `${pack.energy_credits} energy credits added!` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/cancel-subscription
 */
app.post('/api/billing/cancel-subscription', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const result = await energyService.cancelSubscription(user.id, req.body.reason);

    // Push + admin broadcast (fire-and-forget)
    pushService.notifySubscriptionCancelled(user.id, result.access_until).catch(() => {});
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('subscription_cancelled', {
        user_id: user.id,
        cancelled_immediately: result.cancelled_immediately,
        access_until: result.access_until,
        reason: req.body.reason,
      });
    } catch { /* ignore */ }

    res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/billing/check/:operation — check if user has energy for an operation
 */
app.get('/api/billing/check/:operation', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const check = await energyService.checkEnergy(user.id, req.params.operation);
    res.status(200).json(check);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/flw-callback — Flutterwave redirect callback (handles redirect after payment)
 */
app.get('/api/billing/flw-callback', async (req, res) => {
  const { status, tx_ref, transaction_id } = req.query;
  if (status === 'successful') {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0B0F19;color:#E2E8F0">
        <h2 style="color:#00F0FF">Payment Successful!</h2>
        <p>Your AdRoom Energy has been credited.</p>
        <p style="color:#64748B">Transaction: ${transaction_id}</p>
        <p>Return to the AdRoom app to verify and activate your credits.</p>
      </body></html>
    `);
  } else {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0B0F19;color:#E2E8F0">
        <h2 style="color:#EF4444">Payment Failed</h2>
        <p>Please return to the app and try again.</p>
      </body></html>
    `);
  }
});

/**
 * POST /api/billing/charge-card — charge card details directly via Flutterwave card API.
 * User enters card details in-app; only OTP/3DS requires a redirect URL (returned as auth_url).
 */
app.post('/api/billing/charge-card', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { cardNumber, cvv, expiryMonth, expiryYear, fullname, type, id } = req.body;
    if (!cardNumber || !cvv || !expiryMonth || !expiryYear || !fullname || !type || !id) {
      return res.status(400).json({ error: 'cardNumber, cvv, expiryMonth, expiryYear, fullname, type, id required.' });
    }

    const plan = PLANS[id as keyof typeof PLANS];
    const amount = type === 'subscription' ? (plan?.price_usd ?? 0) : (id === 'starter_topup' ? 5 : id === 'boost_topup' ? 10 : 20);
    if (amount <= 0) return res.status(400).json({ error: 'Invalid plan/pack.' });

    const txRef = flutterwaveService.generateTxRef('ADROOM');
    const email = user.email || '';
    const redirectUrl = `${process.env.EXPO_PUBLIC_API_URL || 'https://adroom.railway.app'}/api/billing/flw-callback?type=${type}&id=${id}&user_id=${user.id}&tx_ref=${txRef}`;

    const chargeResult = await flutterwaveService.chargeCard({
      cardNumber, cvv, expiryMonth, expiryYear,
      email, fullname, amount,
      currency: 'USD',
      tx_ref: txRef,
      redirect_url: redirectUrl,
      enckey: process.env.FLW_ENCRYPTION_KEY || '',
    });

    if (chargeResult.status === 'success' && chargeResult.data?.status === 'successful') {
      // Payment captured immediately — no 3DS needed
      const transactionId = String(chargeResult.data.id);
      const cardLast4 = chargeResult.data.card?.last_4digits;
      const cardBrand = chargeResult.data.card?.type;
      const cardToken = chargeResult.data.card?.token;
      const svc = getServiceSupabaseClient();
      if (type === 'subscription') {
        const r = await energyService.applySubscription(user.id, id, transactionId, txRef, cardToken, cardLast4, cardBrand, email);
        const planRef = PLANS[id as keyof typeof PLANS];
        if (planRef) {
          pushService.notifyPlanChanged(user.id, planRef.name, (r as any).credits ?? planRef.energy_credits, (r as any).newBalance ?? 0).catch(() => {});
          try {
            const { adminBroadcast } = await import('./admin/adminRouter');
            adminBroadcast('subscription_activated', { user_id: user.id, plan_id: id, plan_name: planRef.name, credits: planRef.energy_credits, amount });
          } catch { /* ignore */ }
        }
      } else {
        const topupPack = TOPUP_PACKS[id as keyof typeof TOPUP_PACKS];
        if (topupPack) {
          const r = await energyService.applyTopUp(user.id, topupPack.id, transactionId, txRef);
          pushService.notifyTopupSuccess(user.id, topupPack.label, (r as any).credits ?? topupPack.energy_credits, (r as any).newBalance ?? 0).catch(() => {});
          try {
            const { adminBroadcast } = await import('./admin/adminRouter');
            adminBroadcast('topup_completed', { user_id: user.id, pack_id: topupPack.id, pack_label: topupPack.label, credits: topupPack.energy_credits, amount });
          } catch { /* ignore */ }
        }
        if (cardToken) {
          await svc.from('user_subscriptions').upsert({ user_id: user.id, flw_card_token: cardToken, flw_card_last4: cardLast4, flw_card_brand: cardBrand, billing_email: email }, { onConflict: 'user_id' });
        }
      }
      return res.json({ success: true, mode: 'success', transaction_id: transactionId });
    }

    if (chargeResult.status === 'success' && chargeResult.meta?.authorization?.mode === 'redirect') {
      return res.json({
        success: true,
        mode: 'redirect',
        auth_url: chargeResult.meta.authorization.redirect,
        tx_ref: txRef,
      });
    }

    if (chargeResult.status === 'success' && chargeResult.meta?.authorization?.mode === 'pin') {
      return res.json({ success: true, mode: 'pin', flw_ref: chargeResult.data?.flw_ref, tx_ref: txRef });
    }

    return res.status(402).json({ error: chargeResult.message || 'Card charge failed.', details: chargeResult });
  } catch (err: any) {
    console.error('[charge-card]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/billing/charge-card/validate-pin — validate OTP/PIN after pin charge
 */
app.post('/api/billing/charge-card/validate-pin', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { otp, flw_ref, type, id, tx_ref } = req.body;
    if (!otp || !flw_ref) return res.status(400).json({ error: 'otp and flw_ref required.' });

    const validationRes = await fetch('https://api.flutterwave.com/v3/validate-charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY}` },
      body: JSON.stringify({ otp, flw_ref, type: 'card' }),
    });
    const validation: any = await validationRes.json();

    if (validation.status === 'success' && validation.data?.status === 'successful') {
      const transactionId = String(validation.data.id);
      const cardLast4 = validation.data.card?.last_4digits;
      const cardBrand = validation.data.card?.type;
      const cardToken = validation.data.card?.token;
      const email = user.email || '';
      const amount = validation.data?.amount ?? 0;
      if (type === 'subscription') {
        const r = await energyService.applySubscription(user.id, id, transactionId, tx_ref, cardToken, cardLast4, cardBrand, email);
        const planRef = PLANS[id as keyof typeof PLANS];
        if (planRef) {
          pushService.notifyPlanChanged(user.id, planRef.name, (r as any).credits ?? planRef.energy_credits, (r as any).newBalance ?? 0).catch(() => {});
          try {
            const { adminBroadcast } = await import('./admin/adminRouter');
            adminBroadcast('subscription_activated', { user_id: user.id, plan_id: id, plan_name: planRef.name, credits: planRef.energy_credits, amount });
          } catch { /* ignore */ }
        }
      } else {
        const topupPack = TOPUP_PACKS[id as keyof typeof TOPUP_PACKS];
        if (topupPack) {
          const r = await energyService.applyTopUp(user.id, topupPack.id, transactionId, tx_ref);
          pushService.notifyTopupSuccess(user.id, topupPack.label, (r as any).credits ?? topupPack.energy_credits, (r as any).newBalance ?? 0).catch(() => {});
          try {
            const { adminBroadcast } = await import('./admin/adminRouter');
            adminBroadcast('topup_completed', { user_id: user.id, pack_id: topupPack.id, pack_label: topupPack.label, credits: topupPack.energy_credits, amount });
          } catch { /* ignore */ }
        }
      }
      return res.json({ success: true, transaction_id: transactionId });
    }

    return res.status(402).json({ error: validation.message || 'OTP validation failed.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/chat/history — fetch MemPalace conversation history for the current user
 * Automatically purges messages older than 7 days before returning.
 */
app.get('/api/chat/history', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const limit = parseInt(String(req.query.limit ?? '50'));
    const svc = getServiceSupabaseClient();

    // Purge messages older than 7 days (non-blocking, best-effort)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    svc.from('ai_conversation_memory')
      .delete()
      .eq('user_id', user.id)
      .lt('created_at', sevenDaysAgo)
      .then(() => {}, () => {});

    const { data, error } = await svc
      .from('ai_conversation_memory')
      .select('id, role, content, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 200));

    if (error) return res.status(500).json({ error: error.message });
    res.json({ messages: (data || []).reverse() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/history — save a message to MemPalace conversation memory
 */
app.post('/api/chat/history', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { role, content, metadata } = req.body;
    if (!role || !content) return res.status(400).json({ error: 'role and content required.' });

    const svc = getServiceSupabaseClient();
    const { error } = await svc.from('ai_conversation_memory').insert({
      user_id: user.id,
      role,
      content,
      metadata: metadata ?? {},
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/chat/history — clear all MemPalace conversation history for the current user
 */
app.delete('/api/chat/history', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const svc = getServiceSupabaseClient();
    const { error } = await svc
      .from('ai_conversation_memory')
      .delete()
      .eq('user_id', user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, cleared: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/chat/history/range — delete a single chat session worth of
 * MemPalace memory by inclusive [from, to] ISO timestamp range. Used by the
 * mobile client when the user removes one session from the History popup so
 * the agent's long-term memory of that conversation is wiped alongside the
 * `chat_history` rows the client deletes directly via Supabase.
 *
 * Body: { from: ISO string, to: ISO string }
 */
app.delete('/api/chat/history/range', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { from, to } = req.body || {};
    if (typeof from !== 'string' || typeof to !== 'string') {
      return res.status(400).json({ error: '`from` and `to` ISO timestamps required.' });
    }
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      return res.status(400).json({ error: 'Invalid `from` / `to` range.' });
    }

    const svc = getServiceSupabaseClient();
    const { error } = await svc
      .from('ai_conversation_memory')
      .delete()
      .eq('user_id', user.id)
      .gte('created_at', new Date(fromMs).toISOString())
      .lte('created_at', new Date(toMs).toISOString());

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Credit Management Agent — Stats endpoint (admin-level)
 * Returns total credits saved, USD saved, and per-operation breakdown.
 */
app.get('/api/admin/cma/stats', async (req, res) => {
  try {
    const { creditManagementAgent: cmaAgent } = await import('./services/creditManagementAgent');
    const days = parseInt(String(req.query.days ?? '7'));
    const stats = await cmaAgent.getSavingsSummary(Math.min(days, 90));
    res.json({ ok: true, ...stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Remote Logging — receives logs from the Expo app and prints them to Railway terminal
 */
app.post('/api/logs', (req, res) => {
  const { level = 'INFO', message, context, timestamp } = req.body;
  const ts = timestamp || new Date().toISOString();
  const ctx = context ? ` [${context}]` : '';
  const logLine = `[APP:${level.toUpperCase()}]${ctx} [${ts}] ${message}`;

  if (level === 'error') {
    console.error(logLine);
  } else if (level === 'warn') {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }

  res.status(200).json({ ok: true });
});

// ─── USER PROFILE & PASSWORD ──────────────────────────────────────────────────

app.put('/api/user/profile', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { display_name } = req.body;
    if (!display_name || typeof display_name !== 'string') {
      return res.status(400).json({ error: 'display_name required' });
    }
    const trimmed = display_name.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      return res.status(400).json({ error: 'display_name must be 2–50 characters' });
    }

    // Enforce 3-minute cooldown between username changes.
    const lastChangedAt = user.user_metadata?.display_name_changed_at;
    if (lastChangedAt) {
      const elapsed = Date.now() - new Date(lastChangedAt).getTime();
      const cooldownMs = 3 * 60 * 1000;
      if (elapsed < cooldownMs) {
        const remainingSecs = Math.ceil((cooldownMs - elapsed) / 1000);
        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        return res.status(429).json({
          error: `Please wait ${timeStr} before changing your username again.`,
          remaining_seconds: remainingSecs,
        });
      }
    }

    const svc = getServiceSupabaseClient();
    const { data, error } = await svc.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        full_name: trimmed,
        display_name: trimmed,
        display_name_changed_at: new Date().toISOString(),
      },
    });
    if (error) throw error;
    res.json({ success: true, display_name: trimmed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/change-password', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { new_password } = req.body;
    if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
      return res.status(400).json({ error: 'new_password must be at least 8 characters' });
    }

    const svc = getServiceSupabaseClient();
    const { error } = await svc.auth.admin.updateUserById(user.id, { password: new_password });
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/request-deletion', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { reason } = req.body;
    const svc = getServiceSupabaseClient();

    // Check for existing pending request
    const { data: existing } = await svc
      .from('account_deletion_requests')
      .select('id, status, created_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .single();

    if (existing) {
      return res.json({ success: true, already_pending: true, id: existing.id });
    }

    const { data, error } = await svc.from('account_deletion_requests').insert({
      user_id: user.id,
      user_email: user.email,
      reason: reason || null,
      status: 'pending',
    }).select('id').single();

    if (error) throw error;

    // Broadcast to admin dashboard in real time
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('deletion_request', {
        id: data.id,
        userId: user.id,
        email: user.email,
        reason: reason || null,
        createdAt: new Date().toISOString(),
      });
    } catch {}

    res.json({ success: true, id: data.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER NOTIFICATIONS INBOX ─────────────────────────────────────────────────

app.get('/api/notifications/inbox', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const svc = getServiceSupabaseClient();
    const { data, error } = await svc
      .from('user_notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (error.code === '42P01') return res.json({ notifications: [], unread: 0 });
      throw error;
    }

    const unread = (data || []).filter(n => !n.is_read).length;
    res.json({ notifications: data || [], unread });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/inbox/:id/read', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const svc = getServiceSupabaseClient();
    const { id } = req.params;

    const query = id === 'all'
      ? svc.from('user_notifications').update({ is_read: true }).eq('user_id', user.id)
      : svc.from('user_notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id);

    const { error } = await query;
    if (error && error.code !== '42P01') throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/register — create a new user via the service-role admin client
 * so that trigger failures never block signup. Manually provisions wallet +
 * energy account to guarantee records exist.
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const cleanEmail = email.trim().toLowerCase();
    const svc = getServiceSupabaseClient();

    // 1) Hard duplicate-check via the admin API. signUp() will silently re-issue
    //    a confirmation email for an unconfirmed account instead of erroring,
    //    which lets a single email be re-registered repeatedly. Using
    //    listUsers() with email filter gives us a definitive yes/no.
    try {
      const { data: existing } = await svc.auth.admin.listUsers({
        page: 1,
        perPage: 1,
        // @ts-expect-error - filter is supported in supabase-js >= 2.x but not always typed
        filter: `email.eq.${cleanEmail}`,
      });
      const existingUser = existing?.users?.find(
        (u: any) => (u.email || '').toLowerCase() === cleanEmail,
      );
      if (existingUser) {
        return res.status(409).json({
          error: 'An account with this email already exists. Try signing in or reset your password.',
        });
      }
    } catch (lookupErr: any) {
      // Don't block signup on a transient admin lookup failure — fall through
      // to signUp() which will still error on a true duplicate.
      console.warn('[Register] Pre-check listUsers failed:', lookupErr?.message);
    }

    // 2) Bypass Supabase's broken SMTP relay entirely. We:
    //    a. Create the auth user via admin API (email_confirm: false so the
    //       account exists but is unverified). This NEVER touches SMTP.
    //    b. Generate a signup verification link via admin.generateLink. This
    //       also doesn't touch SMTP — it just returns the signed action URL.
    //    c. Send the email through Resend's API directly (resendEmailService),
    //       which guarantees delivery as long as the Resend domain is verified.
    const { data: createData, error: createErr } = await svc.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: false,
    });

    if (createErr) {
      const msg = createErr.message?.toLowerCase() || '';
      console.error('[Register] admin.createUser error:', createErr.message);
      if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
        return res.status(409).json({
          error: 'An account with this email already exists. Try signing in or reset your password.',
        });
      }
      if (msg.includes('rate') || msg.includes('too many')) {
        return res.status(429).json({ error: 'Too many sign-up attempts. Please wait a minute and try again.' });
      }
      if (msg.includes('password')) {
        return res.status(400).json({ error: createErr.message });
      }
      return res.status(400).json({ error: createErr.message });
    }

    const userId = createData?.user?.id;
    if (!userId) {
      return res.status(500).json({ error: 'Account creation succeeded but no user ID was returned.' });
    }

    // Provision wallet / energy / subscription so the user has working
    // records the moment they verify and sign in.
    await Promise.allSettled([
      svc.from('wallets').upsert({ user_id: userId }, { onConflict: 'user_id' }),
      svc.from('energy_accounts').upsert({ user_id: userId, balance_credits: 0 }, { onConflict: 'user_id' }),
      svc.from('subscriptions').upsert({ user_id: userId, plan: 'none', status: 'inactive' }, { onConflict: 'user_id' }),
    ]);

    // Generate the verification action link via admin API. The redirect
    // target is our public /auth/verified HTML page (works in any browser);
    // it then deep-links back into the app for installed users.
    const verifiedRedirect = `${getPublicBaseUrl(req)}/auth/verified`;
    const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
      type: 'signup',
      email: cleanEmail,
      password,
      options: {
        redirectTo: verifiedRedirect,
      },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      console.error('[Register] generateLink error:', linkErr?.message);
      // The user exists but we couldn't mint a link. Roll back so they can
      // retry signup cleanly instead of being stuck in an unverified state
      // with no link.
      await svc.auth.admin.deleteUser(userId).catch(() => {});
      return res.status(502).json({
        error: 'We couldn\'t generate your verification link. Please try again in a moment.',
        code: 'LINK_GENERATION_FAILED',
      });
    }

    const actionLink = linkData.properties.action_link;

    // Send the email via Resend directly.
    const emailResult = await sendSignupConfirmationEmail(cleanEmail, actionLink);

    if (!emailResult.ok) {
      console.error('[Register] Resend send failed:', emailResult.error);
      // The user account exists. Don't roll back — they can hit "Resend
      // verification" to try again. But surface the failure so the client
      // shows an honest error instead of falsely claiming success.
      return res.status(502).json({
        error: emailResult.error?.includes('not configured')
          ? 'Email service is not configured on the server. Please contact support.'
          : 'Your account was created but we couldn\'t send the verification email. Please tap "Resend verification" in a moment.',
        code: 'EMAIL_DELIVERY_FAILED',
        accountCreated: true,
      });
    }

    res.json({
      success: true,
      message: 'Account created. Please check your email to verify your address.',
    });
  } catch (err: any) {
    console.error('[Register] Error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/**
 * POST /api/auth/reset-password — send a password reset email using the
 * service role so we don't depend on the anon-key client succeeding.
 */
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, redirectTo } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    // Always send the user to our hosted reset-password HTML form so the link
    // works in any browser. The mobile client used to pass `adroom://reset-password`,
    // which 404'd on desktop and silently fell back to Supabase's Site URL
    // (often localhost). We ignore any client-supplied redirectTo here on
    // purpose — the hosted form is the right destination for everyone.
    const _ignoredClientRedirect = redirectTo;
    void _ignoredClientRedirect;
    const finalRedirect = `${getPublicBaseUrl(req)}/auth/reset-password`;
    const svc = getServiceSupabaseClient();

    // Try to generate the recovery link directly. supabase-js's
    // admin.listUsers() doesn't actually support a server-side `filter`
    // parameter — passing one was silently returning "no match" for almost
    // every email, which short-circuited the flow and never sent the email.
    // Instead, we attempt generateLink straight away and treat
    // "user not found" / "User not found" as a silent success so we don't
    // leak which emails are registered.
    const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
      type: 'recovery',
      email: cleanEmail,
      options: { redirectTo: finalRedirect },
    });

    if (linkErr) {
      const msg = (linkErr.message || '').toLowerCase();
      const isMissingUser =
        msg.includes('user not found') ||
        msg.includes('not found') ||
        msg.includes('no user') ||
        (linkErr as any).status === 404;
      if (isMissingUser) {
        // Silent success — don't leak account existence.
        console.log(`[ResetPassword] No account for ${cleanEmail} — returning silent success.`);
        return res.json({ success: true });
      }
      console.error('[ResetPassword] generateLink error:', linkErr.message);
      return res.status(502).json({
        error: 'We couldn\'t generate your reset link right now. Please try again in a few minutes.',
        code: 'LINK_GENERATION_FAILED',
      });
    }

    if (!linkData?.properties?.action_link) {
      console.error('[ResetPassword] generateLink returned no action_link');
      return res.status(502).json({
        error: 'We couldn\'t generate your reset link right now. Please try again in a few minutes.',
        code: 'LINK_GENERATION_FAILED',
      });
    }

    // Send the email via Resend directly — guaranteed delivery as long as
    // the Resend domain is verified.
    const emailResult = await sendPasswordResetEmail(cleanEmail, linkData.properties.action_link);
    if (!emailResult.ok) {
      console.error('[ResetPassword] Resend send failed:', emailResult.error);
      return res.status(502).json({
        error: emailResult.error?.includes('not configured')
          ? 'Email service is not configured on the server. Please contact support.'
          : 'We couldn\'t send the password-reset email right now. Please try again in a few minutes.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ResetPassword] Error:', err.message);
    res.status(500).json({ error: 'Could not send reset email.' });
  }
});

/**
 * POST /api/auth/resend-verification — re-trigger Supabase's built-in
 * verification email for an unconfirmed user.
 */
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const svc = getServiceSupabaseClient();

    // Skip the pre-check — supabase-js admin.listUsers doesn't actually
    // support a server-side `filter` parameter, which was silently returning
    // "no match" for almost every email and short-circuiting the flow.
    // Instead we attempt generateLink directly: if the user doesn't exist
    // or is already confirmed, the API tells us — and we return silent
    // success so we don't leak account state.
    const { data: linkData, error: linkErr } = await svc.auth.admin.generateLink({
      type: 'signup',
      email: cleanEmail,
      // For an existing unconfirmed user, password is required by the API
      // but ignored — we pass a throwaway placeholder.
      password: 'placeholder-not-used-' + Math.random().toString(36).slice(2),
      options: { redirectTo: `${getPublicBaseUrl(req)}/auth/verified` },
    });

    if (linkErr) {
      const msg = (linkErr.message || '').toLowerCase();
      const isAlreadyConfirmed =
        msg.includes('already') && (msg.includes('registered') || msg.includes('confirmed'));
      const isMissingUser =
        !isAlreadyConfirmed &&
        (msg.includes('user not found') || msg.includes('not found') || (linkErr as any).status === 404);
      if (isAlreadyConfirmed || isMissingUser) {
        return res.json({ success: true });
      }
      console.error('[ResendVerification] generateLink error:', linkErr.message);
      return res.status(502).json({
        error: 'We couldn\'t generate a new verification link right now. Please try again in a few minutes.',
        code: 'LINK_GENERATION_FAILED',
      });
    }

    if (!linkData?.properties?.action_link) {
      console.error('[ResendVerification] generateLink returned no action_link');
      return res.status(502).json({
        error: 'We couldn\'t generate a new verification link right now. Please try again in a few minutes.',
        code: 'LINK_GENERATION_FAILED',
      });
    }

    // Send via Resend directly.
    const emailResult = await sendSignupConfirmationEmail(cleanEmail, linkData.properties.action_link);
    if (!emailResult.ok) {
      console.error('[ResendVerification] Resend send failed:', emailResult.error);
      return res.status(502).json({
        error: emailResult.error?.includes('not configured')
          ? 'Email service is not configured on the server. Please contact support.'
          : 'We couldn\'t send the verification email right now. Please try again in a few minutes.',
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ResendVerification] Error:', err.message);
    res.status(500).json({ error: 'Could not resend verification email.' });
  }
});

app.post('/api/push/register', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { token, platform, app_version, device_id } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' });
    if (!device_id || typeof device_id !== 'string') return res.status(400).json({ error: 'device_id required' });

    const svc = getServiceSupabaseClient();
    const now = new Date().toISOString();

    // Per-device dedupe: replace whatever this user previously had on this
    // physical device. We use a manual select-then-update/insert instead of
    // upsert({onConflict}) because the unique index on (user_id, device_id)
    // is a PARTIAL index (WHERE device_id IS NOT NULL) and PostgreSQL requires
    // the WHERE clause to be echoed in ON CONFLICT inference — which the
    // Supabase JS SDK does not support. The select-first approach is
    // functionally identical and avoids the constraint-matching error.
    const { data: existingRow } = await svc
      .from('device_push_tokens')
      .select('id')
      .eq('user_id', user.id)
      .eq('device_id', device_id)
      .maybeSingle();

    let upsertErr: any = null;
    if (existingRow) {
      const { error } = await svc
        .from('device_push_tokens')
        .update({
          token,
          platform: platform || 'unknown',
          app_version: app_version || null,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        })
        .eq('user_id', user.id)
        .eq('device_id', device_id);
      upsertErr = error;
    } else {
      const { error } = await svc
        .from('device_push_tokens')
        .insert({
          user_id: user.id,
          device_id,
          token,
          platform: platform || 'unknown',
          app_version: app_version || null,
          is_active: true,
          last_seen_at: now,
          updated_at: now,
        });
      upsertErr = error;
    }

    if (upsertErr) {
      console.error('[PushRegister] Token save failed:', upsertErr.message);
      return res.status(500).json({ error: upsertErr.message });
    }

    // Defensive cleanup: if this token was previously stored under a different
    // user on this same device (account switch), deactivate those stale rows.
    await svc
      .from('device_push_tokens')
      .update({ is_active: false })
      .eq('token', token)
      .neq('user_id', user.id);

    console.log(`[PushRegister] user=${user.id} device=${device_id.slice(0, 8)} platform=${platform}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[PushRegister] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/push/test — diagnostic. Sends a real test push to all of the
 * authenticated user's active devices and returns Expo's full response so
 * we can pinpoint exactly why a push isn't being delivered to a closed
 * Android app (FCM v1 not configured, MismatchSenderId, DeviceNotRegistered…).
 */
app.post('/api/push/test', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { pushService } = await import('./services/pushService');
    const out = await pushService.sendTest(user.id);

    let diagnosis = 'OK — push delivered to Expo successfully.';
    let actionable: string | null = null;

    if (out.tokensFound === 0) {
      diagnosis = 'No active push tokens registered for this account.';
      actionable = 'Open the app, allow notifications when prompted, and try again. Push tokens are only registered after sign-in on a real device build (not Expo Go).';
    } else if (!out.result.ok) {
      const sum = out.result.errorSummary || '';
      if (/MismatchSenderId/i.test(sum)) {
        diagnosis = 'FCM Sender ID mismatch — your google-services.json does not match the FCM project linked to Expo.';
        actionable = 'In Firebase Console download a fresh google-services.json for this Android app, place it in the project root, and re-build with EAS.';
      } else if (/InvalidCredentials/i.test(sum)) {
        diagnosis = 'Expo cannot reach FCM — your FCM v1 Service Account is missing or invalid in your Expo dashboard.';
        actionable = 'In Firebase Console → Project Settings → Service Accounts → "Generate new private key", then upload that JSON to https://expo.dev/accounts/<you>/projects/adroom-mobile/credentials → "Push Notifications: Android" → "Add a service account key".';
      } else if (/DeviceNotRegistered/i.test(sum)) {
        diagnosis = 'The push token on this device has been invalidated by FCM (app uninstalled / reinstalled / data cleared).';
        actionable = 'Open the app on the device — a new token will be registered automatically.';
      } else {
        diagnosis = 'Expo accepted the request but reported an error.';
        actionable = sum || 'See raw response for details.';
      }
    }

    res.json({
      success: out.result.ok,
      diagnosis,
      actionable,
      tokensFound: out.tokensFound,
      devices: out.devices,
      expo: {
        ok: out.result.ok,
        httpStatus: out.result.httpStatus,
        tokensSent: out.result.tokensSent,
        invalidTokens: out.result.invalidTokens.length,
        errorSummary: out.result.errorSummary,
        ticketCount: out.result.tickets.length,
        rawResponse: out.result.rawResponse,
      },
    });
  } catch (err: any) {
    console.error('[PushTest] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/push/unregister', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { device_id, token } = req.body || {};
    if (!device_id && !token) return res.status(400).json({ error: 'device_id or token required' });

    const svc = getServiceSupabaseClient();
    let q = svc.from('device_push_tokens').update({ is_active: false }).eq('user_id', user.id);
    if (device_id) q = q.eq('device_id', device_id);
    else q = q.eq('token', token);

    const { error } = await q;
    if (error) {
      console.error('[PushUnregister] Update failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[PushUnregister] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/cma/live-status — real-time CMA state for mobile monitoring
 * Returns economy override status, current savings, cooldowns, and burn rate.
 * No auth required — lightweight polling endpoint.
 */
app.get('/api/cma/live-status', async (_req, res) => {
  try {
    const { creditManagementAgent: cmaAgent } = await import('./services/creditManagementAgent');
    const [liveStatus, stats] = await Promise.all([
      Promise.resolve(cmaAgent.getLiveStatus()),
      cmaAgent.getSavingsSummary(1), // last 24h
    ]);
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      economyOverrideActive: liveStatus.dynamicEconomyOverride,
      activeCooldowns: liveStatus.activeSystemCooldowns,
      trackedUsers: liveStatus.trackedUsers,
      last24h: {
        savedCredits: stats.totalSavedCredits,
        savedUsd: stats.totalSavedUsd,
        economyRatio: stats.economyRatio,
        systemBurnRate: stats.systemBurnRate,
        events: stats.events,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUBLIC DELETE ACCOUNT PAGE (Google Play Store Compliance) ────────────────

app.get('/delete-account', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Delete Account — AdRoom</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #13131a;
      border: 1px solid #2a2a3a;
      border-radius: 16px;
      padding: 40px 36px;
      max-width: 480px;
      width: 100%;
    }
    .logo {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
      background: linear-gradient(90deg, #a78bfa, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 10px;
    }
    p {
      font-size: 14px;
      color: #8888aa;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #aaaacc;
      margin-bottom: 6px;
    }
    input, textarea {
      width: 100%;
      background: #1e1e2e;
      border: 1px solid #2e2e4e;
      border-radius: 10px;
      color: #e0e0e0;
      font-size: 15px;
      padding: 12px 14px;
      margin-bottom: 18px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, textarea:focus { border-color: #6366f1; }
    textarea { resize: vertical; min-height: 90px; font-family: inherit; }
    button {
      width: 100%;
      background: linear-gradient(135deg, #6366f1, #a78bfa);
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 14px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.88; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .notice {
      font-size: 12px;
      color: #666688;
      margin-top: 14px;
      line-height: 1.5;
    }
    .success {
      text-align: center;
      padding: 16px 0;
    }
    .success-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .success h2 {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 10px;
    }
    .success p { margin-bottom: 0; }
    .error-msg {
      background: #2d1b1b;
      border: 1px solid #6b2c2c;
      border-radius: 8px;
      color: #ff6b6b;
      font-size: 13px;
      padding: 10px 14px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">AdRoom</div>
    <h1>Delete Your Account</h1>
    <p>Submit your request below. Our team will process it within 30 days. All your personal data, campaigns, and account information will be permanently removed.</p>

    <form id="deleteForm">
      <label for="email">Email address on your account *</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" required />

      <label for="reason">Reason (optional)</label>
      <textarea id="reason" name="reason" placeholder="Let us know why you're leaving…"></textarea>

      <div id="errorBox" class="error-msg" style="display:none"></div>

      <button type="submit" id="submitBtn">Request Account Deletion</button>
      <p class="notice">By submitting this form you confirm that you want your AdRoom account and all associated data permanently deleted. This action cannot be undone.</p>
    </form>

    <div class="success" id="successBox" style="display:none">
      <div class="success-icon">✅</div>
      <h2>Request Received</h2>
      <p>We've received your deletion request. You'll receive a confirmation and your account will be permanently deleted within 30 days.</p>
    </div>
  </div>

  <script>
    document.getElementById('deleteForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const errorBox = document.getElementById('errorBox');
      const email = document.getElementById('email').value.trim();
      const reason = document.getElementById('reason').value.trim();
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      errorBox.style.display = 'none';
      try {
        const res = await fetch('/delete-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, reason })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        document.getElementById('deleteForm').style.display = 'none';
        document.getElementById('successBox').style.display = 'block';
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Request Account Deletion';
      }
    });
  </script>
</body>
</html>`);
});

app.post('/delete-account', async (req, res) => {
  try {
    const { email, reason } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const svc = getServiceSupabaseClient();

    // Look up the user by email via auth admin API
    const { data: { users }, error: lookupErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
    if (lookupErr) throw lookupErr;

    const matched = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    const userId = matched?.id ?? null;

    // Check for existing pending request by email (regardless of userId)
    const { data: existing } = await svc
      .from('account_deletion_requests')
      .select('id')
      .eq('user_email', email.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return res.json({ success: true, already_pending: true });
    }

    const { error: insertErr } = await svc.from('account_deletion_requests').insert({
      user_id: userId,
      user_email: email.toLowerCase(),
      reason: reason || null,
      status: 'pending',
      source: 'web',
    });

    if (insertErr) throw insertErr;

    // Broadcast to admin dashboard
    try {
      const { adminBroadcast } = await import('./admin/adminRouter');
      adminBroadcast('deletion_request', {
        userId,
        email: email.toLowerCase(),
        reason: reason || null,
        source: 'web',
        createdAt: new Date().toISOString(),
      });
    } catch {}

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error. Please try again later.' });
  }
});

// ─── Strategy Pause / Resume ────────────────────────────────────────────────

app.patch('/api/strategy/:id/pause', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const strategyId = req.params.id;

    const { error: stratErr } = await supabase
      .from('strategies')
      .update({ status: 'paused', is_active: false, updated_at: new Date().toISOString() })
      .eq('id', strategyId)
      .eq('user_id', user.id);
    if (stratErr) return res.status(500).json({ error: stratErr.message });

    const { error: memErr } = await supabase
      .from('strategy_memory')
      .update({ status: 'paused' })
      .eq('strategy_id', strategyId)
      .eq('user_id', user.id);
    if (memErr) console.warn('[Pause] strategy_memory update failed:', memErr.message);

    await supabase
      .from('agent_tasks')
      .update({ status: 'paused' })
      .eq('strategy_id', strategyId)
      .eq('user_id', user.id)
      .in('status', ['pending', 'scheduled']);

    console.log(`[Strategy] Paused strategy ${strategyId} for user ${user.id}`);
    return res.status(200).json({ paused: true, strategyId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.patch('/api/strategy/:id/resume', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const strategyId = req.params.id;

    const { error: stratErr } = await supabase
      .from('strategies')
      .update({ status: 'active', is_active: true, updated_at: new Date().toISOString() })
      .eq('id', strategyId)
      .eq('user_id', user.id);
    if (stratErr) return res.status(500).json({ error: stratErr.message });

    const { error: memErr } = await supabase
      .from('strategy_memory')
      .update({ status: 'active' })
      .eq('strategy_id', strategyId)
      .eq('user_id', user.id);
    if (memErr) console.warn('[Resume] strategy_memory update failed:', memErr.message);

    await supabase
      .from('agent_tasks')
      .update({ status: 'pending' })
      .eq('strategy_id', strategyId)
      .eq('user_id', user.id)
      .eq('status', 'paused');

    console.log(`[Strategy] Resumed strategy ${strategyId} for user ${user.id}`);
    return res.status(200).json({ resumed: true, strategyId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Radar Agent ────────────────────────────────────────────────────────────

app.post('/api/radar/scan/:strategyId', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { RadarAgent } = await import('./agents/radarAgent');
    const radar = new RadarAgent();
    const intel = await radar.runScan(user.id, req.params.strategyId);

    return res.status(200).json({ intel });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/radar/intel/:strategyId', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { data } = await supabase
      .from('radar_intel')
      .select('*')
      .eq('strategy_id', req.params.strategyId)
      .eq('user_id', user.id)
      .order('scanned_at', { ascending: false })
      .limit(10);

    return res.status(200).json({ intel: data || [] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Daily Strategy Reports ──────────────────────────────────────────────────

app.get('/api/strategy/:id/daily-reports', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { data } = await supabase
      .from('strategy_daily_reports')
      .select('*')
      .eq('strategy_id', req.params.id)
      .eq('user_id', user.id)
      .order('report_date', { ascending: false })
      .limit(30);

    return res.status(200).json({ reports: data || [] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/strategy/:id/daily-summary', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { data: strategy } = await supabase
      .from('strategy_memory')
      .select('*')
      .eq('strategy_id', req.params.id)
      .eq('user_id', user.id)
      .single();

    if (!strategy) return res.status(404).json({ error: 'Strategy not found.' });

    const { DailySummaryService } = await import('./services/dailySummaryService');
    const summaryService = new DailySummaryService();
    await summaryService.generateSummaryForStrategy(user.id, strategy);

    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Video Upload (User-Supplied Videos for TikTok) ──────────────────────────

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are accepted.'));
    }
  },
});

app.post('/api/video/upload', videoUpload.single('video'), async (req: any, res) => {
  try {
    const supabase = getSupabaseClient(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No video file provided.' });

    const ext = file.originalname.split('.').pop() || 'mp4';
    const fileName = `user_videos/${user.id}/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;

    const svc = getServiceSupabaseClient();
    const { error: uploadError } = await svc.storage
      .from('creative-assets')
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) throw new Error(uploadError.message);

    const { data: { publicUrl } } = svc.storage.from('creative-assets').getPublicUrl(fileName);

    console.log(`[VideoUpload] User ${user.id} uploaded video: ${publicUrl}`);
    return res.status(200).json({ url: publicUrl });
  } catch (e: any) {
    console.error('[VideoUpload] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── Smart Video Editor ──────────────────────────────────────────────────────

app.post('/api/video/edit-plan', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { videoUri, productName, goal, platform, instructions, strategyId } = req.body;
    if (!productName || !goal || !platform) {
      return res.status(400).json({ error: 'productName, goal, and platform are required.' });
    }

    const { SmartVideoEditor } = await import('./services/smartVideoEditor');
    const editor = new SmartVideoEditor();
    const result = await editor.generateEditPlan({ videoUri, productName, goal, platform, instructions });

    if (videoUri && strategyId) {
      try {
        await editor.saveEditPlan(user.id, strategyId, videoUri, result);
      } catch (saveErr: any) {
        console.warn('[VideoEditor] Could not save edit job (non-fatal):', saveErr.message);
      }
    }

    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Execute Video Edit Plan — executes a saved edit job via ffmpeg and returns the edited video URL.
 */
app.post('/api/ai/execute-edit-plan', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required.' });

    const { data: job } = await supabase.from('video_edit_jobs').select('user_id').eq('id', jobId).single();
    if (!job || job.user_id !== user.id) return res.status(403).json({ error: 'Job not found or access denied.' });

    const { SmartVideoEditor } = await import('./services/smartVideoEditor');
    const editor = new SmartVideoEditor();
    const videoUrl = await editor.executeEditPlan(jobId);

    return res.status(200).json({ success: true, videoUrl });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Google Maps Business Discovery ─────────────────────────────────────────

/**
 * POST /api/sales/discover-businesses
 * Searches nearby businesses via Google Maps Places API, scores outreach
 * potential from reviews, and returns structured prospects.
 * Body: { location, keyword?, category?, radius?, maxResults? }
 */
app.post('/api/sales/discover-businesses', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { location, keyword, category, radius, maxResults } = req.body;
    if (!location) return res.status(400).json({ error: 'location is required.' });

    const { discoverBusinesses } = await import('./services/googleMapsService');
    const result = await discoverBusinesses({ location, keyword, category, radius, maxResults });

    return res.status(200).json(result);
  } catch (e: any) {
    console.error('[BusinessDiscovery] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/sales/outreach
 * Sends personalised outreach to a discovered business via email (Resend)
 * or records a WhatsApp outreach task for manual/automation follow-up.
 * Body: { business, channel, senderName, productOrService, userId?, customMessage? }
 */
app.post('/api/sales/outreach', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const { business, channel, senderName, productOrService, customMessage } = req.body;
    if (!business || !channel || !senderName || !productOrService) {
      return res.status(400).json({ error: 'business, channel, senderName, and productOrService are required.' });
    }

    const { buildOutreachMessage } = await import('./services/googleMapsService');
    const message = customMessage || buildOutreachMessage(business, senderName, productOrService);

    if (channel === 'email') {
      if (!business.website && !business.email) {
        return res.status(400).json({ error: 'Business has no email or website on record.' });
      }
      const toEmail = business.email || `contact@${new URL(business.website!).hostname}`;
      const result = await (await import('./services/resendEmailService')).sendEmailViaResend({
        to: toEmail,
        subject: `Quick question about ${business.name}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;padding:24px;">
          <p style="font-size:15px;line-height:1.6;">${message.replace(/\n/g, '<br/>')}</p>
          <p style="color:#888;font-size:12px;margin-top:24px;">Sent via AdRoom AI Sales Agent</p>
        </div>`,
        text: message,
      });
      if (!result.ok) {
        return res.status(500).json({ error: result.error || 'Email send failed.' });
      }
      await supabase.from('agent_leads').insert({
        user_id: user.id,
        platform: 'email',
        platform_username: business.name,
        platform_user_id: toEmail,
        first_interaction: message,
        intent_score: business.outreach_score || 0.5,
        intent_signals: [{ source: 'google_maps_discovery', place_id: business.place_id, rating: business.rating }],
        stage: 'identified',
        next_followup_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });
      return res.status(200).json({ success: true, channel: 'email', messageId: result.id });
    }

    if (channel === 'whatsapp') {
      const phone = business.phone?.replace(/\D/g, '');
      if (!phone) {
        return res.status(400).json({ error: 'Business has no phone number on record for WhatsApp.' });
      }
      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      await supabase.from('agent_leads').insert({
        user_id: user.id,
        platform: 'whatsapp',
        platform_username: business.name,
        platform_user_id: phone,
        first_interaction: message,
        intent_score: business.outreach_score || 0.5,
        intent_signals: [{ source: 'google_maps_discovery', place_id: business.place_id, rating: business.rating }],
        stage: 'identified',
        next_followup_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });
      return res.status(200).json({ success: true, channel: 'whatsapp', waUrl, message });
    }

    return res.status(400).json({ error: `Unsupported channel: ${channel}. Use 'email' or 'whatsapp'.` });
  } catch (e: any) {
    console.error('[SalesOutreach] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Ensures required Supabase Storage buckets exist at server startup.
 * Runs once on boot — safe to call multiple times (idempotent).
 *
 * Root cause for [VideoUpload] / [Creative:Imagen] "Bucket not found":
 * The `creative-assets` bucket was never created via migration or dashboard.
 * This function auto-creates it so uploads work without manual Supabase
 * dashboard intervention on every new deployment / environment.
 */
async function ensureStorageBuckets(): Promise<void> {
  const REQUIRED_BUCKETS = [
    { name: 'creative-assets', public: true },
  ];

  try {
    const svc = getServiceSupabaseClient();
    const { data: existing, error: listErr } = await svc.storage.listBuckets();
    if (listErr) {
      console.warn('[Storage] Could not list buckets (non-fatal):', listErr.message);
      return;
    }

    const existingNames = new Set((existing || []).map((b: any) => b.name));

    for (const bucket of REQUIRED_BUCKETS) {
      if (existingNames.has(bucket.name)) {
        console.log(`[Storage] Bucket "${bucket.name}" already exists ✓`);
        continue;
      }
      const { error: createErr } = await svc.storage.createBucket(bucket.name, {
        public: bucket.public,
        allowedMimeTypes: undefined, // allow all types
        fileSizeLimit: undefined,    // no server-side limit (rely on multer)
      });
      if (createErr) {
        // "already exists" is not a real error — race condition on first boot
        if (createErr.message?.toLowerCase().includes('already exists')) {
          console.log(`[Storage] Bucket "${bucket.name}" already exists (race) ✓`);
        } else {
          console.error(`[Storage] Failed to create bucket "${bucket.name}":`, createErr.message);
        }
      } else {
        console.log(`[Storage] Created bucket "${bucket.name}" (public=${bucket.public}) ✓`);
      }
    }
  } catch (e: any) {
    console.warn('[Storage] Bucket ensure failed (non-fatal):', e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`[AdRoom Server] Running on port ${PORT} — ${new Date().toISOString()}`);
  console.log(`[AdRoom Server] AI Engines: GPT-4o (strategy) | Gemini 2.0 Flash (text) | Imagen 3 (creative)`);
  console.log(`[AdRoom Server] Agents: SALESMAN | AWARENESS | PROMOTION | LAUNCH`);
  console.log(`[AdRoom Server] Features: Autonomous Execution | Lead Capture | Performance Monitoring | Self-Optimization`);

  // Ensure required Supabase Storage buckets exist (fixes "Bucket not found" on
  // fresh deployments where the bucket was never manually created).
  await ensureStorageBuckets();

  // Restore CMA persisted state (economy override etc) before starting loops
  try {
    const { creditManagementAgent: cmaAgent } = await import('./services/creditManagementAgent');
    await cmaAgent.init();
    console.log('[AdRoom Server] CMA state restored from database');
  } catch (e: any) {
    console.warn('[AdRoom Server] CMA init failed (non-fatal):', e.message);
  }

  // Start all background intelligence + agent execution loops
  const scheduler = new SchedulerService();
  scheduler.start();
});
