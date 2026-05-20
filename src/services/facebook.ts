import { supabase } from './supabase';
import { FacebookConfig } from '../types/facebook';
import * as WebBrowser from 'expo-web-browser';

// Facebook's OAuth dialog detects Chrome Custom Tabs on Android and redirects
// to the native Facebook app, so WebBrowser.openAuthSessionAsync returns
// "cancel" instantly.  We open the browser (fire-and-forget) and poll the
// backend for the auth code instead — works in both Expo Go and standalone.

const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

export const FacebookService = {

  async login(): Promise<string | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!FB_APP_ID)   throw new Error('EXPO_PUBLIC_FACEBOOK_APP_ID is not configured');

    const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const callbackUrl = `${BACKEND_URL}/auth/facebook/callback`;
    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${FB_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&scope=pages_show_list,pages_read_engagement,pages_manage_posts,pages_messaging,public_profile` +
      `&state=${state}`;

    console.log('[FacebookService] Opening browser for OAuth…');

    return new Promise((resolve) => {
      const POLL_MS = 2000;
      const TIMEOUT_MS = 5 * 60 * 1000;
      const BROWSER_CLOSE_GRACE_MS = 5000;
      const start = Date.now();
      let codeReceived = false;
      let browserClosedAt: number | null = null;

      // Open browser — track when it closes so we can resolve quickly if user cancels
      WebBrowser.openBrowserAsync(authUrl)
        .then(() => { if (!codeReceived) browserClosedAt = Date.now(); })
        .catch(() => { if (!codeReceived) browserClosedAt = Date.now(); });

      const finish = (result: string | null) => {
        if (codeReceived && result === null) return; // already resolved with token
        codeReceived = true;
        clearInterval(poll);
        WebBrowser.dismissBrowser().catch(() => {});
        resolve(result);
      };

      const poll = setInterval(async () => {
        if (Date.now() - start > TIMEOUT_MS) { finish(null); return; }
        // If browser was closed and no code received within grace period, user cancelled
        if (browserClosedAt !== null && !codeReceived && Date.now() - browserClosedAt > BROWSER_CLOSE_GRACE_MS) {
          finish(null); return;
        }
        try {
          const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.error) { finish(null); return; }
          if (data.code) {
            codeReceived = true;
            clearInterval(poll);
            WebBrowser.dismissBrowser().catch(() => {});
            try {
              const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: data.code, redirectUri: callbackUrl }),
              });
              const exchangeData = await exchangeRes.json();
              resolve(exchangeData.access_token || null);
            } catch { resolve(null); }
          }
        } catch { /* network error — keep polling */ }
      }, POLL_MS);
    });
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
    
    if (error) {
        throw error;
    }
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
      } catch (e) {
        console.error('Token validation failed:', e);
        return false;
      }
  },

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

  async createPost(pageId: string, message: string, imageUrl: string | undefined, accessToken: string): Promise<string> {
    const body: any = {
        message: message,
        access_token: accessToken,
        published: true
    };
    
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
