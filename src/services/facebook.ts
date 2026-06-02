import { supabase } from './supabase';
import { FacebookConfig } from '../types/facebook';
import * as WebBrowser from 'expo-web-browser';

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
   * Facebook OAuth login using server-side polling.
   *
   * WHY openAuthSessionAsync (not openBrowserAsync):
   *   openAuthSessionAsync(url, 'adroom://') configures the Chrome Custom Tab
   *   to monitor for the adroom:// scheme and close automatically when the
   *   backend redirects there. openBrowserAsync does NOT do this — on some
   *   Android versions it shows "Can't open link" and the tab stays open
   *   indefinitely, which is why the typing indicator appeared frozen.
   *
   * WHY we IGNORE the return value (success / cancel):
   *   On newer Android + Expo SDK, openAuthSessionAsync may return
   *   { type: 'cancel' } even on successful auth (the OS hands the adroom://
   *   link to the app separately from the Custom Tab session). Since we store
   *   the code server-side via /auth/poll, we don't need the code from the URL.
   *   We just wait for the Custom Tab to close, then poll immediately.
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
      `&state=${state}`;

    console.log('[FacebookService] Opening auth session…');

    // This resolves once the Custom Tab closes — either the user pressed back
    // OR the backend redirected to adroom:// (which automatically closes the tab).
    await WebBrowser.openAuthSessionAsync(authUrl, 'adroom://');

    console.log('[FacebookService] Auth session closed, polling for code…');

    // Poll up to 5 times (≈5 s). The app is in the foreground now so timers
    // are fully reliable. The first poll usually succeeds on attempt 1.
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise<void>(r => setTimeout(r, 1000));
      try {
        const res  = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.error) return null;
        if (data.code) {
          const ex     = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ code: data.code, redirectUri: callbackUrl }),
          });
          const exData = await ex.json();
          return exData.access_token || null;
        }
      } catch { /* network hiccup — retry */ }
    }

    // Custom Tab closed but no code found → user cancelled or auth failed.
    return null;
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
