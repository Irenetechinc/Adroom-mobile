import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const FB_GRAPH_URL = 'https://graph.facebook.com/v18.0';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('Warning: Supabase credentials missing. Engagement features will be disabled.');
    // Do not log "Missing" errors here to avoid confusion if user is just setting up
    // console.error('SUPABASE_URL:', SUPABASE_URL ? 'Set' : 'Missing');
    // console.error('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'Set' : 'Missing');
  }

// Lazy initialization to prevent crash on import if variables are missing
// but still allows the server to start (even if this service won't work)
const getSupabase = () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase credentials missing. Check your environment variables.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
};

export const EngagementService = {

  /**
   * Process incoming webhook event
   */
  async handleWebhookEvent(event: any) {
    if (event.object === 'page') {
      const supabase = getSupabase();
      for (const entry of event.entry) {
        const pageId = entry.id;
        console.log(`[Engagement] Processing event for Page ID: ${pageId}`);
        
        // Find the user config for this page to get the Page Access Token
        // We use the service key so we can query all configs
        const { data: config } = await supabase
          .from('ad_configs')
          .select('*')
          .eq('page_id', pageId)
          .single();

        if (!config) {
          console.log(`[Engagement] No config found for Page ID ${pageId}`);
          continue;
        }

        // Get Page Access Token
        // In a real scenario, you might need to exchange the user token for a page token
        // if you haven't stored the specific page token.
        // For now, we assume access_token in config is sufficient or we fetch a fresh one.
        const pageAccessToken = await this.getPageAccessToken(config.access_token, pageId);

        for (const change of entry.changes) {
          if (change.field === 'feed') {
            await this.handleFeedChange(change.value, pageAccessToken);
          } else if (change.field === 'messages') {
            await this.handleMessage(change.value, pageAccessToken);
          }
        }
      }
    }
  },

  async getPageAccessToken(userAccessToken: string, pageId: string): Promise<string> {
    try {
      const response = await fetch(
        `${FB_GRAPH_URL}/me/accounts?access_token=${userAccessToken}&fields=id,access_token`
      );
      const data: any = await response.json();
      if (data.data) {
        const page = data.data.find((p: any) => p.id === pageId);
        if (page) return page.access_token;
      }
    } catch (e) {
      console.error('Error fetching page access token:', e);
    }
    return userAccessToken; // Fallback (might work for some actions if user is admin)
  },

  /**
   * Handle Comments and Posts on Page Feed
   */
  async handleFeedChange(value: any, pageAccessToken: string) {
    const item = value.item; // 'comment' or 'post'
    const verb = value.verb; // 'add'
    
    // We only care about new comments for now
    if (verb !== 'add' || item !== 'comment') return;

    const commentId = value.comment_id;
    const message = value.message;
    const senderId = value.from.id;

    // Avoid replying to ourselves (if senderId matches pageId - logic omitted for brevity but important)
    
    console.log(`[Engagement] New comment on ${commentId}: "${message}"`);

    // 1. Like the comment immediately
    await this.likeObject(commentId, pageAccessToken);

    // 2. Save to Supabase (for UI real-time updates)
    const supabase = getSupabase();
    await supabase.from('comments').insert({
        external_id: commentId,
        content: message,
        author_name: senderId, // We might need a separate call to get name, but ID is ok for now
        is_liked: true,
        is_replied: false,
        platform: 'facebook'
        // user_id is missing here, we might need to derive it from the page config
    });

    // 3. Generate AI Reply
    const replyText = await this.generateAIReply(message, 'comment');

    // 4. Reply to comment
    await this.replyToComment(commentId, replyText, pageAccessToken);

    // 5. Update Supabase
    await supabase.from('comments').update({
        is_replied: true,
        reply_content: replyText
    }).eq('external_id', commentId);
  },

  /**
   * Handle Private Messages
   */
  async handleMessage(value: any, pageAccessToken: string) {
    // Basic structure of messaging webhook
    const senderId = value.sender?.id;
    const messageText = value.message?.text;

    if (!senderId || !messageText) return;

    console.log(`[Engagement] New message from ${senderId}: "${messageText}"`);

    // 1. Generate AI Reply
    console.log(`[Engagement] Generating AI reply for DM: "${messageText}"`);
    const replyText = await this.generateAIReply(messageText, 'message');
    console.log(`[Engagement] AI DM Reply Generated: "${replyText}"`);

    // 2. Send Message
    console.log(`[Engagement] Sending DM to ${senderId}...`);
    await this.sendMessage(senderId, replyText, pageAccessToken);
  },

  /**
   * Handle Database Triggered Comment
   */
  async handleDatabaseComment(record: any) {
    // If already replied or liked, skip
    if (record.is_replied || record.is_liked) return;

    // We need config to act
    const supabase = getSupabase();
    // Assuming record has user_id or we find via external_id (if we saved it)
    // For now, let's assume we can find config via user_id if present
    // If user_id is missing (e.g. from FB webhook insertion), we might need to look up by page... 
    // BUT wait, if it came from FB Webhook, we already handled it in handleWebhookEvent!
    // This DB trigger is mostly useful if we inserted it from somewhere else without replying immediately.
    
    // Simplification: We'll assume this is a "catch-all" or for manually inserted comments.
    
    // Logic similar to handleFeedChange but starting from DB record
    console.log('[Engagement] Handling DB Comment:', record.id);
    
    // TODO: Implementation depends on how we map DB record back to FB Page Token
    // For MVP, we might skip this if handleWebhookEvent covers the main flow.
  },

  async handleDatabaseMessage(record: any) {
      if (record.is_replied || record.is_from_page) return;
      console.log('[Engagement] Handling DB Message:', record.id);
      
      const supabase = getSupabase();
      const { data: config } = await supabase
          .from('ad_configs')
          .select('*')
          .eq('user_id', record.user_id)
          .single();

      if (!config) return;

      // Generate Reply
      const reply = await this.generateAIReply(record.content, 'message');
      
      // Send
      await this.sendMessage(record.sender_name, reply, config.access_token); // sender_name might hold ID in some schemas

      // Update
      await supabase.from('messages').update({ is_replied: true }).eq('id', record.id);
  },

  /**
   * Facebook API Wrappers
   */
  async replyToComment(commentId: string, message: string, token: string) {
    await fetch(`${FB_GRAPH_URL}/${commentId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: token })
    });
  },

  async likeObject(objectId: string, token: string) {
    await fetch(`${FB_GRAPH_URL}/${objectId}/likes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token })
    });
  },

  async sendMessage(recipientId: string, text: string, token: string) {
    await fetch(`${FB_GRAPH_URL}/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: token
      })
    });
  },

  /**
   * AI Logic
   */
  async generateAIReply(input: string, context: 'comment' | 'message'): Promise<string> {
    if (!OPENAI_API_KEY) return "Thanks for reaching out!";

    try {
      const systemPrompt = context === 'comment' 
        ? "You are an engaging human social media manager. Reply to the comment naturally. Keep it short. Do NOT sound like a bot. Do NOT use robotic language."
        : "You are a helpful customer support agent for the brand. Reply to the DM warmly and helpfully. Do NOT sound like a bot.";

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            { role: "user", content: input }
          ]
        })
      });
      
      const data: any = await response.json();
      return data.choices?.[0]?.message?.content || "Thanks!";
    } catch (e) {
      console.error('AI Reply Error:', e);
      return "Thanks for your message!";
    }
  }
};
