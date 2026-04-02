import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { StrategyService } from './services/strategy';
import { ProductService } from './services/product';
import { VisionService } from './services/vision';
import { IntegrityService } from './services/integrity';
import { PlatformIntelligenceEngine } from './services/ipeEngine';
import { SocialListeningEngine } from './services/socialListening';
import { EmotionalIntelligenceEngine } from './services/emotionalIntelligence';
import { GeoMonitoringEngine } from './services/geoMonitoring';
import { GoalOptimizationService } from './services/goalOptimization';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''; 
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('CRITICAL ERROR: Supabase Environment Variables Missing in Worker');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const ipeEngine = new PlatformIntelligenceEngine();
const socialEngine = new SocialListeningEngine();
const emotionalEngine = new EmotionalIntelligenceEngine();
const geoEngine = new GeoMonitoringEngine();
const goalOptimizer = new GoalOptimizationService();

/**
 * Worker State to track intervals
 */
const state = {
    lastSocialRun: 0,
    lastEmotionalRun: 0,
    lastGeoRun: 0,
    lastGoalOptRun: 0
};

async function runWorker() {
  console.log('[Worker] Starting autonomous cycle...');
  const now = Date.now();

  // 1. Run Platform Intelligence Engine (Every 15 mins - each cycle)
  try {
    await ipeEngine.runCycle();
  } catch (err) {
    console.error('[Worker] IPE Cycle failed:', err);
  }

  // 2. Run Social Listening (Every 15 mins)
  if (now - state.lastSocialRun > 15 * 60 * 1000) {
      try {
          await socialEngine.runCycle();
          state.lastSocialRun = now;
      } catch (err) {
          console.error('[Worker] Social Listening failed:', err);
      }
  }

  // 3. Run Emotional Intelligence (Every 15 mins)
  if (now - state.lastEmotionalRun > 15 * 60 * 1000) {
      try {
          await emotionalEngine.runCycle();
          state.lastEmotionalRun = now;
      } catch (err) {
          console.error('[Worker] Emotional Intelligence failed:', err);
      }
  }

  // 4. Run GEO Monitoring (Every 15 mins)
  if (now - state.lastGeoRun > 15 * 60 * 1000) {
      try {
          await geoEngine.runCycle();
          state.lastGeoRun = now;
      } catch (err) {
          console.error('[Worker] GEO Monitoring failed:', err);
      }
  }

  // 5. Run Goal Optimization Agents (Every 15 mins)
  if (now - state.lastGoalOptRun > 15 * 60 * 1000) {
      try {
          await goalOptimizer.runOptimizationCycle();
          state.lastGoalOptRun = now;
      } catch (err) {
          console.error('[Worker] Goal Optimization failed:', err);
      }
  }

  // 6. Process Active Strategies
  const { data: strategies } = await supabase
    .from('strategies')
    .select('*')
    .eq('is_active', true);

  if (strategies) {
    for (const strategy of strategies) {
      try {
        // Validate strategy integrity before processing
        const integrityCheck = await IntegrityService.validateAndFixContent(strategy.key_message || '');
        if (!integrityCheck.isValid) {
          console.warn(`[Worker] Strategy ${strategy.id} failed integrity check: ${integrityCheck.issues.join(', ')}`);
          continue;
        }

        const { data: configs } = await supabase
          .from('ad_configs')
          .select('*')
          .eq('user_id', strategy.user_id);

        if (configs) {
          for (const config of configs) {
            // Get product details if available
            const products = await ProductService.getProductMemory(strategy.user_id);
            const activeProduct = products?.[0]; // Default to first product for now

            // Run platform-specific autonomous tasks
            await checkAndExecuteDailyPost(config, strategy, activeProduct);
            await checkAndHandleConversations(supabase, strategy, config);
            await checkAndExecuteLeadFollowUp(supabase, config, strategy);
          }
        }
      } catch (err) {
        console.error(`[Worker] Error processing strategy for user ${strategy.user_id}:`, err);
      }
    }
  }

  console.log('[Worker] Cycle complete.');
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

          if (lead.sender_id) {
             try {
                 // Generate Strategic Follow-up via AI
                 const followUpMessage = await generateDynamicFollowUp(
                    contextDetails, 
                    pastConvos || [], 
                    lead.notes || "",
                    strategy.brand_voice || "",
                    lead.platform
                 );

                 await executePlatformMessage(lead.platform, lead.sender_id, followUpMessage, config);

                 await supabase.from('leads').update({
                    status: 'follow_up_sent',
                    last_interaction: new Date().toISOString(),
                    notes: `Auto follow-up sent: "${followUpMessage.substring(0, 50)}..."`
                 }).eq('id', lead.id);
                 
             } catch (e) {
                 console.error(`[Worker] Failed to message lead ${lead.id} on ${lead.platform}`, e);
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
            console.log(`[Worker] Replying to comment: ${comment.id} on ${config.platform}`);
            
            // Generate Context-Aware Reply
            const reply = await generateDynamicReply(strategy, comment.content, config.platform);
            
            if (reply) {
                try {
                    await executePlatformReply(config.platform, comment.external_id, reply, config);
                    
                    await supabase.from('comments').update({
                        is_replied: true,
                        reply_content: reply,
                        notes: `Auto-replied on ${config.platform} based on strategy context`
                    }).eq('id', comment.id);
                } catch (e) {
                    console.error(`[Worker] Failed to reply to comment ${comment.id} on ${config.platform}:`, e);
                }
            }
        }
    }
}

