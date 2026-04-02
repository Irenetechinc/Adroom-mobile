import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

const TIKTOK_CLIENT_KEY = process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY;

if (!TIKTOK_CLIENT_KEY) {
  console.warn('Warning: EXPO_PUBLIC_TIKTOK_CLIENT_KEY is not configured. TikTok integration will fail.');
}

export const TikTokService = {
  async login(): Promise<string | null> {
    try {
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'adroom',
        path: 'auth/tiktok/callback',
      });

      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
      
      const callbackUrl = `${BACKEND_URL}/auth/tiktok/callback`;
      
      // TikTok for Business scopes
      const scopes = 'ads.management,ads.read,user.info.basic';
      const state = Crypto.randomUUID();
      const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=${TIKTOK_CLIENT_KEY}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}`;

      console.log('[TikTokService] Initiating login...');
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        const match = result.url.match(/auth_code=([^&]+)/); // TikTok uses auth_code
        const code = match ? match[1] : null;

        if (code) {
             const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/tiktok/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, redirectUri: callbackUrl })
            });
            const exchangeData = await exchangeRes.json();
            if (exchangeData.access_token) return exchangeData.access_token;
            throw new Error(exchangeData.error || 'TikTok Token Exchange Failed');
        }
      }
      return null;
    } catch (error) {
      console.error('TikTok login error:', error);
      throw error;
    }
  },

  async getAdvertiserAccounts(accessToken: string): Promise<any[]> {
    try {
        const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/advertiser/get/', {
            method: 'GET',
            headers: { 
                'Access-Token': accessToken,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(`TikTok API Error: ${data.message}`);
        }
        return data.data?.list || [];
    } catch (e) {
        console.error('TikTok getAdvertiserAccounts error:', e);
        throw e;
    }
  },

  async saveConfig(advertiserId: string, accessToken: string, name: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase.from('ad_configs').upsert({
        user_id: user.id,
        platform: 'tiktok',
        page_id: advertiserId,
        ad_account_id: advertiserId,
        page_name: name,
        access_token: accessToken,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });

    if (error) throw error;
  },

  /**
   * Create Ad (Autonomous Action)
   * Note: TikTok Marketing API structure is complex (Campaign -> AdGroup -> Ad).
   * This is a simplified implementation for the "autonomous" requirement.
   */
  async createAd(accessToken: string, advertiserId: string, adGroupId: string, creativeMaterial: any): Promise<string> {
      // https://business-api.tiktok.com/open_api/v1.3/ad/create/
      const body = {
          advertiser_id: advertiserId,
          adgroup_id: adGroupId,
          creatives: [creativeMaterial] 
      };

      const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/ad/create/', {
          method: 'POST',
          headers: {
              'Access-Token': accessToken,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
      });
      
      const data = await response.json();
      if (data.code !== 0) throw new Error(data.message || 'TikTok Ad Creation Failed');
      
      return data.data.ad_ids[0]; // Returns list of created ad IDs
  },

  /**
   * Autonomous Action: Like Comment
   */
  async likeComment(accessToken: string, commentId: string): Promise<boolean> {
      // POST /business/comment/like/
      const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/business/comment/like/', {
          method: 'POST',
          headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment_id: commentId })
      });
      const data = await response.json();
      return data.code === 0;
  },

  /**
   * Autonomous Action: Reply to Comment
   */
  async replyComment(accessToken: string, commentId: string, text: string): Promise<string> {
      // POST /business/comment/reply/
      const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/business/comment/reply/', {
          method: 'POST',
          headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment_id: commentId, text })
      });
      const data = await response.json();
      if (data.code !== 0) throw new Error(data.message);
      return data.data.reply_id;
  }
};
