import { CampaignService } from './campaign';
import { AdSetService } from './adSet';
import { AdService } from './ad';
import { CreativeService } from './creative';
import { FacebookService } from './facebook';
import { CampaignObjective, CampaignStatus } from '../types/campaign';
import { BillingEvent, OptimizationGoal } from '../types/adSet';
import { Strategy } from '../types/agent';
import { supabase } from './supabase';

export const AutonomousService = {
  /**
   * Execute the selected strategy by creating Campaign, AdSets, and Ads autonomously.
   */
  async executeStrategy(strategy: Strategy, productImageUrl?: string): Promise<void> {
    if (strategy.type === 'FREE') {
      await this.executeOrganicStrategy(strategy, productImageUrl);
    } else {
      if (!productImageUrl) {
        throw new Error('Product image is required for paid campaigns. Please ensure an image was analyzed in the chat.');
      }
      await this.executePaidStrategy(strategy, productImageUrl);
    }
  },

  /**
   * Autonomously Amend Strategy
   * Used when a required action (e.g. Daily Post) is not in the current strategy plan.
   */
  async amendStrategy(currentStrategy: Strategy, reason: string): Promise<Strategy> {
    console.log(`[Autonomous] Amending strategy '${currentStrategy.title}'. Reason: ${reason}`);
    
    // Create a copy to amend
    const amendedStrategy = { ...currentStrategy };
    
    // Logic to amend based on reason
    if (reason === 'ADD_DAILY_POST') {
      if (!amendedStrategy.actions.includes('Daily Post')) {
         amendedStrategy.actions.push('Daily Post');
         amendedStrategy.description += ' (Updated with Daily Posting)';
         console.log('[Autonomous] Amendment: Added "Daily Post" to actions.');
      }
    }

    // In a real system, we might save this amendment to the DB/History
    return amendedStrategy;
  },

  async executeOrganicStrategy(strategy: Strategy, imageUrl?: string): Promise<void> {
    // 1. Create Internal Tracking Campaign
    await CampaignService.createCampaign({
      name: `[Organic] ${strategy.title} - ${new Date().toLocaleDateString()}`,
      objective: CampaignObjective.OUTCOME_AWARENESS,
      status: CampaignStatus.ACTIVE,
    }, true);

    // 2. Publish Content to Facebook Page (Real-time)
    try {
        const config = await FacebookService.getConfig();
        if (config) {
            // Generate Organic Copy
            const copy = await CreativeService.generateCopy(strategy.title, strategy.brandVoice || 'Friendly', 'AWARENESS');
            
            console.log('[Autonomous] Publishing Organic Post...');
            await FacebookService.createPost(
                config.page_id,
                `${copy.headline}\n\n${copy.body}`,
                imageUrl,
                config.access_token
            );
            console.log('[Autonomous] Organic Post Published Successfully.');
        } else {
            console.warn('[Autonomous] Facebook config missing. Skipping organic post.');
        }
    } catch (e) {
        console.error('[Autonomous] Failed to publish organic post:', e);
        // Don't fail the whole strategy, just log
    }
  },

  async executePaidStrategy(strategy: Strategy, imageUrl: string): Promise<void> {
    try {
      // 1. Create Campaign
      const campaign = await CampaignService.createCampaign({
        name: `[Auto-Paid] ${strategy.title} - ${new Date().toLocaleDateString()}`,
        objective: CampaignObjective.OUTCOME_SALES,
        status: CampaignStatus.ACTIVE,
      });

      // 2. Create Ad Set
      const adSet = await AdSetService.createAdSet({
        campaign_id: campaign.id,
        facebook_campaign_id: campaign.facebook_campaign_id,
        name: 'Auto Target - Broad - US',
        daily_budget: 2000, // $20.00
        billing_event: BillingEvent.IMPRESSIONS,
        optimization_goal: OptimizationGoal.OFFSITE_CONVERSIONS,
        status: CampaignStatus.ACTIVE,
      });

      console.log(`[Autonomous] Created Ad Set: ${adSet.name}`);

      // 3. Generate Human-Like Copy
      // Extract product name from title or description roughly (Mock logic)
      const productName = strategy.title.replace(' Launch Strategy', '').replace('High-Impact Conversion', 'Product');
      const tone = strategy.brandVoice || 'Professional';
      
      const copy = await CreativeService.generateCopy(productName, tone, 'CONVERSION');

      // 4. Create Ad Creative & Ad
      // Check if strategy requires Video or Image
      let finalAssetUrl = imageUrl;
      
      // If strategy mentions "Video" or "Reel", try to generate a video asset (Storyboard for now)
      if (strategy.title.toLowerCase().includes('video') || strategy.title.toLowerCase().includes('reel')) {
          try {
              finalAssetUrl = await CreativeService.generateVideoAsset(productName, "High energy promotional video");
              console.log('[Autonomous] Generated Video Asset (Storyboard):', finalAssetUrl);
          } catch (e) {
              console.warn('[Autonomous] Video generation failed, falling back to image:', e);
          }
      }

      const ad = await AdService.createAd({
        ad_set_id: adSet.id,
        facebook_ad_set_id: adSet.facebook_ad_set_id,
        name: `Ad - ${strategy.title}`,
        status: CampaignStatus.ACTIVE,
        creative: {
          title: copy.headline, // Use generated catchy headline
          body: copy.body,      // Use generated persuasive body
          image_url: finalAssetUrl, 
        },
      });

      console.log(`[Autonomous] Created Ad: ${ad.name} (${ad.facebook_ad_id})`);

    } catch (error) {
      console.error('[Autonomous] Execution Failed:', error);
      throw error;
    }
  },

  /**
   * Main Autonomous Loop
   * Called periodically (e.g. by Dashboard) to perform background tasks.
   */
  async runAutonomousLoop(): Promise<void> {
    console.log('[Autonomous] Starting background loop...');
    await this.likeAllInteractions();
    await this.replyToComments();
    await this.replyToMessages();
    await this.followUpLeads();
  },

  /**
   * Start Real-time Listeners
   * NOTE: Actual execution (Like/Reply) is now handled by Supabase Edge Functions
   * to ensure 24/7 autonomous operation even when the app is closed.
   * This listener now serves to update the UI in real-time.
   */
  startRealtimeListeners(): void {
    console.log('[Autonomous] Initializing Real-time UI Listeners...');
    
    // Listen for new comments
    supabase
      .channel('public:comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, async (payload) => {
        console.log('[Autonomous] Real-time: New comment detected (Processing on Backend)', payload.new);
        // The backend Edge Function will handle the reply.
        // We can add local notification logic here if desired.
      })
      .subscribe();

    // Listen for new messages
    supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        console.log('[Autonomous] Real-time: New message detected (Processing on Backend)', payload.new);
      })
      .subscribe();
  },

  async handleNewComment(comment: any): Promise<void> {
    // Deprecated in favor of Edge Function 'autonomous-worker'
    // Kept for reference or fallback if backend is offline
    console.log('Event handled by backend autonomous-worker');
  },

  async handleNewMessage(msg: any): Promise<void> {
    // Deprecated in favor of Edge Function 'autonomous-worker'
    console.log('Event handled by backend autonomous-worker');
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
<<<<<<< HEAD
            await FacebookService.postMessage(msg.conversation_id, reply, config.access_token);
=======
            await FacebookService.postMessage(msg.sender_id, reply, config.access_token);
>>>>>>> adroom-mobile

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
