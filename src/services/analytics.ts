import { FacebookService } from './facebook';
import { InsightMetrics, CampaignInsights } from '../types/analytics';

export const AnalyticsService = {
  /**
   * Fetch real-time insights for a specific campaign from Facebook Marketing API
   */
  async getCampaignInsights(campaignId: string): Promise<InsightMetrics | null> {
    const config = await FacebookService.getConfig();
    if (!config) return null;

    try {
      // https://developers.facebook.com/docs/marketing-api/insights
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${campaignId}/insights?fields=spend,impressions,clicks,cpc,ctr,actions&access_token=${config.access_token}`
      );

      const data = await response.json();
      
      if (!response.ok) {
        // If campaign is new, it might not have insights yet
        console.warn('Insights fetch warning:', data.error?.message);
        return null;
      }

      if (data.data && data.data.length > 0) {
        const insight = data.data[0];
        
        // Parse "actions" to find conversions (e.g., purchases, leads)
        // This is a simplified parser for "offsite_conversion"
        let conversions = 0;
        if (insight.actions) {
          const conversionAction = insight.actions.find((a: any) => a.action_type === 'offsite_conversion');
          if (conversionAction) conversions = parseInt(conversionAction.value);
        }

        return {
          spend: parseFloat(insight.spend || '0'),
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          cpc: parseFloat(insight.cpc || '0'),
          ctr: parseFloat(insight.ctr || '0'),
          conversions,
          date_start: insight.date_start,
          date_stop: insight.date_stop,
        };
      }

      return null;
    } catch (error) {
      console.error('Analytics fetch error:', error);
      return null;
    }
  },

  /**
   * Fetch aggregated insights for the entire ad account
   */
  async getAccountInsights(): Promise<InsightMetrics | null> {
    const config = await FacebookService.getConfig();
    if (!config) return null;

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${config.ad_account_id}/insights?fields=spend,impressions,clicks,cpc,ctr,actions&date_preset=maximum&access_token=${config.access_token}`
      );

      const data = await response.json();
      
      if (!response.ok) return null;

      if (data.data && data.data.length > 0) {
        const insight = data.data[0];
        return {
          spend: parseFloat(insight.spend || '0'),
          impressions: parseInt(insight.impressions || '0'),
          clicks: parseInt(insight.clicks || '0'),
          cpc: parseFloat(insight.cpc || '0'),
          ctr: parseFloat(insight.ctr || '0'),
          conversions: 0, // Aggregate conversions logic omitted for brevity
          date_start: insight.date_start,
          date_stop: insight.date_stop,
        };
      }
      return null;
    } catch (error) {
      console.error('Account insights error:', error);
      return null;
    }
  }
};
