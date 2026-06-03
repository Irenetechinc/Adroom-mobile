import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

// openBrowserAsync + background polling — same approach as FacebookService.
// openAuthSessionAsync(url, 'adroom://') was the previous approach but it
// returned { type: 'cancel' } immediately on Android without ever opening a
// browser, causing an instant "connection cancelled" message.

const LINKEDIN_CLIENT_ID = process.env.EXPO_PUBLIC_LINKEDIN_CLIENT_ID;

if (!LINKEDIN_CLIENT_ID) {
  console.warn('Warning: EXPO_PUBLIC_LINKEDIN_CLIENT_ID is not configured. LinkedIn integration will fail.');
}

export const LinkedInService = {
  async login(): Promise<string | null> {
    try {
      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
      if (!LINKEDIN_CLIENT_ID) throw new Error('EXPO_PUBLIC_LINKEDIN_CLIENT_ID is not configured');

      const callbackUrl = `${BACKEND_URL}/auth/linkedin/callback`;
      const scopes = encodeURIComponent('r_liteprofile r_emailaddress rw_ads w_member_social');
      const state = Math.random().toString(36).substring(2) + Date.now().toString(36);

      const authUrl =
        `https://www.linkedin.com/oauth/v2/authorization` +
        `?response_type=code` +
        `&client_id=${LINKEDIN_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
        `&scope=${scopes}` +
        `&state=${encodeURIComponent(state)}`;

      console.log('[LinkedInService] Opening browser…');

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
        console.log('[LinkedInService] No code received — user cancelled or timed out.');
        return null;
      }

      console.log('[LinkedInService] Code received, exchanging for token…');
      const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/linkedin/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: foundCode, redirectUri: callbackUrl }),
      });
      const exchangeData = await exchangeRes.json();
      if (exchangeData.access_token) return exchangeData.access_token;
      throw new Error('Failed to exchange code for token: ' + (exchangeData.error || 'Unknown error'));
    } catch (error) {
      console.error('[LinkedInService] login error:', error);
      throw error;
    }
  },

  async getAdAccounts(accessToken: string): Promise<any[]> {
    try {
      const response = await fetch('https://api.linkedin.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`LinkedIn API Error: ${response.status} ${err}`);
      }
      const data: any = await response.json();
      const id = data.id;
      const name = [data.localizedFirstName, data.localizedLastName].filter(Boolean).join(' ').trim();
      if (!id) throw new Error('LinkedIn did not return a user id');
      return [{ id: `urn:li:person:${id}`, name: name || String(id) }];
    } catch (e) {
      console.error('[LinkedInService] getAdAccounts error:', e);
      throw e;
    }
  },

  async createShare(accessToken: string, urn: string, text: string): Promise<string> {
    const body = {
      author: urn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };
    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.id) return data.id;
    throw new Error(data.message || 'LinkedIn Share Failed');
  },

  async saveConfig(adAccountId: string, accessToken: string, accountName: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    const { error } = await supabase.from('ad_configs').upsert({
      user_id: user.id,
      platform: 'linkedin',
      page_id: adAccountId,
      ad_account_id: adAccountId,
      page_name: accountName,
      access_token: accessToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });
    if (error) throw error;
  },
};
