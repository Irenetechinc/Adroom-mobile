import express, { type Request } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { EngagementService } from './services/engagement';
import { CreativeService } from './services/creativeService';
import { getSupabaseClient } from './config/supabase';
import { MemoryRetriever, type MemoryContext } from './services/memoryRetriever';
import { DecisionEngine, type AIStrategy } from './services/decisionEngine';
import { AIEngine } from './config/ai-models';
import { ScraperService } from './services/scraperService';

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

const scraperService = new ScraperService();
const creativeService = new CreativeService();
const decisionEngine = new DecisionEngine();

if (!VERIFY_TOKEN) {
  console.warn('[Server] WARNING: FB_VERIFY_TOKEN not set — Facebook webhook verification disabled.');
}

function buildDeepLink(platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin', query: Record<string, string | undefined>) {
  const url = new URL(`adroom://auth/${platform}/callback`);
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string' && v.length > 0) url.searchParams.set(k, v);
  }
  return url.toString();
}

// Middleware to parse JSON bodies
app.use(bodyParser.json({ limit: '10mb' }));

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

/**
 * Scrape Website for Products
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

        const products = await scraperService.scrapeWebsite(url, user.id);
        res.status(200).json(products);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Generate Professional Image
 */
app.post('/api/creative/image', async (req, res) => {
    const { baseImageUri, productDetails } = req.body;
    try {
        const imageUrl = await creativeService.generateProfessionalImage(baseImageUri, productDetails);
        res.status(200).json({ url: imageUrl });
    } catch (error: any) {
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

    const result = await aiEngine.analyzeImage(imageBase64, scanPrompt);

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
 * Generate Strategy
 */
app.post('/api/ai/generate-strategy', async (req, res) => {
    const { productId, goal, duration } = req.body;
    try {
        const supabase = getSupabaseClient(req as any);
        
        // Use MemoryRetriever for full context instead of just product
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return res.status(401).json({ error: 'Unauthorized.' });

        const retriever = new MemoryRetriever(supabase);
        const context = await retriever.getAllContext(user.id, productId, 'product');

        const strategy = await decisionEngine.generateStrategy(context, goal, duration);

        res.status(200).json({ strategy });
    } catch (error: any) {
        console.error('Strategy generation error:', error);
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

app.listen(PORT, () => {
  console.log(`[AdRoom Server] Running on port ${PORT} — ${new Date().toISOString()}`);
  console.log(`[AdRoom Server] AI Engines: GPT-4o (strategy) | Gemini 1.5 Flash (text) | Imagen 3 (creative)`);
  console.log(`[AdRoom Server] Features: Web Scraping | GEO Monitoring | Social Listening | Emotional Intelligence`);
});
