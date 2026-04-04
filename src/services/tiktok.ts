import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

// TikTok Login Kit client key (for content/organic posting via Open API)
// This is the app-level client key, NOT a user's ID.
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
   * User grants permission to post, read comments, etc.
   * Returns the access_token on success.
   */
  async login(): Promise<{ access_token: string; open_id: string; refresh_token?: string } | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!TIKTOK_CLIENT_KEY) throw new Error('EXPO_PUBLIC_TIKTOK_CLIENT_KEY is not configured');

    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'adroom',
      path: 'auth/tiktok/callback',
    });
    const callbackUrl = `${BACKEND_URL}/auth/tiktok/callback`;

    // TikTok Login Kit scopes for content posting + engagement
    const scopes = [
      'user.info.basic',
      'video.publish',
      'video.upload',
      'video.list',
      'comment.list',
      'comment.list.manage',
    ].join(',');

    const state = Math.random().toString(36).substring(2, 15);
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&response_type=code&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;

    console.log('[TikTokService] Initiating Login Kit OAuth...');
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (result.type !== 'success' || !result.url) {
      console.log('[TikTokService] OAuth dismissed or failed:', result.type);
      return null;
    }

    // TikTok returns ?code= in the redirect
    const codeMatch = result.url.match(/[?&]code=([^&]+)/);
    const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
    if (!code) {
      const errMatch = result.url.match(/[?&]error=([^&]+)/);
      throw new Error(`TikTok auth failed: ${errMatch ? decodeURIComponent(errMatch[1]) : 'no code returned'}`);
    }

    // Exchange code for access_token via backend
    const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/tiktok/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: callbackUrl }),
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
        headers: { 'Authorization': `Bearer ${accessToken}` },
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
   * Called after login() succeeds and user confirms their profile.
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
   * Autonomous Action: Reply to a TikTok comment (Business API)
   */
  async replyComment(accessToken: string, videoId: string, commentId: string, text: string): Promise<string> {
    const response = await fetch('https://open.tiktokapis.com/v2/comment/reply/', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ video_id: videoId, comment_id: commentId, text }),
    });
    const data: any = await response.json();
    if (data.error?.code !== 'ok' && data.error?.code !== undefined) throw new Error(data.error?.message || 'TikTok reply failed');
    return data.data?.comment_id || '';
  },
};
