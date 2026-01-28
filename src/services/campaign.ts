import { supabase } from './supabase';
import { Campaign, CreateCampaignInput, CampaignObjective, CampaignStatus } from '../types/campaign';
import { FacebookService } from './facebook';

export const CampaignService = {
  /**
   * Create a campaign on Facebook and save it to Supabase
   */
  async createCampaign(input: CreateCampaignInput, isOrganic: boolean = false): Promise<Campaign> {
    // 1. Get User Config
    const config = await FacebookService.getConfig();
    if (!config) throw new Error('Facebook configuration not found. Please configure settings first.');

    try {
      let facebookCampaignId = 'organic_campaign';

      if (!isOrganic) {
        // 2. Create on Facebook (only for paid)
        // https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group
        const fbResponse = await fetch(
          `https://graph.facebook.com/v18.0/${config.ad_account_id}/campaigns`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: input.name,
              objective: input.objective,
              status: input.status,
              special_ad_categories: input.special_ad_categories || [],
              access_token: config.access_token,
            }),
          }
        );

        const fbData = await fbResponse.json();

        if (!fbResponse.ok) {
          throw new Error(fbData.error?.message || 'Failed to create campaign on Facebook');
        }

        facebookCampaignId = fbData.id;
      }

      // 3. Save to Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('campaigns')
        .insert({
          user_id: user.id,
          facebook_campaign_id: facebookCampaignId,
          name: input.name,
          objective: input.objective,
          status: input.status,
        })
        .select()
        .single();

      if (error) throw error;
      return data;

    } catch (error) {
      console.error('Campaign creation error:', error);
      throw error;
    }
  },

  /**
   * Fetch all campaigns for the user from Supabase
   */
  async getCampaigns(): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },
};
