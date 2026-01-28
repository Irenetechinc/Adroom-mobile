import { CampaignService } from './campaign';
import { AdSetService } from './adSet';
import { AdService } from './ad';
import { CreativeService } from './creative';
import { CampaignObjective, CampaignStatus } from '../types/campaign';
import { BillingEvent, OptimizationGoal } from '../types/adSet';
import { Strategy } from '../types/agent';

export const AutonomousService = {
  /**
   * Execute the selected strategy by creating Campaign, AdSets, and Ads autonomously.
   */
  async executeStrategy(strategy: Strategy, productImageUrl?: string): Promise<void> {
    if (strategy.type === 'FREE') {
      await this.executeOrganicStrategy(strategy);
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

  async executeOrganicStrategy(strategy: Strategy): Promise<void> {
    await CampaignService.createCampaign({
      name: `[Organic] ${strategy.title} - ${new Date().toLocaleDateString()}`,
      objective: CampaignObjective.OUTCOME_AWARENESS,
      status: CampaignStatus.ACTIVE,
    }, true);
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
      const ad = await AdService.createAd({
        ad_set_id: adSet.id,
        facebook_ad_set_id: adSet.facebook_ad_set_id,
        name: `Ad - ${strategy.title}`,
        status: CampaignStatus.ACTIVE,
        creative: {
          title: copy.headline, // Use generated catchy headline
          body: copy.body,      // Use generated persuasive body
          image_url: imageUrl, 
        },
      });

      console.log(`[Autonomous] Created Ad: ${ad.name} (${ad.facebook_ad_id})`);

    } catch (error) {
      console.error('[Autonomous] Execution Failed:', error);
      throw error;
    }
  }
};
