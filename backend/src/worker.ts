import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Polyfill fetch for Node environment if needed (Node 18+ has it global, but for safety)
if (!globalThis.fetch) {
  (globalThis as any).fetch = fetch;
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''; // Must use Service Key for backend worker
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('CRITICAL ERROR: Supabase Environment Variables Missing in Worker');
  console.error('Checked SUPABASE_URL, EXPO_PUBLIC_SUPABASE_URL:', SUPABASE_URL ? 'Found' : 'Missing');
  console.error('Checked SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_KEY, EXPO_PUBLIC_SUPABASE_ANON_KEY:', SUPABASE_SERVICE_KEY ? 'Found' : 'Missing');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Main Worker Loop
 * Runs every X minutes to perform autonomous tasks for all active users.
 */
async function runWorker() {
  console.log('[Worker] Starting autonomous cycle...');

  // 1. Fetch all users with active strategies
  const { data: strategies, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('[Worker] Failed to fetch strategies:', error);
    return;
  }

  console.log(`[Worker] Found ${strategies?.length || 0} active strategies.`);

  if (strategies) {
    for (const strategy of strategies) {
      console.log(`[Worker] Processing strategy for User ${strategy.user_id}: ${strategy.title} (${strategy.type})`);
      
      try {
        // Fetch User's Facebook Config
        const { data: fbConfig } = await supabase
          .from('ad_accounts')
          .select('*')
          .eq('user_id', strategy.user_id)
          .single();

        if (fbConfig) {
          // Perform Autonomous Tasks
          // Task A: Daily Post Check
          await checkAndExecuteDailyPost(fbConfig, strategy);
          
          // Task B: Lead Follow-up
          await checkAndExecuteLeadFollowUp(supabase, fbConfig);
        }
      } catch (err) {
        console.error(`[Worker] Error processing user ${strategy.user_id}:`, err);
      }
    }
  }

  console.log('[Worker] Cycle complete. Sleeping...');
}

// --- Simplified Service Logic for Worker Context ---

async function checkAndExecuteLeadFollowUp(supabase: any, config: any) {
  // Lead Follow-up Logic
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'contacted')
      .eq('user_id', config.user_id)
      .lt('last_interaction', yesterday)
      .limit(10);

  if (leads && leads.length > 0) {
      for (const lead of leads) {
          console.log(`[Worker] Following up lead: ${lead.id}`);
          
          if (lead.platform === 'facebook' && lead.sender_id) {
             try {
                 // Send follow-up message via Facebook API
                 await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recipient: { id: lead.sender_id },
                        message: { text: "Hi! Just checking in to see if you have any questions about our products." },
                        access_token: config.access_token
                    })
                 });

                 await supabase.from('leads').update({
                    status: 'follow_up_sent',
                    last_interaction: new Date().toISOString(),
                    notes: 'Auto follow-up sent via Backend Worker'
                 }).eq('id', lead.id);
                 
             } catch (e) {
                 console.error(`[Worker] Failed to message lead ${lead.id}`, e);
             }
          }
      }
  }
}

async function checkAndExecuteDailyPost(config: any, strategy: any) {
  // Logic mirrored from SchedulerService but adapted for Node backend
  const pageId = config.page_id;
  const accessToken = config.access_token;

  // 1. Check last post
  const feedResponse = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/feed?limit=1&access_token=${accessToken}`
  );
  const feedData: any = await feedResponse.json();
  
  let shouldPost = true;
  if (feedData.data && feedData.data.length > 0) {
    const lastPostTime = new Date(feedData.data[0].created_time).getTime();
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    
    if (lastPostTime > oneDayAgo) {
      shouldPost = false;
      console.log(`[Worker] User ${config.user_id}: Post already exists today.`);
    }
  }

  if (shouldPost) {
    console.log(`[Worker] User ${config.user_id}: Generating daily post...`);
    // Call OpenAI to generate content
    const content = await generateContent(strategy.brand_voice, strategy.title);
    
    // Post to FB
    await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/feed`,
      {
        method: 'POST',
        body: JSON.stringify({ 
          message: content,
          access_token: accessToken 
        }),
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log(`[Worker] User ${config.user_id}: Posted successfully.`);
  }
}

async function generateContent(tone: string, topic: string): Promise<string> {
  if (!OPENAI_API_KEY) return `Daily Update: ${topic}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Write a short, engaging Facebook post." },
          { role: "user", content: `Topic: ${topic}. Tone: ${tone}.` }
        ]
      })
    });
    const data: any = await response.json();
    return data.choices[0].message.content;
  } catch (e) {
    return `Stay tuned for updates on ${topic}!`;
  }
}

// --- Execution ---

// Run immediately on start
runWorker();

// Then run every 15 minutes (in production)
setInterval(runWorker, 15 * 60 * 1000);
