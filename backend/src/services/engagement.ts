
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const FB_GRAPH_URL = 'https://graph.facebook.com/v18.0';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('Warning: Supabase credentials missing. Engagement features will be disabled.');
  }

const getSupabase = () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase credentials missing. Check your environment variables.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
};

import { DecisionEngine } from './decisionEngine';

const decisionEngine = new DecisionEngine();

export const EngagementService = {

  async handleWebhookEvent(event: any) {
    if (event.object === 'page') {
      const supabase = getSupabase();
      for (const entry of event.entry) {
        const pageId = entry.id;
        
        const { data: config } = await supabase
          .from('ad_configs')
          .select('*')
          .eq('page_id', pageId)
          .single();

        if (!config) continue;

        const pageAccessToken = await this.getPageAccessToken(config.access_token, pageId);

        for (const change of entry.changes) {
          if (change.field === 'feed') {
            await this.handleFeedChange(change.value, pageAccessToken, config.user_id);
          } else if (change.field === 'messages') {
            await this.handleMessage(change.value, pageAccessToken, config.user_id);
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
    return userAccessToken; 
  },

  /**
   * Handle Comments and Posts on Page Feed
   */
  async handleFeedChange(value: any, pageAccessToken: string, userId: string) {
    const item = value.item; 
    const verb = value.verb; 
    
    if (verb !== 'add' || item !== 'comment') return;

    const commentId = value.comment_id;
    const message = value.message;
    const senderId = value.from.id;
    
    // 1. Fetch User History (Conversation History Tracking)
    const userHistory = await this.getUserHistory(senderId);

    // 2. Generate AI Reply (with history context)
    const replyText = await decisionEngine.generateEngagementReply(message, 'comment', userHistory);

    // 3. Post Reply
    await this.replyToComment(commentId, replyText, pageAccessToken);
    await this.likeObject(commentId, pageAccessToken);

    // 4. Store Interaction (Learning from Outcomes)
    await this.logInteraction(userId, senderId, 'comment', message, replyText, commentId);
  },

  /**
   * Handle Private Messages
   */
  async handleMessage(value: any, pageAccessToken: string, userId: string) {
    const senderId = value.sender?.id;
    const messageText = value.message?.text;

    if (!senderId || !messageText) return;

    // 1. Fetch User History (Conversation History Tracking)
    const userHistory = await this.getUserHistory(senderId);

    // 2. Generate AI Reply (with history context)
    const replyText = await decisionEngine.generateEngagementReply(messageText, 'message', userHistory);

    // 3. Send Message
    await this.sendMessage(senderId, replyText, pageAccessToken);

    // 4. Store Interaction (Learning from Outcomes)
    await this.logInteraction(userId, senderId, 'message', messageText, replyText, senderId);
  },

  /**
   * Fetches past interactions for this user to provide context to AI
   */
  async getUserHistory(externalUserId: string) {
      const supabase = getSupabase();
      const { data } = await supabase
          .from('engagement_logs')
          .select('input_text, reply_text, sentiment, created_at')
          .eq('external_user_id', externalUserId)
          .order('created_at', { ascending: false })
          .limit(5);
      
      return data || [];
  },

  /**
   * Logs interaction for history tracking and learning
   */
  async logInteraction(userId: string, externalUserId: string, type: 'comment'|'message', input: string, reply: string, externalId: string) {
      const supabase = getSupabase();
      
      // Calculate simple sentiment (could use AI here too if needed, but keeping it light)
      // For now we store raw text, AI analyzes history later.
      
      await supabase.from('engagement_logs').insert({
          user_id: userId,
          external_user_id: externalUserId,
          interaction_type: type,
          external_id: externalId,
          input_text: input,
          reply_text: reply,
          created_at: new Date().toISOString()
      });
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
   * Database Trigger Handlers
   */
  async handleDatabaseComment(record: any) {
    console.log(`[DB Webhook] Processing comment: ${record.id}`);
    const supabase = getSupabase();
    
    // Fetch platform config for this user
    const { data: config } = await supabase
      .from('ad_configs')
      .select('*')
      .eq('user_id', record.user_id)
      .eq('platform', record.platform || 'facebook')
      .single();

    if (!config) return;

    // Generate AI Reply
    const userHistory = await this.getUserHistory(record.sender_id);
    const replyText = await decisionEngine.generateEngagementReply(record.content, 'comment', userHistory);

    // Post to platform
    if (config.platform === 'facebook' || config.platform === 'instagram') {
        await this.replyToComment(record.external_id, replyText, config.access_token);
    }
    
    // Update record
    await supabase.from('comments').update({
        is_replied: true,
        reply_content: replyText
    }).eq('id', record.id);
  },

  async handleDatabaseMessage(record: any) {
    console.log(`[DB Webhook] Processing message: ${record.id}`);
    const supabase = getSupabase();

    const { data: config } = await supabase
      .from('ad_configs')
      .select('*')
      .eq('user_id', record.user_id)
      .eq('platform', record.platform || 'facebook')
      .single();

    if (!config) return;

    const userHistory = await this.getUserHistory(record.sender_id);
    const replyText = await decisionEngine.generateEngagementReply(record.content, 'message', userHistory);

    if (config.platform === 'facebook' || config.platform === 'instagram') {
        await this.sendMessage(record.sender_id, replyText, config.access_token);
    }

    await supabase.from('messages').update({
        is_replied: true,
        reply_content: replyText
    }).eq('id', record.id);
  }
};
