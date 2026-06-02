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
   * Initiate Facebook Login Flow.
   *
   * Strategy: openBrowserAsync (fire-and-forget) + /auth/poll.
   *
   * WHY not openAuthSessionAsync:
   *   On Expo SDK 50+ / Android, openAuthSessionAsync returns { type: 'cancel' }
   *   when the backend redirects to the adroom:// custom scheme because Android's
   *   Intent system intercepts it outside the Chrome Custom Tab session.
   *
   * WHY not setInterval-only polling:
   *   When Chrome Custom Tabs opens, Android pauses the host Activity and React
   *   Native throttles JS timers. setInterval may barely fire while the browser
   *   is open, causing the typing indicator to appear frozen.
   *
   * SOLUTION: Open the browser fire-and-forget. When openBrowserAsync resolves
   *   (browser dismissed — triggered by the backend's adroom:// redirect or the
   *   user pressing back), the app is in the foreground and timers are reliable.
   *   We immediately poll 5 times in rapid succession. A background setInterval
   *   is kept as a safety net for the uncommon case where the browser stays open.
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

    console.log('[FacebookService] Opening browser (polling mode)…');

    return new Promise((resolve) => {
      const TIMEOUT_MS = 2 * 60 * 1000; // 2 min hard cap
      const start      = Date.now();
      let done         = false;

      // Single-use guard — prevents resolve() being called more than once.
      const finish = (result: string | null) => {
        if (done) return;
        done = true;
        clearInterval(bgPoll);
        WebBrowser.dismissBrowser().catch(() => {});
        resolve(result);
      };

      // Tries /auth/poll once. Returns true if the flow is complete (code found
      // or error), false if still pending.
      const trySinglePoll = async (): Promise<boolean> => {
        try {
          const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
          if (!res.ok) return false;
          const data = await res.json();
          if (data.error) { finish(null); return true; }
          if (data.code) {
            try {
              const ex     = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ code: data.code, redirectUri: callbackUrl }),
              });
              const exData = await ex.json();
              finish(exData.access_token || null);
            } catch { finish(null); }
            return true;
          }
        } catch { /* ignore, keep trying */ }
        return false;
      };

      // PRIMARY path ─────────────────────────────────────────────────────────
      // When the browser closes (backend redirected to adroom://, or user
      // pressed back), the app is in the foreground. Poll 5 times, 1 s apart.
      // This is fast and reliable because JS timers run normally in foreground.
      WebBrowser.openBrowserAsync(authUrl)
        .then(async () => {
          for (let i = 0; i < 5 && !done; i++) {
            await new Promise<void>(r => setTimeout(r, i === 0 ? 300 : 1000));
            const found = await trySinglePoll();
            if (found) return;
          }
          // Browser closed, 5 polls yielded nothing → user cancelled.
          finish(null);
        })
        .catch(() => finish(null));

      // FALLBACK path ─────────────────────────────────────────────────────────
      // Polls every 2 s while the browser is open. May be throttled by Android
      // when the Activity is paused, but handles edge cases where the browser
      // closes without triggering openBrowserAsync.then() (e.g. task-switch).
      const bgPoll = setInterval(async () => {
        if (done) { clearInterval(bgPoll); return; }
        if (Date.now() - start > TIMEOUT_MS) { finish(null); return; }
        await trySinglePoll();
      }, 2000);
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
