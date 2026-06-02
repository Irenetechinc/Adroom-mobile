import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// Same openAuthSessionAsync + server-side polling strategy as FacebookService.
// See facebook.ts for full explanation of why openAuthSessionAsync is used
// instead of openBrowserAsync.

const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

export const InstagramService = {

  async login(): Promise<string | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!FB_APP_ID)   throw new Error('EXPO_PUBLIC_FACEBOOK_APP_ID is not configured');

    const state       = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const callbackUrl = `${BACKEND_URL}/auth/instagram/callback`;
    const scopes      = 'instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,pages_show_list,ads_management';

    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${FB_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&scope=${scopes}` +
      `&state=${state}`;

    console.log('[InstagramService] Opening auth session…');

    await WebBrowser.openAuthSessionAsync(authUrl, 'adroom://');

    console.log('[InstagramService] Auth session closed, polling for code…');

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
      } catch { /* retry */ }
    }
    return null;
  },

  async getInstagramAccounts(accessToken: string): Promise<any[]> {
    try {
      const pagesRes  = await fetch(
        `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}&fields=instagram_business_account,name,id`
      );
      const pagesData = await pagesRes.json();
      if (pagesData.error) throw new Error(pagesData.error.message);

      const igAccounts = [];
      for (const page of pagesData.data || []) {
        if (page.instagram_business_account) {
          const igRes  = await fetch(
            `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}?fields=username,name,profile_picture_url&access_token=${accessToken}`
          );
          const igData = await igRes.json();
          igAccounts.push({
            id:       page.instagram_business_account.id,
            username: igData.username,
            name:     igData.name,
            page_id:  page.id,
          });
        }
      }
      return igAccounts;
    } catch (e) {
      console.error('Instagram getAccounts error:', e);
      throw e;
    }
  },

  async publishMedia(igUserId: string, accessToken: string, imageUrl: string, caption: string): Promise<string> {
    const containerRes  = await fetch(
      `https://graph.facebook.com/v18.0/${igUserId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`,
      { method: 'POST' }
    );
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(containerData.error.message);

    const publishRes  = await fetch(
      `https://graph.facebook.com/v18.0/${igUserId}/media_publish?creation_id=${containerData.id}&access_token=${accessToken}`,
      { method: 'POST' }
    );
    const publishData = await publishRes.json();
    if (publishData.id) return publishData.id;
    throw new Error(publishData.error?.message || 'IG Publish Failed');
  },

  async saveConfig(igAccountId: string, accessToken: string, username: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    const { error } = await supabase.from('ad_configs').upsert({
      user_id:       user.id,
      platform:      'instagram',
      page_id:       igAccountId,
      ad_account_id: igAccountId,
      page_name:     username,
      access_token:  accessToken,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });
    if (error) throw error;
  },
};
