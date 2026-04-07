import express, { type Request } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { EngagementService } from './services/engagement';
import { CreativeService } from './services/creativeService';
import { getSupabaseClient, getServiceSupabaseClient } from './config/supabase';
import { MemoryRetriever, type MemoryContext } from './services/memoryRetriever';
import { DecisionEngine, type AIStrategy } from './services/decisionEngine';
import { AIEngine } from './config/ai-models';
import { ScraperService } from './services/scraperService';
import { AgentOrchestrator } from './agents/agentOrchestrator';
import { SchedulerService } from './services/scheduler';
import { energyService, PLANS, TOPUP_PACKS } from './services/energyService';
import { flutterwaveService } from './services/flutterwaveService';
import { energyCheck, deductEnergyForUser } from './services/energyMiddleware';
import { checkFeatureAccess, getSubscriptionGuard, SUBSCRIPTION_PLAN_LIMITS } from './services/subscriptionGuard';
import adminRouter from './admin/adminRouter';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
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

type OAuthPlatform = 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'tiktok';
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

// Root endpoint
app.get('/', (_req, res) => {
  res.send('AdRoom Backend is running.');
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
    return res.status(200).json({ disconnected: true, platform });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message });
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

    // Check energy before AI call
    const energyCheck = await energyService.checkEnergy(user.id, 'scan_product');
    if (!energyCheck.allowed) {
      return res.status(402).json({
        error: 'INSUFFICIENT_ENERGY',
        message: `You need ${energyCheck.required} energy credits for product scanning. Current balance: ${energyCheck.balance.toFixed(2)}.`,
        balance: energyCheck.balance, required: energyCheck.required,
      });
    }

    const result = await aiEngine.analyzeImage(imageBase64, scanPrompt);
    // Deduct energy after successful call
    await deductEnergyForUser(user.id, 'scan_product');

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

        // Check energy before expensive AI pipeline
        const energyCheck2 = await energyService.checkEnergy(user.id, 'generate_strategy');
        if (!energyCheck2.allowed) {
          return res.status(402).json({
            error: 'INSUFFICIENT_ENERGY',
            message: `Strategy generation requires ${energyCheck2.required} credits. Current balance: ${energyCheck2.balance.toFixed(2)}.`,
            balance: energyCheck2.balance, required: energyCheck2.required,
          });
        }

        const retriever = new MemoryRetriever(supabase);
        const context = await retriever.getAllContext(user.id, productId, 'product');

        console.log(`[Strategy] [${ts()}] STEP 3 — Memory context assembled:`);
        console.log(`[Strategy]   Platform Intelligence: ${context.platformIntelligence?.length || 0} signals`);
        console.log(`[Strategy]   Social Listening: ${context.socialListening?.length || 0} conversations`);
        console.log(`[Strategy]   Emotional Intelligence: ${context.emotionalIntelligence?.length || 0} entries`);
        console.log(`[Strategy]   GEO Narrative: ${context.geoNarrative?.length || 0} snapshots`);
        console.log(`[Strategy]   Strategy History: ${context.history?.length || 0} past strategies`);
        console.log(`[Strategy] [${ts()}] STEP 4 — Passing context to DecisionEngine (GPT-4o)...`);

        const strategy = await decisionEngine.generateStrategy(context, goal, duration);

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

        // Deduct energy after successful strategy generation
        await deductEnergyForUser(user.id, 'generate_strategy');
        console.log(`[Strategy] ═══════════════════════════════════════\n`);
        res.status(200).json({ strategy, strategyId: savedStrategy?.id });
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
    const { strategyId, goal, platforms } = req.body;
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

        // Check energy before agent activation
        const agentEnergyCheck = await energyService.checkEnergy(user.id, 'activate_agents');
        if (!agentEnergyCheck.allowed) {
          return res.status(402).json({
            error: 'INSUFFICIENT_ENERGY',
            message: `Agent activation requires ${agentEnergyCheck.required} credits. Current balance: ${agentEnergyCheck.balance.toFixed(2)}.`,
            balance: agentEnergyCheck.balance, required: agentEnergyCheck.required,
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

    const { amount, type, id } = req.body;
    if (!amount || !type || !id) return res.status(400).json({ error: 'amount, type, id required.' });

    const txRef = flutterwaveService.generateTxRef('ADROOM');
    const email = user.email || '';

    // Build Flutterwave hosted page URL
    const payload = flutterwaveService.buildPaymentPayload({
      amount,
      currency: 'USD',
      email,
      name: email,
      tx_ref: txRef,
      redirect_url: `${process.env.EXPO_PUBLIC_API_URL || 'https://adroom.app'}/api/billing/flw-callback`,
      title: type === 'subscription' ? `AdRoom ${PLANS[id as keyof typeof PLANS]?.name ?? id} Plan` : 'AdRoom Energy Top-Up',
      description: type === 'subscription' ? `Monthly subscription — ${id}` : `Energy top-up pack — ${id}`,
      meta: { user_id: user.id, type, plan_or_pack_id: id },
    });

    // Build Flutterwave standard hosted link
    const flwBaseUrl = 'https://checkout.flutterwave.com/v3/hosted/pay';
    const params = new URLSearchParams({
      public_key: payload.public_key,
      tx_ref: payload.tx_ref,
      amount: String(payload.amount),
      currency: payload.currency,
      customer_email: payload.customer.email,
      customer_name: payload.customer.name,
      redirect_url: payload.redirect_url,
      customization_title: payload.customizations.title,
    });

    res.status(200).json({ payment_url: `${flwBaseUrl}?${params.toString()}`, tx_ref: txRef });
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
    if (!transaction_id || !plan_id) return res.status(400).json({ error: 'transaction_id and plan_id required.' });

    const plan = PLANS[plan_id as keyof typeof PLANS];
    if (!plan) return res.status(400).json({ error: `Unknown plan: ${plan_id}` });

    // Verify with Flutterwave
    const verification = await flutterwaveService.verifyTransaction(transaction_id);
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
    if (!transaction_id || !pack_id) return res.status(400).json({ error: 'transaction_id and pack_id required.' });

    const pack = TOPUP_PACKS[pack_id as keyof typeof TOPUP_PACKS];
    if (!pack) return res.status(400).json({ error: `Unknown pack: ${pack_id}` });

    const verification = await flutterwaveService.verifyTransaction(transaction_id);
    if (verification.status !== 'success' || verification.data?.status !== 'successful') {
      return res.status(402).json({ error: 'Payment verification failed.', details: verification.message });
    }

    const paidAmount = verification.data?.amount ?? 0;
    if (paidAmount < pack.price_usd) {
      return res.status(402).json({ error: `Paid amount ($${paidAmount}) is less than pack price ($${pack.price_usd}).` });
    }

    const result = await energyService.applyTopUp(user.id, pack_id, String(verification.data?.id), tx_ref ?? '');
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

    await energyService.cancelSubscription(user.id, req.body.reason);
    res.status(200).json({ success: true });
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
        await energyService.applySubscription(user.id, id, transactionId, txRef, cardToken, cardLast4, cardBrand, email);
      } else {
        const topupPack = TOPUP_PACKS[id as keyof typeof TOPUP_PACKS];
        if (topupPack) await energyService.applyTopUp(user.id, topupPack.id, transactionId, txRef);
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
      if (type === 'subscription') {
        await energyService.applySubscription(user.id, id, transactionId, tx_ref, cardToken, cardLast4, cardBrand, email);
      } else {
        const topupPack = TOPUP_PACKS[id as keyof typeof TOPUP_PACKS];
        if (topupPack) await energyService.applyTopUp(user.id, topupPack.id, transactionId, tx_ref);
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
 */
app.get('/api/chat/history', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req as any);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const limit = parseInt(String(req.query.limit ?? '50'));
    const svc = getServiceSupabaseClient();
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

/**
 * Push Token Registration — called by the Expo app to register device push tokens
 */
app.post('/api/push/register', async (req, res) => {
  try {
    const supabase = getSupabaseClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { token, platform, app_version } = req.body;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' });

    const svc = getServiceSupabaseClient();
    await svc.from('device_push_tokens').upsert(
      { user_id: user.id, token, platform: platform || 'unknown', app_version: app_version || null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' }
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[AdRoom Server] Running on port ${PORT} — ${new Date().toISOString()}`);
  console.log(`[AdRoom Server] AI Engines: GPT-4o (strategy) | Gemini 2.0 Flash (text) | Imagen 3 (creative)`);
  console.log(`[AdRoom Server] Agents: SALESMAN | AWARENESS | PROMOTION | LAUNCH`);
  console.log(`[AdRoom Server] Features: Autonomous Execution | Lead Capture | Performance Monitoring | Self-Optimization`);

  // Start all background intelligence + agent execution loops
  const scheduler = new SchedulerService();
  scheduler.start();
});
