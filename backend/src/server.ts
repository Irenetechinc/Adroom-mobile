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
    const { userId, amount, description } = req.body;
    const result = await WalletService.deductFunds(userId, Number(amount), description);
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



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
