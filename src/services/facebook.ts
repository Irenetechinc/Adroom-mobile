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
        scheme: 'adroom',
        path: 'auth/facebook/callback',
      });

      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) {
        throw new Error('EXPO_PUBLIC_API_URL is not configured');
      }
      const callbackUrl = `${BACKEND_URL}/auth/facebook/callback`;

      // Using WebBrowser directly as a fallback for custom OAuth flows
      // SWITCHING TO RESPONSE_TYPE=CODE for backend exchange
      if (!FB_APP_ID) {
        throw new Error('EXPO_PUBLIC_FACEBOOK_APP_ID is not configured');
      }

      const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=pages_show_list,pages_read_engagement,pages_manage_posts,pages_messaging,public_profile`;
      
      console.log('[FacebookService] Initiating login with redirect_uri:', callbackUrl);
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        // Parse code from URL query params
        // Result URL will be like: adroom://auth/facebook/callback?code=...
        const match = result.url.match(/code=([^&]+)/);
        const code = match ? match[1] : null;

        if (code) {
            // Exchange code for token via backend
            const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, redirectUri: callbackUrl })
            });
            
            const exchangeData = await exchangeRes.json();
            if (exchangeData.access_token) {
                return exchangeData.access_token;
            } else {
                throw new Error('Failed to exchange code for token: ' + (exchangeData.error || 'Unknown error'));
            }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Facebook login error:', error);
      throw error;
    }
  },

  /**
   * Fetch Active Config from Supabase
   */
  async getConfig(): Promise<FacebookConfig | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('ad_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', 'facebook')
      .maybeSingle();
    
    if (error) {
        throw error;
    }
    return data;
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
   * Validate Credentials (Token)
   */
  async validateCredentials(input: any): Promise<boolean> {
      if (!input.access_token) return false;
      
      try {
        const meRes = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${input.access_token}`);
        return meRes.ok;
      } catch (e) {
        console.error('Token validation failed:', e);
        return false;
      }
  },

  /**
   * Save the complete configuration
   */
  async saveConfig(
    pageId: string, 
    pageName: string,
    accessToken: string
  ): Promise<FacebookConfig> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const configData: any = {
      user_id: user.id,
      platform: 'facebook',
      page_id: pageId,
      page_name: pageName,
      access_token: accessToken,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('ad_configs')
      .upsert(configData, { onConflict: 'user_id,platform' })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Post a comment or reply to an object (post or comment)
   */
  async postComment(objectId: string, message: string, accessToken: string): Promise<string> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${objectId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          access_token: accessToken
        })
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
  },

  /**
   * Like an object (post, comment, or media)
   */
  async likeObject(objectId: string, accessToken: string): Promise<boolean> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${objectId}/likes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken
        })
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.success;
  },

  /**
   * Send a private message to a user (via Page)
   */
  async postMessage(recipientId: string, message: string, accessToken: string): Promise<string> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
          access_token: accessToken
        })
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.message_id || data.recipient_id;
  },

  /**
   * Publish a post to the Page Feed
   */
  async createPost(pageId: string, message: string, imageUrl: string | undefined, accessToken: string): Promise<string> {
    const body: any = {
        message: message,
        access_token: accessToken,
        published: true
    };
    
    // If image is provided, use /photos endpoint, otherwise /feed
    const endpoint = imageUrl ? 'photos' : 'feed';
    if (imageUrl) body.url = imageUrl;

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.id || data.post_id;
  }
};
