// OpenAI Client Configuration
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

import { FacebookService } from './facebook';
import { supabase } from './supabase';
import { IntegrityService } from './integrity';

export const EngagementService = {
  /**
   * Monitor comments on active posts and reply autonomously to drive engagement.
   * Now with Context Memory & Real AI.
   */
  async monitorAndReplyToComments(pageId: string): Promise<void> {
    const config = await FacebookService.getConfig();
    if (!config) return;

    try {
      // 1. Get recent posts
      const postsResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/feed?fields=id,message,comments{id,message,can_reply,comment_count,from}&access_token=${config.access_token}`
      );
      
      const postsData = await postsResponse.json();
      if (!postsData.data) return;

      for (const post of postsData.data) {
        if (post.comments && post.comments.data) {
          for (const comment of post.comments.data) {
            if (comment.can_reply) {
              // Check if we have already replied/tracked this interaction
              const hasReplied = await this.checkIfReplied(comment.id);
              
              if (!hasReplied) {
                await this.handleNewInteraction(comment, post.message, config.access_token);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Engagement monitoring error:', error);
    }
  },

  /**
   * Check Supabase if we've already tracked/replied to this interaction ID
   */
  async checkIfReplied(interactionId: string): Promise<boolean> {
    const { data } = await supabase
      .from('interactions')
      .select('id')
      .eq('interaction_id', interactionId)
      .single();
    
    return !!data;
  },

  /**
   * Handle a new comment: Fetch context, Generate Reply, Post, Save History
   */
  async handleNewInteraction(comment: any, postContext: string, accessToken: string): Promise<void> {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;

    // 1. Construct Context History
    // For a simple comment, history starts with the Post + User Comment
    const history = [
      { role: 'system', content: `You are a helpful brand agent. Context: Post says "${postContext}"` },
      { role: 'user', content: comment.message }
    ];

    // 2. Generate Reply using Real AI (OpenAI)
    const replyText = await this.generateContextualReply(history);

    // 3. Integrity Check
    const integrity = await IntegrityService.validateAndFixContent(replyText);
    const finalReply = integrity.cleanedText || replyText;

    // 4. Post Reply to Facebook
    await fetch(
      `https://graph.facebook.com/v18.0/${comment.id}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ 
          message: finalReply,
          access_token: accessToken 
        }),
        headers: { 'Content-Type': 'application/json' }
      }
    );

    // 5. Like the User's Comment
    await this.likeComment(comment.id, accessToken);

    // 6. Save Interaction to Supabase (Memory)
    await supabase.from('interactions').insert({
      user_id: userId,
      interaction_id: comment.id,
      platform: 'facebook',
      type: 'comment',
      context_history: [
        ...history,
        { role: 'assistant', content: finalReply }
      ],
      last_interaction_at: new Date().toISOString()
    });

    console.log(`[Engagement] Replied to comment ${comment.id}: "${finalReply}"`);
  },

  /**
   * Generate a contextual reply using GPT-4o
   */
  async generateContextualReply(history: any[]): Promise<string> {
    if (!OPENAI_API_KEY) {
      return "Thanks for your comment! Let us know if you have any questions.";
    }

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
            ...history,
            { role: "system", content: "Reply naturally and briefly. Encourage further conversation if appropriate." }
          ]
        })
      });

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Reply generation error:', error);
      return "Thanks for reaching out!";
    }
  },

  async likeComment(commentId: string, accessToken: string): Promise<void> {
    await fetch(
      `https://graph.facebook.com/v18.0/${commentId}/likes`,
      {
        method: 'POST',
        body: JSON.stringify({ access_token: accessToken }),
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