async function executePlatformReply(platform: string, commentId: string, message: string, config: any) {
    const accessToken = config.access_token;
    
    if (platform === 'facebook' || platform === 'instagram') {
        const url = `https://graph.facebook.com/v18.0/${commentId}/comments`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, access_token: accessToken })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'tiktok') {
        const url = 'https://business-api.tiktok.com/open_api/v1.3/business/comment/reply/';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment_id: commentId, text: message })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'linkedin') {
        // LinkedIn UGC Post Comments API
        const actor = typeof config.page_id === 'string' && config.page_id.startsWith('urn:')
            ? config.page_id
            : `urn:li:organization:${config.page_id}`;
        const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(commentId)}/comments`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor, message: { text: message } })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'twitter' || platform === 'x') {
        // Twitter API v2 Manage Tweets (Reply)
        const url = 'https://api.twitter.com/2/tweets';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message, reply: { in_reply_to_tweet_id: commentId } })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    }
}

async function executePlatformMessage(platform: string, recipientId: string, message: string, config: any) {
    const accessToken = config.access_token;

    if (platform === 'facebook' || platform === 'instagram') {
        const url = 'https://graph.facebook.com/v18.0/me/messages';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: message },
                access_token: accessToken
            })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'tiktok') {
        // TikTok Direct Message API (requires specific permissions)
        const url = 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: recipientId, text: message })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'twitter' || platform === 'x') {
        // Twitter Direct Messages API
        const url = 'https://api.twitter.com/2/dm_conversations/with/' + recipientId + '/messages';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    }
}

async function generateDynamicReply(strategy: any, comment: string, platform: string): Promise<string | null> {
    if (!OPENAI_API_KEY || !OPENAI_TEXT_MODEL) {
        throw new Error('OPENAI_API_KEY and OPENAI_TEXT_MODEL are required for dynamic replies.');
    }

    try {
        const prompt = `
            You are an engaging human social media manager for a brand on ${platform}. 
            A user left a comment on your post. Reply in a natural, helpful tone that aligns with the strategy and ${platform} culture.
            
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
                model: OPENAI_TEXT_MODEL,
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

