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
   * Facebook OAuth login — openBrowserAsync + background polling.
   *
   * openAuthSessionAsync(url, 'adroom://') was the previous approach but it
   * returns { type: 'cancel' } immediately on Android when the adroom:// scheme
   * is not registered as an Android intent filter (Expo Go) or when the Facebook
   * app intercepts the OAuth URL. The 5-poll loop that followed would start
   * before the user even saw a browser, find no code, and return null —
   * producing the "connection was cancelled" message with no browser ever opening.
   *
   * The new approach:
   *  1. Open the system browser with openBrowserAsync (works everywhere, no
   *     deep-link scheme required).
   *  2. Poll /auth/poll every 1 s in the background for up to 120 s.
   *  3. When the code arrives, dismiss the browser programmatically.
   *  4. If the user closes the browser early we give a 2 s grace window for
   *     late-arriving codes before giving up.
   * The backend now shows a "Connected! Return to AdRoom" page instead of
   * redirecting to adroom://, so the browser stays visible until we dismiss it.
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

    console.log('[FacebookService] Opening browser…');

    // browserClosed is set true when the user presses back / closes the tab.
    // We also set it true when we call dismissBrowser() after finding the code.
    let browserClosed = false;
    WebBrowser.openBrowserAsync(authUrl, { showInRecents: false })
      .then(() => { browserClosed = true; })
      .catch(() => { browserClosed = true; });

    let foundCode: string | null = null;

    // Poll every 1 s for up to 120 s (2 min) or until the browser is closed.
    for (let i = 0; i < 120 && !browserClosed; i++) {
      await new Promise<void>(r => setTimeout(r, 1000));
      if (browserClosed) break;
      try {
        const res  = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.error) break;
        if (data.code) { foundCode = data.code; break; }
      } catch { /* network hiccup — retry */ }
    }

    // If the browser was closed by the user before we found the code, give a
    // brief grace period in case the callback arrived just as they pressed back.
    if (!foundCode && browserClosed) {
      await new Promise<void>(r => setTimeout(r, 2000));
      try {
        const res  = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
        if (res.ok) {
          const data = await res.json();
          if (data.code) foundCode = data.code;
        }
      } catch { /* ignore */ }
    }

    // Close the browser (no-op if the user already closed it).
    try { await WebBrowser.dismissBrowser(); } catch { /* already closed */ }

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
