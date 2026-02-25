import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { FacebookAdsApi } from './services/facebookApi';
import { StrategyService } from './services/strategy';
import { ProductService } from './services/product';
import { VisionService } from './services/vision';
import { IntegrityService } from './services/integrity';
import { PlatformIntelligenceEngine } from './services/ipeEngine';

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
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const ipeEngine = new PlatformIntelligenceEngine();

/**
 * Main Worker Loop
 * Runs every X minutes to perform autonomous tasks for all active users.
 */
async function runWorker() {
  console.log('[Worker] Starting autonomous cycle...');

  // 1. Run Platform Intelligence Engine (IPE) to detect shifts
  try {
    await ipeEngine.runCycle();
  } catch (err) {
    console.error('[Worker] IPE Cycle failed:', err);
  }

  // 2. Fetch all users with active strategies
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
        // 1. Fetch User's Facebook Config
        const { data: fbConfig } = await supabase
          .from('ad_configs')
          .select('*')
          .eq('user_id', strategy.user_id)
          .maybeSingle();

        // Fetch all unreplied comments or comments needing a follow-up
        await checkAndHandleConversations(supabase, strategy, fbConfig);

        if (fbConfig) {
          // 2. Check for pending autonomous optimizations from IPE
          await applyPendingOptimizations(supabase, fbConfig, strategy);

          // 3. Perform Autonomous Tasks
          // Task A: Daily Post Check
          await checkAndExecuteDailyPost(fbConfig, strategy);
          
          // Task B: Lead Follow-up
          await checkAndExecuteLeadFollowUp(supabase, fbConfig, strategy);
        }
      } catch (err) {
        console.error(`[Worker] Error processing user ${strategy.user_id}:`, err);
      }
    }
  }

  console.log('[Worker] Cycle complete. Sleeping...');
}

async function applyPendingOptimizations(supabase: any, config: any, strategy: any) {
  // Fetch optimizations marked as 'applied_automatically' but not yet executed in platform
  const { data: pending } = await supabase
      .from('strategy_optimizations')
      .select('*')
      .eq('strategy_id', strategy.id)
      .eq('status', 'applied_automatically')
      .is('executed_at', null);

  if (!pending || pending.length === 0) return;

  for (const opt of pending) {
      console.log(`[Worker] Executing autonomous optimization: ${opt.action_taken}`);
      
      try {
          // 1. Identify Target Campaign
          const { data: campaign } = await supabase
            .from('campaigns')
            .select('*')
            .eq('user_id', config.user_id)
            .limit(1)
            .maybeSingle();

          if (!campaign) {
            console.warn(`[Worker] No campaign found for user ${config.user_id} to optimize.`);
            continue;
          }

          // 2. Parse Recommendation into API Parameters via AI
          const apiParams = await translateRecommendationToApi(
            opt.action_taken, 
            campaign.facebook_campaign_id, 
            config.access_token,
            strategy.brand_voice || ""
          );
          
          if (apiParams) {
              // 3. Execute Platform API Call
              if (apiParams.type === 'campaign') {
                  await FacebookAdsApi.updateCampaign(config.access_token, apiParams.id, apiParams.updates);
              } else if (apiParams.type === 'adset') {
                  await FacebookAdsApi.updateAdSet(config.access_token, apiParams.id, apiParams.updates);
              }
              
              console.log(`[Worker] Successfully executed platform optimization for ${apiParams.type} ${apiParams.id}`);

              await supabase.from('strategy_optimizations').update({
                  executed_at: new Date().toISOString(),
                  status: 'executed',
                  execution_log: JSON.stringify(apiParams)
              }).eq('id', opt.id);
          }
          
      } catch (e) {
          console.error(`[Worker] Optimization execution failed for ${opt.id}`, e);
          await supabase.from('strategy_optimizations').update({
              status: 'failed',
              execution_log: JSON.stringify({ error: (e as Error).message })
          }).eq('id', opt.id);
      }
  }
}

async function translateRecommendationToApi(recommendation: string, campaignId: string, accessToken: string, brandVoice: string): Promise<any> {
    if (!OPENAI_API_KEY) return null;

    try {
        // Fetch AdSets to give context to AI if it wants to optimize an AdSet
        const adSets = await FacebookAdsApi.getAdSets(accessToken, campaignId);

        const prompt = `
            Translate the following natural language marketing recommendation into a structured Facebook Ads API update.
            
            RECOMMENDATION: "${recommendation}"
            CAMPAIGN_ID: "${campaignId}"
            ACTIVE_ADSETS: ${JSON.stringify(adSets)}
            BRAND_VOICE: "${brandVoice}"
            
            Return JSON in this format:
            {
                "type": "campaign" | "adset",
                "id": "specific_id_to_update",
                "updates": {
                    "daily_budget": number, // if budget update
                    "status": "ACTIVE" | "PAUSED", // if status update
                    "name": "string" // etc
                },
                "reasoning": "string"
            }
            
            If the recommendation is vague or cannot be translated to a budget/status/name update, return null.
        `;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        const data: any = await response.json();
        const result = JSON.parse(data.choices[0].message.content);
        return result;
    } catch (e) {
        console.error('[Worker] Translation Error:', e);
        return null;
    }
}

