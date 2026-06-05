import { supabase } from './supabase';
import { FacebookConfig } from '../types/facebook';
import * as WebBrowser from 'expo-web-browser';
import { runOAuthBrowserFlow } from '../utils/oauthBrowser';

WebBrowser.maybeCompleteAuthSession();

const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

export const FacebookService = {

  /**
   * Facebook OAuth login.
   *
   * Opens the system browser with openBrowserAsync, then delegates to
   * runOAuthBrowserFlow which polls the backend every second.  The backend
   * stores the code and redirects to adroom://oauth-done — this closes the
   * Chrome Custom Tab on Android (dismissBrowser() is iOS-only) and brings
   * AdRoom back to the foreground.  The 10-second grace period handles the
   * common Android case where the Facebook app intercepts the OAuth URL before
   * the Custom Tab even opens.
   */
  async login(): Promise<string | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!FB_APP_ID)   throw new Error('EXPO_PUBLIC_FACEBOOK_APP_ID is not configured');

    const state       = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const callbackUrl = `${BACKEND_URL}/auth/facebook/callback`;

    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${FB_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&scope=pages_show_list,pages_read_engagement,pages_manage_posts,pages_messaging,public_profile` +
      `&state=${state}` +
      `&display=touch`;

    console.log('[FacebookService] Opening browser…');

    const foundCode = await runOAuthBrowserFlow(authUrl, `${BACKEND_URL}/auth/poll?state=${state}`);

    if (!foundCode) {
      console.log('[FacebookService] No code received — user cancelled or timed out.');
      return null;
    }

    console.log('[FacebookService] Code received, exchanging for token…');
    try {
      const ex     = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: foundCode, redirectUri: callbackUrl }),
      });
      const exData = await ex.json();
      return exData.access_token || null;
    } catch {
      return null;
    }
  },

  async getConfig(): Promise<FacebookConfig | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('ad_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', 'facebook')
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getPages(userAccessToken: string): Promise<FacebookPage[]> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token,category`
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.data || [];
  },

  async validateCredentials(input: any): Promise<boolean> {
    if (!input.access_token) return false;
    try {
      const meRes = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${input.access_token}`);
      return meRes.ok;
    } catch { return false; }
  },

  async saveConfig(pageId: string, pageName: string, accessToken: string): Promise<FacebookConfig> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    const { data, error } = await supabase
      .from('ad_configs')
      .upsert({
        user_id: user.id, platform: 'facebook',
        page_id: pageId, page_name: pageName,
        access_token: accessToken, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform' })
      .select().single();
    if (error) throw error;
    return data;
  },

  async postComment(objectId: string, message: string, accessToken: string): Promise<string> {
    const response = await fetch(`https://graph.facebook.com/v18.0/${objectId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: accessToken }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
  },

  async likeObject(objectId: string, accessToken: string): Promise<boolean> {
    const response = await fetch(`https://graph.facebook.com/v18.0/${objectId}/likes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.success;
  },

  async postMessage(recipientId: string, message: string, accessToken: string): Promise<string> {
    const response = await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId }, message: { text: message }, access_token: accessToken,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.message_id || data.recipient_id;
  },

  async createPost(pageId: string, message: string, imageUrl: string | undefined, accessToken: string): Promise<string> {
    const body: any = { message, access_token: accessToken, published: true };
    const endpoint  = imageUrl ? 'photos' : 'feed';
    if (imageUrl) body.url = imageUrl;
    const response = await fetch(`https://graph.facebook.com/v18.0/${pageId}/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.id || data.post_id;
  },
};
