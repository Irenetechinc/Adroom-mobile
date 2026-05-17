import { Linking } from 'react-native';
import { supabase } from './supabase';

// Instagram uses Facebook's OAuth dialog, which detects Chrome Custom Tabs on
// Android and redirects to the native Facebook app — breaking openAuthSessionAsync.
// Fix: open via system browser (Linking.openURL) and catch the adroom:// deep-link.

const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

export const InstagramService = {
  async login(): Promise<string | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!FB_APP_ID)   throw new Error('EXPO_PUBLIC_FACEBOOK_APP_ID is not configured');

    const callbackUrl = `${BACKEND_URL}/auth/instagram/callback`;
    const scopes = 'instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,pages_show_list,ads_management';
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${scopes}`;

    console.log('[InstagramService] Opening system browser for OAuth…');

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout>;

      const finish = (result: string | null | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        subscription.remove();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const subscription = Linking.addEventListener('url', async ({ url }) => {
        if (!url.startsWith('adroom://auth/instagram/callback')) return;
        console.log('[InstagramService] Deep-link received:', url);

        const errorMatch = url.match(/[?&]error=([^&]+)/);
        if (errorMatch) { finish(null); return; }

        const codeMatch = url.match(/[?&]code=([^&]+)/);
        const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
        if (!code) { finish(null); return; }

        try {
          const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, redirectUri: callbackUrl }),
          });
          const exchangeData = await exchangeRes.json();
          if (exchangeData.access_token) finish(exchangeData.access_token);
          else finish(new Error(exchangeData.error || 'Instagram Token Exchange Failed'));
        } catch (e: any) {
          finish(new Error(e.message || 'Token exchange failed'));
        }
      });

      timeoutId = setTimeout(() => finish(null), 5 * 60 * 1000);
      Linking.openURL(authUrl).catch((e) => finish(new Error(e.message)));
    });
  },

  async getInstagramAccounts(accessToken: string): Promise<any[]> {
    // 1. Get Pages
    // 2. For each Page, get connected IG Business Account
    try {
        const pagesRes = await fetch(
            `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}&fields=instagram_business_account,name,id`
        );
        const pagesData = await pagesRes.json();
        
        if (pagesData.error) throw new Error(pagesData.error.message);

        const igAccounts = [];
        for (const page of pagesData.data || []) {
            if (page.instagram_business_account) {
                // Fetch IG details
                const igRes = await fetch(
                    `https://graph.facebook.com/v18.0/${page.instagram_business_account.id}?fields=username,name,profile_picture_url&access_token=${accessToken}`
                );
                const igData = await igRes.json();
                igAccounts.push({
                    id: page.instagram_business_account.id,
                    username: igData.username,
                    name: igData.name,
                    page_id: page.id // Linked Page ID
                });
            }
        }
        return igAccounts;
    } catch (e) {
        console.error('Instagram getAccounts error:', e);
        throw e;
    }
  },

  /**
   * Publish Media (Image/Video)
   */
  async publishMedia(igUserId: string, accessToken: string, imageUrl: string, caption: string): Promise<string> {
    // 1. Create Media Container
    const containerRes = await fetch(
        `https://graph.facebook.com/v18.0/${igUserId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`,
        { method: 'POST' }
    );
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(containerData.error.message);
    
    // 2. Publish Container
    const publishRes = await fetch(
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
        user_id: user.id,
        platform: 'instagram',
        page_id: igAccountId,
        ad_account_id: igAccountId,
        page_name: username,
        access_token: accessToken,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });

    if (error) throw error;
  }
};
