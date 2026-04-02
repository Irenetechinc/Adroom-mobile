import { CreativeService } from './creative';
import { FacebookService } from './facebook';
import { Strategy } from '../types/agent';
import { supabase } from './supabase';

export const AutonomousService = {
  async executeStrategy(strategy: Strategy, productImageUrl?: string): Promise<void> {
    await this.executeOrganicStrategy(strategy, productImageUrl);
  },

  async executeOrganicStrategy(strategy: Strategy, imageUrl?: string): Promise<void> {
    if (!strategy.brandVoice) {
      throw new Error('Strategy brandVoice is required.');
    }

    try {
        const config = await FacebookService.getConfig();
        if (config) {
            const copy = await CreativeService.generateCopy(strategy.title, strategy.brandVoice, 'AWARENESS');
            
            await FacebookService.createPost(
                config.page_id,
                `${copy.headline}\n\n${copy.body}`,
                imageUrl,
                config.access_token
            );
        } else {
            throw new Error('Facebook config missing.');
        }
    } catch (e) {
        console.error('[Autonomous] Failed to publish organic post:', e);
        throw e;
    }
  },

  async amendStrategy(strategy: Strategy, amendment: string): Promise<Strategy> {
    console.log(`[Autonomous] Amending strategy: ${amendment}`);
    // In production, this would call the AI Brain to re-generate or adjust the strategy
    // For now, we'll manually add the action if it's 'ADD_DAILY_POST'
    const newStrategy = { ...strategy };
    if (amendment === 'ADD_DAILY_POST' && !newStrategy.actions.includes('Daily Post')) {
        newStrategy.actions.push('Daily Post');
    }
    return newStrategy;
  },

  async runAutonomousLoop(): Promise<void> {
    console.log('[Autonomous] Starting background loop...');
    await this.likeAllInteractions();
    await this.replyToComments();
    await this.replyToMessages();
    await this.followUpLeads();
  },

  startRealtimeListeners(): void {
    console.log('[Autonomous] Initializing Real-time UI Listeners...');
    
    supabase
      .channel('public:comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, async (payload: any) => {
        console.log('[Autonomous] Real-time: New comment detected', payload.new);
      })
      .subscribe();

    supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload: any) => {
        console.log('[Autonomous] Real-time: New message detected', payload.new);
      })
      .subscribe();
  },

  async handleNewComment(comment: any): Promise<void> {
    console.log('Unhandled comment event', comment);
  },

  async handleNewMessage(msg: any): Promise<void> {
    console.log('Unhandled message event', msg);
  },

  /**
   * Likes all unliked comments and replies.
   */
  async likeAllInteractions(): Promise<void> {
    try {
        const config = await FacebookService.getConfig();
        if (!config) return;

        // Fetch unliked comments
        const { data: comments, error } = await supabase
            .from('comments')
            .select('*')
            .eq('is_liked', false)
            .limit(10);

        if (error || !comments) return;

        for (const comment of comments) {
            console.log(`[Autonomous] Liking comment: ${comment.id}`);
            const success = await FacebookService.likeObject(comment.external_id, config.access_token);
            
            if (success) {
                await supabase.from('comments').update({ is_liked: true }).eq('id', comment.id);
            }
        }
    } catch (e) {
        console.error('[Autonomous] Like loop error:', e);
    }
  },

  /**
   * Checks for unreplied comments (including nested replies) and generates replies.
   */
  async replyToComments(): Promise<void> {
    try {
        const config = await FacebookService.getConfig();
        if (!config) return;

        const { data: comments, error } = await supabase
            .from('comments')
            .select('*')
            .eq('is_replied', false)
            .limit(5);

        if (error || !comments) return;

        for (const comment of comments) {
            console.log(`[Autonomous] Replying to comment: ${comment.content}`);
            const reply = await CreativeService.generateReply(comment.content);
            
            // Post reply using real FB API
            await FacebookService.postComment(comment.external_id, reply, config.access_token);

            // Update DB
            await supabase.from('comments').update({
                is_replied: true,
                reply_content: reply,
            }).eq('id', comment.id);
        }
    } catch (e) {
        console.error('[Autonomous] Reply loop error:', e);
    }
  },

  /**
   * Checks for unreplied messages and sends replies.
   */
  async replyToMessages(): Promise<void> {
    try {
        const config = await FacebookService.getConfig();
        if (!config) return;

        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('is_replied', false)
            .eq('is_from_page', false) // Only reply to user messages
            .limit(5);

        if (error || !messages) return;

        for (const msg of messages) {
            console.log(`[Autonomous] Replying to message: ${msg.id}`);
            const reply = await CreativeService.generateReply(msg.content, "Helpful"); // Reuse generateReply or make a new one for DM
            
            // Send DM
            await FacebookService.postMessage(msg.sender_id, reply, config.access_token);

            // Update DB
            await supabase.from('messages').update({
                is_replied: true,
            }).eq('id', msg.id);
        }
    } catch (e) {
        console.error('[Autonomous] Message reply loop error:', e);
    }
  },

  /**
   * Checks for stalled leads and sends follow-ups.
   */
  async followUpLeads(): Promise<void> {
    try {
        // Find leads not contacted in 24 hours
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        const { data: leads, error } = await supabase
            .from('leads')
            .select('*')
            .eq('status', 'contacted')
            .lt('last_interaction', yesterday)
            .limit(5);

        if (error || !leads) return;

        for (const lead of leads) {
            console.log(`[Autonomous] Following up with lead: ${lead.id}`);
            
            // Generate follow-up message
            const followUp = await CreativeService.generateCopy("User Interest", "Persuasive", "RE_ENGAGEMENT");
            console.log(`[Autonomous] Generated follow-up: ${followUp.body}`);
            
            // Update status
            await supabase.from('leads').update({
                status: 'follow_up_sent',
                last_interaction: new Date().toISOString(),
                notes: `Follow-up sent: ${followUp.body}`
            }).eq('id', lead.id);
        }
    } catch (e) {
        console.error('[Autonomous] Follow-up loop error:', e);
    }
  }
};