async function generateDynamicFollowUp(context: string, convos: any[], notes: string, brandVoice: string, platform: string): Promise<string> {
    if (!OPENAI_API_KEY || !OPENAI_TEXT_MODEL) {
        throw new Error('OPENAI_API_KEY and OPENAI_TEXT_MODEL are required for dynamic follow-ups.');
    }

    try {
        const prompt = `
            You are the AdRoom AI Sales Assistant on ${platform}. Generate a strategic, personalized follow-up message for a lead.
            The message must be dynamic and based on past conversations to rekindle the interest in a way that fits ${platform} standards.
            
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
                model: OPENAI_TEXT_MODEL,
                messages: [{ role: "system", content: prompt }]
            })
        });

        const data: any = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('OpenAI returned an empty follow-up message.');
        }
        return content;
    } catch (e) {
        throw e;
    }
}

async function checkAndExecuteDailyPost(config: any, strategy: any, product?: any) {
  const platform = config.platform;
  const pageId = config.page_id || config.ad_account_id;
  const accessToken = config.access_token;

  // 1. Check last post
  let shouldPost = true;
  try {
      if (platform === 'facebook' || platform === 'instagram') {
          const feedResponse = await fetch(
            `https://graph.facebook.com/v18.0/${pageId}/feed?limit=1&access_token=${accessToken}`
          );
          const feedData: any = await feedResponse.json();
          if (feedData.data && feedData.data.length > 0) {
            const lastPostTime = new Date(feedData.data[0].created_time).getTime();
            if (lastPostTime > Date.now() - (24 * 60 * 60 * 1000)) shouldPost = false;
          }
      } else if (platform === 'tiktok') {
          // Check TikTok business posts
          const response = await fetch(`https://business-api.tiktok.com/open_api/v1.3/business/video/list/?advertiser_id=${pageId}`, {
              headers: { 'Access-Token': accessToken }
          });
          const data = await response.json();
          if (data.data?.list?.length > 0) {
              const lastPostTime = new Date(data.data.list[0].create_time * 1000).getTime();
              if (lastPostTime > Date.now() - (24 * 60 * 60 * 1000)) shouldPost = false;
          }
      }
  } catch (e) {
      console.warn(`[Worker] Failed to check post history on ${platform}:`, e);
  }

    if (shouldPost) {
        console.log(`[Worker] User ${config.user_id}: Generating daily post for ${platform}...`);
        
        // Fetch current platform intelligence for organic optimization
        const { data: intelligence } = await supabase
            .from('platform_intelligence')
            .select('*')
            .eq('platform', platform)
            .order('captured_at', { ascending: false })
            .limit(1)
            .single();

        // Use Vision Service for richer context if product image is available
        let visionContext = "";
        if (product && product.images && product.images.length > 0) {
            try {
                const analysis = await VisionService.analyzeProductImage(product.images[0]);
                visionContext = `Product Analysis: ${analysis.description}. Attributes: ${analysis.suggested_target_audience}.`;
            } catch (err) {
                console.warn(`[Worker] Vision analysis failed:`, err);
            }
        }

        const content = await generateContent(strategy.brand_voice, strategy.title, platform, intelligence, visionContext);
        
        try {
            await executePlatformPost(platform, content, config);
            console.log(`[Worker] User ${config.user_id}: Posted successfully on ${platform}.`);
        } catch (e) {
            console.error(`[Worker] Failed to post on ${platform} for user ${config.user_id}:`, e);
        }
    }
}

async function executePlatformPost(platform: string, content: string, config: any) {
    const accessToken = config.access_token;
    const pageId = config.page_id || config.ad_account_id;

    if (platform === 'facebook' || platform === 'instagram') {
        const res = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: content, access_token: accessToken })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'tiktok') {
        // TikTok Video Publish API (Requires video upload flow)
        // Production implementation for TikTok Content Posting
        const publishUrl = `https://business-api.tiktok.com/open_api/v1.3/business/video/publish/?advertiser_id=${pageId}`;
        const res = await fetch(publishUrl, {
            method: 'POST',
            headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                video_id: config.last_generated_video_id, 
                title: content.substring(0, 100) 
            })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'linkedin') {
        const url = 'https://api.linkedin.com/v2/ugcPosts';
        const author = typeof pageId === 'string' && pageId.startsWith('urn:')
            ? pageId
            : `urn:li:organization:${pageId}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                author,
                lifecycleState: 'PUBLISHED',
                specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                        shareCommentary: { text: content },
                        shareMediaCategory: 'NONE'
                    }
                },
                visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
            })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    } else if (platform === 'twitter' || platform === 'x') {
        const url = 'https://api.twitter.com/2/tweets';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: content })
        });
        if (!res.ok) throw new Error(`Platform API error: ${res.statusText}`);
    }
}

async function generateContent(tone: string, topic: string, platform: string, intelligence?: any, visionContext?: string): Promise<string> {
    if (!OPENAI_API_KEY) return `Daily Update on ${platform}: ${topic}`;

    try {
        const systemPrompt = `
            You are a master social media growth hacker. Your goal is to write a post for ${platform} that achieves MAXIMUM organic reach, outperforming paid ads.
            
            PLATFORM INTELLIGENCE: ${JSON.stringify(intelligence || {})}
            PRODUCT CONTEXT: ${visionContext || 'N/A'}
            
            STRATEGIC GUIDELINES:
            - Use current algorithmic priorities (e.g., specific keywords, formatting).
            - Focus on high-engagement "loops" or "hooks".
            - If ${platform} favors specific formats (Video/Carousel), structure the text to match.
            - Optimize for ${platform} SEO (Relevant keywords/hashtags).
            - Ensure NO DUMMY DATA or PLACEHOLDERS are used.
        `;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Topic: ${topic}. Tone: ${tone}. Write the post now.` }
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
