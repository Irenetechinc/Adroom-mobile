import { supabase } from './supabase';
import { FacebookConfig } from '../types/facebook';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

// The Facebook App ID identifies the "AdRoom" application itself to Facebook.
// It is NOT a specific user's account ID. 
// This allows AdRoom to ask ANY user for permission to manage THEIR specific pages.
const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID; 

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

export interface FacebookAdAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
}

export const FacebookService = {
  
  /**
   * Initiate Facebook Login Flow
   */
  async login(): Promise<string | null> {
    try {
      // Use useAuthRequest hook pattern or manual browser flow if startAsync is deprecated
      // However, for Expo 50+, startAsync is still available in expo-auth-session but marked deprecated in some contexts
      // We will suppress the TS error for now or use the WebBrowser directly if needed.
      // Correct modern approach: useAuthRequest + makeRedirectUri
      
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'adroom'
      });

      // Using WebBrowser directly as a fallback for custom OAuth flows
      const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=ads_management,ads_read,read_insights,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_ads,pages_messaging,public_profile`;
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        // Parse token from URL fragment
        const match = result.url.match(/access_token=([^&]+)/);
        return match ? match[1] : null;
      }
      
      return null;
    } catch (error) {
      console.error('Facebook login error:', error);
      throw error;
    }
  },

  /**
   * Fetch User's Pages
   */
  async getPages(userAccessToken: string): Promise<FacebookPage[]> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token,category`
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.data || [];
  },

  /**
   * Fetch User's Ad Accounts
   */
  async getAdAccounts(userAccessToken: string): Promise<FacebookAdAccount[]> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/adaccounts?access_token=${userAccessToken}&fields=id,name,account_id,account_status,currency,timezone_name`
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.data || [];
  },

  /**
   * Validate Credentials (Token)
   */
  async validateCredentials(input: any): Promise<boolean> {
      // In a real implementation, we would call the debug_token endpoint
      // For now, we assume if we have a token, it's valid enough to try saving
      if (!input.access_token) return false;
      return true;
  },

  /**
   * Save the complete configuration
   */
  async saveConfig(
    pageId: string, 
    pageName: string,
    adAccountId: string, 
    accessToken: string
  ): Promise<FacebookConfig> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('ad_configs')
      .upsert({
        user_id: user.id,
        page_id: pageId,
        page_name: pageName, // Ensure this column exists or add it
        ad_account_id: adAccountId,
        access_token: accessToken,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ... keep existing methods if compatible or refactor ...
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
  }
};
