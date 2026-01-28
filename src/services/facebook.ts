import { supabase } from './supabase';
import { FacebookConfig, FacebookConfigInput } from '../types/facebook';

export const FacebookService = {
  /**
   * Validate Facebook credentials by making a real API call to Facebook Graph API
   */
  async validateCredentials(input: FacebookConfigInput): Promise<boolean> {
    try {
      // Validate Ad Account
      const adAccountResponse = await fetch(
        `https://graph.facebook.com/v18.0/${input.ad_account_id}?access_token=${input.access_token}&fields=id,name`
      );
      
      if (!adAccountResponse.ok) {
        throw new Error('Invalid Ad Account ID or Access Token');
      }

      // Validate Page
      const pageResponse = await fetch(
        `https://graph.facebook.com/v18.0/${input.page_id}?access_token=${input.access_token}&fields=id,name`
      );

      if (!pageResponse.ok) {
        throw new Error('Invalid Page ID');
      }

      return true;
    } catch (error) {
      console.error('Facebook validation error:', error);
      throw error;
    }
  },

  /**
   * Get the current user's Facebook configuration
   */
  async getConfig(): Promise<FacebookConfig | null> {
    const { data, error } = await supabase
      .from('ad_configs')
      .select('*')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows found
      throw error;
    }

    return data;
  },

  /**
   * Save or update the Facebook configuration
   */
  async saveConfig(input: FacebookConfigInput): Promise<FacebookConfig> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ad_configs')
      .upsert({
        user_id: user.id,
        ...input,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};
