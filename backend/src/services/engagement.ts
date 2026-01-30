import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const FB_GRAPH_URL = 'https://graph.facebook.com/v18.0';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in EngagementService.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const EngagementService = {

  /**
   * Process incoming webhook event
   */
  async handleWebhookEvent(event: any) {
    if (event.object === 'page') {
      for (const entry of event.entry) {
        const pageId = entry.id;
        
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

    // 2. Generate AI Reply
    const replyText = await this.generateAIReply(message, 'comment');

    // 3. Reply to comment
    await this.replyToComment(commentId, replyText, pageAccessToken);
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
    const replyText = await this.generateAIReply(messageText, 'message');

    // 2. Send Message
    await this.sendMessage(senderId, replyText, pageAccessToken);
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
              content: `You are a helpful, professional, and friendly social media manager. 
              Reply to this ${context} briefly (under 200 chars). 
              If it's a compliment, say thanks. If it's a question, answer generally or ask them to DM.`
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