// --- Simplified Service Logic for Worker Context ---

async function checkAndExecuteLeadFollowUp(supabase: any, config: any, strategy: any) {
  // Lead Follow-up Logic: Memory-Aware and Dynamic
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: leads } = await supabase
      .from('leads')
      .select('*, product_id, service_id, brand_id')
      .eq('status', 'contacted')
      .eq('user_id', config.user_id)
      .lt('last_interaction', yesterday)
      .limit(10);

  if (leads && leads.length > 0) {
      for (const lead of leads) {
          console.log(`[Worker] Following up lead: ${lead.id}`);
          
          // Retrieve Past Conversations for this specific lead/product
          const { data: pastConvos } = await supabase
            .from('chat_history')
            .select('text, sender')
            .eq('user_id', config.user_id)
            .order('created_at', { ascending: false })
            .limit(10);

          // Get Product/Service Context
          let contextDetails = "";
          if (lead.product_id) {
            const { data: p } = await supabase.from('product_memory').select('product_name, description').eq('product_id', lead.product_id).single();
            if (p) contextDetails = `Product: ${p.product_name}, Description: ${p.description}`;
          }

          if (lead.platform === 'facebook' && lead.sender_id) {
             try {
                 // Generate Strategic Follow-up via AI
                 const followUpMessage = await generateDynamicFollowUp(
                    contextDetails, 
                    pastConvos || [], 
                    lead.notes || "",
                    strategy.brand_voice || ""
                 );

                 await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recipient: { id: lead.sender_id },
                        message: { text: followUpMessage },
                        access_token: config.access_token
                    })
                 });

                 await supabase.from('leads').update({
                    status: 'follow_up_sent',
                    last_interaction: new Date().toISOString(),
                    notes: `Auto follow-up sent: "${followUpMessage.substring(0, 50)}..."`
                 }).eq('id', lead.id);
                 
             } catch (e) {
                 console.error(`[Worker] Failed to message lead ${lead.id}`, e);
             }
          }
      }
  }
}

async function checkAndHandleConversations(supabase: any, strategy: any, config?: any) {
    // 1. Fetch unreplied comments or comments needing a follow-up
    const { data: comments } = await supabase
        .from('comments')
        .select('*')
        .eq('user_id', strategy.user_id)
        .eq('is_replied', false)
        .limit(5);

    if (comments && comments.length > 0) {
        for (const comment of comments) {
            console.log(`[Worker] Replying to comment: ${comment.id}`);
            
            // Generate Context-Aware Reply
            const reply = await generateDynamicReply(strategy, comment.content);
            
            if (reply) {
                // If config is provided, we could post to FB API here
                if (config?.access_token) {
                    // await FacebookAdsApi.postCommentReply(config.access_token, comment.external_id, reply);
                }
                
                await supabase.from('comments').update({
                    is_replied: true,
                    reply_content: reply,
                    notes: 'Auto-replied based on strategy context'
                }).eq('id', comment.id);
            }
        }
    }
}

async function generateDynamicReply(strategy: any, comment: string): Promise<string | null> {
    if (!OPENAI_API_KEY) return null;

    try {
        const prompt = `
            You are an engaging human social media manager for a brand. 
            A user left a comment on your post. Reply in a natural, helpful tone that aligns with the strategy.
            
            STRATEGY TITLE: ${strategy.title}
            BRAND VOICE: ${strategy.brand_voice}
            KEY MESSAGE: ${strategy.key_message}
            COMMENT: "${comment}"
            
            Guidelines:
            - Be authentic and human.
            - Encourage further engagement.
            - Keep it under 250 characters.
        `;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: prompt }]
            })
        });

        const data: any = await response.json();
        return data.choices[0].message.content;
    } catch (e) {
        console.error('[Worker] Reply Error:', e);
        return null;
    }
}

async function generateDynamicFollowUp(context: string, convos: any[], notes: string, brandVoice: string): Promise<string> {
    if (!OPENAI_API_KEY) return "Hi! Just checking in to see if you have any questions about our products.";

    try {
        const prompt = `
            You are the AdRoom AI Sales Assistant. Generate a strategic, personalized follow-up message for a lead.
            The message must be dynamic and based on past conversations to rekindle the interest.
            
            CONTEXT: ${context}
            BRAND VOICE: ${brandVoice}
            PAST CONVERSATIONS: ${JSON.stringify(convos)}
            LEAD NOTES: ${notes}
            
            Guidelines:
            - Refer to past points of interest if mentioned.
            - Do NOT sound like a bot.
            - Keep it under 200 characters.
            - Be helpful and non-intrusive.
        `;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: prompt }]
            })
        });

        const data: any = await response.json();
        return data.choices[0].message.content || "Hi! Just checking in. Any thoughts on our previous chat?";
    } catch (e) {
        return "Hi! Just checking in to see if you have any questions.";
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
