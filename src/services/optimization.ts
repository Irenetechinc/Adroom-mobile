import { CampaignService } from './campaign';
import { AnalyticsService } from './analytics';
import { AdSetService } from './adSet';
import { SchedulerService } from './scheduler';
import { FacebookService } from './facebook';
import { OptimizationAction } from '../types/analytics';
import { CampaignStatus } from '../types/campaign';

// Rule Constants
const MAX_CPC_THRESHOLD = 2.50; // $2.50 per click
const LOW_CTR_THRESHOLD = 0.5; // 0.5% CTR
const HIGH_ROAS_THRESHOLD = 3.0; // 3x Return on Ad Spend (simplified proxy)

export const OptimizationService = {
  /**
   * Run the optimization loop for all active campaigns
   * NOW INCLUDES: Engagement Monitoring & Daily Scheduler
   */
  async runOptimizationLoop(): Promise<OptimizationAction[]> {
    const campaigns = await CampaignService.getCampaigns();
    const activeCampaigns = campaigns.filter(c => c.status === CampaignStatus.ACTIVE && c.facebook_campaign_id !== 'organic_campaign');
    
    const actions: OptimizationAction[] = [];
    const config = await FacebookService.getConfig();

    // 1. Run Engagement Service (Comments & Replies)
    // Note: Engagement is now handled by the backend webhook, so we don't need to poll it here.
    if (config) {
      // 2. Run Daily Scheduler (Organic Growth)
      // Passing a simple context derived from the first active campaign or generic
      // AND ensuring Strategy Alignment (logic inside SchedulerService)
      const context = activeCampaigns.length > 0 ? { productName: activeCampaigns[0].name.split(' - ')[0] } : { productName: 'Our Brand' };
      await SchedulerService.checkAndExecuteDailyPost(config.page_id, context);
    }

    // 3. Optimize Paid Campaigns
    for (const campaign of activeCampaigns) {
      const insights = await AnalyticsService.getCampaignInsights(campaign.facebook_campaign_id);
      
      if (!insights) continue;

      // Rule: High CPC -> Pause or Decrease Budget
      if (insights.cpc > MAX_CPC_THRESHOLD) {
        if (insights.conversions === 0 && insights.spend > 20) { 
           const action = await this.executePauseCampaign(campaign.facebook_campaign_id, "High CPC with no conversions");
           if (action) actions.push(action);
        }
      }

      // Rule: Low CTR -> Creative Fatigue?
      if (insights.impressions > 1000 && insights.ctr < LOW_CTR_THRESHOLD) {
        const action = await this.executeDecreaseBudget(campaign.facebook_campaign_id, "Low CTR detected");
        if (action) actions.push(action);
      }

      // Rule: High Performance -> Scale!
      if (insights.conversions > 5 && insights.cpc < 1.0) {
         const action = await this.executeIncreaseBudget(campaign.facebook_campaign_id, "High performance detected");
         if (action) actions.push(action);
      }
    }

    return actions;
  },

  async executePauseCampaign(campaignId: string, reason: string): Promise<OptimizationAction | null> {
    console.log(`[Optimization] Pausing Campaign ${campaignId}: ${reason}`);
    
    const config = await FacebookService.getConfig();
    if (!config) return null;

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'PAUSED',
            access_token: config.access_token
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to pause campaign:', errorData);
        throw new Error(errorData.error?.message || 'Failed to pause campaign');
      }

      return {
        id: Date.now().toString(),
        campaign_id: campaignId,
        type: 'PAUSE_AD',
        reason,
        status: 'EXECUTED',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error executing pause campaign:', error);
      return null;
    }
  },

  async executeDecreaseBudget(campaignId: string, reason: string): Promise<OptimizationAction | null> {
    console.log(`[Optimization] Decreasing Budget for ${campaignId}: ${reason}`);
    
    const config = await FacebookService.getConfig();
    if (!config) return null;

    try {
      // 1. Get current budget
      const getResponse = await fetch(
        `https://graph.facebook.com/v18.0/${campaignId}?fields=daily_budget,lifetime_budget&access_token=${config.access_token}`
      );
      const data = await getResponse.json();
      
      if (!data.daily_budget) {
        console.log('Campaign does not have a daily budget (possibly Ad Set level budget). Skipping.');
        return null;
      }

      const currentBudget = parseInt(data.daily_budget);
      const newBudget = Math.floor(currentBudget * 0.8); // Decrease by 20%

      // 2. Update budget
      const updateResponse = await fetch(
        `https://graph.facebook.com/v18.0/${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            daily_budget: newBudget,
            access_token: config.access_token
          })
        }
      );

      if (!updateResponse.ok) {
        throw new Error('Failed to update budget');
      }

      return {
        id: Date.now().toString(),
        campaign_id: campaignId,
        type: 'DECREASE_BUDGET',
        reason,
        status: 'EXECUTED',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error executing decrease budget:', error);
      return null;
    }
  },

  async executeIncreaseBudget(campaignId: string, reason: string): Promise<OptimizationAction | null> {
    console.log(`[Optimization] Scaling Budget for ${campaignId}: ${reason}`);
    
    const config = await FacebookService.getConfig();
    if (!config) return null;

    try {
      // 1. Get current budget
      const getResponse = await fetch(
        `https://graph.facebook.com/v18.0/${campaignId}?fields=daily_budget&access_token=${config.access_token}`
      );
      const data = await getResponse.json();
      
      if (!data.daily_budget) return null;

      const currentBudget = parseInt(data.daily_budget);
      const newBudget = Math.floor(currentBudget * 1.2); // Increase by 20%

      // 2. Update budget
      const updateResponse = await fetch(
        `https://graph.facebook.com/v18.0/${campaignId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            daily_budget: newBudget,
            access_token: config.access_token
          })
        }
      );

      if (!updateResponse.ok) throw new Error('Failed to update budget');

      return {
        id: Date.now().toString(),
        campaign_id: campaignId,
        type: 'INCREASE_BUDGET',
        reason,
        status: 'EXECUTED',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error executing increase budget:', error);
      return null;
    }
  }
};
