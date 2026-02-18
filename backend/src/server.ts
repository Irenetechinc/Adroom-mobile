import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { EngagementService } from './services/engagement.js';
import { WalletService } from './services/wallet.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'adroom_verify_token';

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Root endpoint
app.get('/', (req, res) => {
  res.send('AdRoom Backend is running.');
});

/**
 * Facebook Webhook Verification
 * Used by Facebook to verify the callback URL.
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
 * Receives real-time updates (comments, messages, etc.)
 */
app.post('/webhooks/facebook', async (req, res) => {
  const body = req.body;
  console.log(`[FB Webhook] Received event: ${JSON.stringify(body.object)}`);

  // Check if this is an event from a Page subscription
  if (body.object === 'page') {
    // Respond immediately to avoid timeouts
    res.status(200).send('EVENT_RECEIVED');

    try {
      // Process the event asynchronously
      await EngagementService.handleWebhookEvent(body);
    } catch (error) {
      console.error('Error processing webhook event:', error);
    }
  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }
});

/**
 * Database Trigger Handler (Supabase)
 * Receives INSERT events from comments/messages tables via Trigger -> Railway
 */
app.post('/webhooks/database', async (req, res) => {
  const { type, table, record } = req.body;
  console.log(`[DB Webhook] Received ${type} on ${table}`);

  try {
    if (table === 'comments' && type === 'INSERT') {
      // Only process if it hasn't been handled yet (avoid double processing with FB webhook)
      // But typically this trigger is for "App-originated" comments or "System-inserted" comments
      // For "Autonomous Worker" logic, we usually want to catch things inserted by other means,
      // OR if we want to ensure reliability.
      // Given EngagementService handles FB Webhooks directly, this might be redundant for FB-origin comments.
      // However, if we want to handle "Internal" comments or just use DB as source of truth:
      await EngagementService.handleDatabaseComment(record);
    } else if (table === 'messages' && type === 'INSERT') {
      await EngagementService.handleDatabaseMessage(record);
    } else if (type === 'SCHEDULED_TASK') {
      // Handled by worker loop mostly, but can be triggered here too
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing DB webhook:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Wallet Endpoints
 */

// Get Balance
app.get('/api/wallet/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = await WalletService.getBalance(userId);
    res.json(wallet);
  } catch (error: any) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initiate Deposit
app.post('/api/wallet/deposit', async (req, res) => {
  try {
    const { userId, amount, email, name } = req.body;
    const result = await WalletService.initiateDeposit(userId, Number(amount), email, name);
    res.json(result);
  } catch (error: any) {
    console.error('Error initiating deposit:', error);
    res.status(500).json({ error: error.message });
  }
});

// Deduct Funds (Internal/Agent use)
app.post('/api/wallet/deduct', async (req, res) => {
  try {
    const { userId, amount, description, billingDetails } = req.body;
    
    if (!billingDetails) {
        throw new Error("Billing details are required for virtual card creation.");
    }

    const result = await WalletService.deductFunds(userId, Number(amount), description, billingDetails);
    res.json(result);
  } catch (error: any) {
    console.error('Error deducting funds:', error);
    res.status(400).json({ error: error.message }); // 400 for business logic error (insufficient funds)
  }
});

// Flutterwave Redirect Handler (Verify Payment)
app.get('/webhooks/flutterwave/redirect', async (req, res) => {
  const { status, tx_ref, transaction_id } = req.query;

  if (status === 'successful' || status === 'completed') {
    try {
      const success = await WalletService.verifyAndCredit(String(tx_ref), String(transaction_id));
      if (success) {
        res.send(`
          <html>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0B0F19;color:white;font-family:sans-serif;">
              <div style="text-align:center;">
                <h1 style="color:#4ADE80;">Payment Successful!</h1>
                <p>Your wallet has been credited.</p>
                <p>You can close this window now.</p>
              </div>
            </body>
          </html>
        `);
      } else {
        res.send('Payment verification failed.');
      }
    } catch (error) {
      console.error('Verification error:', error);
      res.status(500).send('Error verifying payment.');
    }
  } else {
    res.send('Payment was not successful.');
  }
});

// Flutterwave Webhook (Async confirmation)
app.post('/webhooks/flutterwave', async (req, res) => {
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLUTTERWAVE_HASH) {
    // res.sendStatus(401); // Optional: verify hash if set
  }
  
  const body = req.body;
  console.log('[FW Webhook]', body);

  if (body.event === 'charge.completed' && body.data.status === 'successful') {
     await WalletService.verifyAndCredit(body.data.tx_ref, body.data.id);
  }

  res.sendStatus(200);
});

/**
 * Remote Logging Endpoint
 * Receives logs from the mobile app (Vision, Creative, Agent actions) to centralize in Railway logs.
 */
app.post('/api/logs', (req, res) => {
  const { level, category, message, data, timestamp } = req.body;
  
  const logPrefix = `[APP] [${category?.toUpperCase() || 'GENERAL'}]`;
  const meta = data ? JSON.stringify(data) : '';
  const time = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();

  const fullMessage = `${time} ${logPrefix} ${message} ${meta}`;

  switch (level) {
    case 'error':
      console.error(fullMessage);
      break;
    case 'warn':
      console.warn(fullMessage);
      break;
    default:
      console.log(fullMessage);
  }

  res.sendStatus(200);
});



/**
 * Auth Redirect Endpoint (Facebook OAuth)
 * Handles the redirect from Facebook, extracts the code, and deep links back to the app.
 */
app.get('/auth/facebook/callback', (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[OAuth] Facebook Error:', error, error_description);
    return res.send(`
      <html>
        <body style="background:#0B0F19;color:white;font-family:sans-serif;text-align:center;padding:20px;">
          <h2 style="color:#ef4444;">Connection Failed</h2>
          <p>${error_description || 'Unknown error occurred.'}</p>
          <a href="adroom://auth/facebook/callback?error=${error}" style="color:#4ADE80;text-decoration:none;border:1px solid #4ADE80;padding:10px 20px;border-radius:5px;">Return to App</a>
        </body>
      </html>
    `);
  }

  if (code) {
    console.log('[OAuth] Received code, redirecting to app...');
    const appRedirect = `adroom://auth/facebook/callback?code=${code}${state ? `&state=${state}` : ''}`;
    
    // Serve an auto-redirect page for better UX and fallback
    return res.send(`
      <html>
        <head>
            <meta http-equiv="refresh" content="0;url=${appRedirect}">
        </head>
        <body style="background:#0B0F19;color:white;font-family:sans-serif;text-align:center;padding:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
          <h2 style="color:#4ADE80;">Connection Successful!</h2>
          <p>Redirecting you back to AdRoom...</p>
          <p style="font-size:12px;color:#888;">If you are not redirected automatically, click below:</p>
          <a href="${appRedirect}" style="color:#0B0F19;background:#4ADE80;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;margin-top:20px;">Open AdRoom App</a>
          <script>
            setTimeout(function() { window.location.href = "${appRedirect}"; }, 100);
          </script>
        </body>
      </html>
    `);
  }

  res.status(400).send('Invalid request: No code or error found.');
});

/**
 * Exchange Code for Token (Backend to Facebook)
 */
app.post('/api/auth/facebook/exchange', async (req, res) => {
    const { code, redirectUri } = req.body;
    // Explicitly use process.env and provide a fallback or error if missing
    // In Railway, these must be defined in the Service Variables
    const FB_APP_ID = process.env.FB_APP_ID;
    const FB_APP_SECRET = process.env.FB_APP_SECRET; 

    console.log(`[Token Exchange] Attempting exchange with App ID: ${FB_APP_ID ? 'Present' : 'MISSING'}, Secret: ${FB_APP_SECRET ? 'Present' : 'MISSING'}`);

    if (!code || !redirectUri) {
        return res.status(400).json({ error: 'Missing code or redirectUri' });
    }

    if (!FB_APP_ID || !FB_APP_SECRET) {
        console.error('[Token Exchange] Critical Error: FB_APP_ID or FB_APP_SECRET is not set in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: Missing App Credentials' });
    }

    try {
        const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${FB_APP_SECRET}&code=${code}`;
        const response = await fetch(tokenUrl);
        const data: any = await response.json();

        if (data.error) {
            console.error('Facebook Token Exchange Error:', data.error);
            return res.status(400).json({ error: data.error.message });
        }

        res.json(data);
    } catch (error) {
        console.error('Exchange endpoint error:', error);
        res.status(500).json({ error: 'Internal Server Error during token exchange' });
    }
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
