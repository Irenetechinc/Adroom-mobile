import { supabase } from './supabase';
import { AdSet, CreateAdSetInput } from '../types/adSet';
import { FacebookService } from './facebook';

export const AdSetService = {
  /**
   * Create an ad set on Facebook and save it to Supabase
   */
  async createAdSet(input: CreateAdSetInput): Promise<AdSet> {
    // 1. Get User Config
    const config = await FacebookService.getConfig();
    if (!config) throw new Error('Facebook configuration not found.');

    try {
      // 2. Create on Facebook
      // https://developers.facebook.com/docs/marketing-api/reference/ad-campaign
      const payload = {
        name: input.name,
        campaign_id: input.facebook_campaign_id,
        daily_budget: input.daily_budget,
        billing_event: input.billing_event,
        optimization_goal: input.optimization_goal,
        status: input.status,
        access_token: config.access_token,
        start_time: new Date(Date.now() + 10 * 60000).toISOString(), // Start in 10 mins
        // Basic targeting for "no dummy data" but minimal complexity
        targeting: {
          geo_locations: { countries: ['US'] },
          age_min: 18,
          age_max: 65,
        },
      };

      const fbResponse = await fetch(
        `https://graph.facebook.com/v18.0/${config.ad_account_id}/adsets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const fbData = await fbResponse.json();

      if (!fbResponse.ok) {
        throw new Error(fbData.error?.message || 'Failed to create ad set on Facebook');
      }

      const facebookAdSetId = fbData.id;

      // 3. Save to Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('ad_sets')
        .insert({
          user_id: user.id,
          campaign_id: input.campaign_id,
          facebook_ad_set_id: facebookAdSetId,
          name: input.name,
          daily_budget: input.daily_budget,
          billing_event: input.billing_event,
          optimization_goal: input.optimization_goal,
          status: input.status,
          start_time: payload.start_time,
        })
        .select()
        .single();

      if (error) throw error;
      return data;

    } catch (error) {
      console.error('Ad Set creation error:', error);
      throw error;
    }
  },

  /**
   * Fetch all ad sets for a specific campaign from Supabase
   */
  async getAdSets(campaignId: string): Promise<AdSet[]> {
    const { data, error } = await supabase
      .from('ad_sets')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },
};
