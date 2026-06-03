import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// openBrowserAsync + background polling — same approach as FacebookService.
// openAuthSessionAsync(url, 'adroom://') was the previous approach but it
// returned { type: 'cancel' } immediately on Android without ever opening a
// browser, causing an instant "connection cancelled" message.

// TikTok Login Kit client key (for content/organic posting via Open API)
const TIKTOK_CLIENT_KEY = process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY;

if (!TIKTOK_CLIENT_KEY) {
  console.warn('[TikTokService] EXPO_PUBLIC_TIKTOK_CLIENT_KEY not set — TikTok connection will fail.');
}

export interface TikTokProfile {
  open_id: string;
  display_name: string;
  avatar_url?: string;
}

export const TikTokService = {
  /**
   * Step 1: Initiate TikTok OAuth login (Login Kit / content posting API).
   * Uses openBrowserAsync + polling so it works reliably on Android.
   */
  async login(): Promise<{ access_token: string; open_id: string; refresh_token?: string } | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!TIKTOK_CLIENT_KEY) throw new Error('EXPO_PUBLIC_TIKTOK_CLIENT_KEY is not configured');

    const callbackUrl = `${BACKEND_URL}/auth/tiktok/callback`;

    const scopes = [
      'user.info.basic',
      'video.publish',
      'video.upload',
      'user.info.profile',
      'user.info.stats',
    ].join(',');

    const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const authUrl =
      `https://www.tiktok.com/v2/auth/authorize/` +
      `?client_key=${TIKTOK_CLIENT_KEY}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&state=${state}`;

    console.log('[TikTokService] Opening browser…');

    let browserClosed = false;
    WebBrowser.openBrowserAsync(authUrl, { showInRecents: false })
      .then(() => { browserClosed = true; })
      .catch(() => { browserClosed = true; });

    let foundCode: string | null = null;

    for (let i = 0; i < 120 && !browserClosed; i++) {
      await new Promise<void>(r => setTimeout(r, 1000));
      if (browserClosed) break;
      try {
        const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.error) break;
        if (data.code) { foundCode = data.code; break; }
      } catch { /* network hiccup — retry */ }
    }

    if (!foundCode && browserClosed) {
      await new Promise<void>(r => setTimeout(r, 2000));
      try {
        const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
        if (res.ok) {
          const data = await res.json();
          if (data.code) foundCode = data.code;
        }
      } catch { /* ignore */ }
    }

    try { await WebBrowser.dismissBrowser(); } catch { /* already closed */ }

    if (!foundCode) {
      console.log('[TikTokService] No code received — user cancelled or timed out.');
      return null;
    }

    console.log('[TikTokService] Code received, exchanging for token…');
    const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/tiktok/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: foundCode, redirectUri: callbackUrl }),
    });
    const exchangeData = await exchangeRes.json();
    if (!exchangeRes.ok || !exchangeData.access_token) {
      throw new Error(exchangeData.error || 'TikTok token exchange failed');
    }

    console.log(`[TikTokService] Token exchanged — open_id: ${exchangeData.open_id}`);
    return {
      access_token: exchangeData.access_token,
      open_id: exchangeData.open_id,
      refresh_token: exchangeData.refresh_token,
    };
  },

  /**
   * Step 2: Get TikTok user profile using the access token.
   */
  async getProfile(accessToken: string): Promise<TikTokProfile | null> {
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const user = data?.data?.user;
      if (!user) return null;
      return {
        open_id: user.open_id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      };
    } catch (e) {
      console.error('[TikTokService] getProfile error:', e);
      return null;
    }
  },

  /**
   * Step 3: Save TikTok credentials to the database.
   */
  async saveConfig(accessToken: string, openId: string, displayName: string, refreshToken?: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    const { error } = await supabase.from('ad_configs').upsert({
      user_id: user.id,
      platform: 'tiktok',
      access_token: accessToken,
      refresh_token: refreshToken || null,
      open_id: openId,
      page_name: displayName,
      page_id: openId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });
    if (error) throw new Error(`TikTok saveConfig error: ${error.message}`);
    console.log('[TikTokService] Config saved for user:', user.id);
  },

  /**
   * Disconnect TikTok — removes stored credentials
   */
  async disconnect(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    const { error } = await supabase.from('ad_configs').delete().eq('user_id', user.id).eq('platform', 'tiktok');
    if (error) throw new Error(`TikTok disconnect error: ${error.message}`);
  },

  /**
   * Autonomous Action: Reply to a TikTok comment
   */
  async replyComment(accessToken: string, videoId: string, commentId: string, text: string): Promise<string> {
    const response = await fetch('https://open.tiktokapis.com/v2/comment/reply/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ video_id: videoId, comment_id: commentId, text }),
    });
    const data: any = await response.json();
    if (data.error?.code !== 'ok' && data.error?.code !== undefined) {
      throw new Error(data.error?.message || 'TikTok reply failed');
    }
    return data.data?.comment_id || '';
  },
};
