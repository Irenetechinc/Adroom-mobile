import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { EngagementService } from './services/engagement';

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
