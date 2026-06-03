import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

// openBrowserAsync + background polling — same approach as FacebookService.
// openAuthSessionAsync(url, 'adroom://') was the previous approach but it
// returned { type: 'cancel' } immediately on Android without ever opening a
// browser, causing an instant "connection cancelled" message.
// PKCE codeVerifier is kept in-memory in the app and passed to the exchange
// endpoint — it does not need to survive the browser session.

const TWITTER_CLIENT_ID = process.env.EXPO_PUBLIC_TWITTER_CLIENT_ID;

if (!TWITTER_CLIENT_ID) {
  console.warn('Warning: EXPO_PUBLIC_TWITTER_CLIENT_ID is not configured. Twitter/X integration will fail.');
}

export const TwitterService = {
  async login(): Promise<string | null> {
    try {
      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
      if (!TWITTER_CLIENT_ID) throw new Error('EXPO_PUBLIC_TWITTER_CLIENT_ID is not configured');

      const callbackUrl = `${BACKEND_URL}/auth/twitter/callback`;

      const base64Url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const codeVerifier = (Crypto.randomUUID() + Crypto.randomUUID()).replace(/-/g, '');
      const codeChallengeBase64 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        codeVerifier,
        { encoding: Crypto.CryptoEncoding.BASE64 },
      );
      const codeChallenge = base64Url(codeChallengeBase64);
      const state = Math.random().toString(36).substring(2) + Date.now().toString(36);

      const scopes = 'tweet.read tweet.write users.read offline.access';
      const authUrl =
        `https://twitter.com/i/oauth2/authorize` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(TWITTER_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${encodeURIComponent(state)}` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256`;

      console.log('[TwitterService] Opening browser…');

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
        console.log('[TwitterService] No code received — user cancelled or timed out.');
        return null;
      }

      console.log('[TwitterService] Code received, exchanging for token…');
      const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/twitter/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: foundCode, redirectUri: callbackUrl, codeVerifier }),
      });
      const exchangeData = await exchangeRes.json();
      if (exchangeData.access_token) return exchangeData.access_token;
      throw new Error(exchangeData.error || 'Twitter Token Exchange Failed');
    } catch (error) {
      console.error('[TwitterService] login error:', error);
      throw error;
    }
  },

  async getAdAccounts(accessToken: string): Promise<any[]> {
    try {
      const response = await fetch('https://api.twitter.com/2/users/me?user.fields=name,username', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Twitter API Error: ${response.status} ${err}`);
      }
      const data: any = await response.json();
      if (!data.data?.id) throw new Error('Twitter did not return a user id');
      return [{ id: data.data.id, name: data.data.name || data.data.username || data.data.id }];
    } catch (e) {
      console.error('[TwitterService] getAdAccounts error:', e);
      throw e;
    }
  },

  async createTweet(accessToken: string, text: string): Promise<string> {
    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    if (data.data?.id) return data.data.id;
    throw new Error(data.detail || 'Twitter Post Failed');
  },

  async saveConfig(accountId: string, accessToken: string, name: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    const { error } = await supabase.from('ad_configs').upsert({
      user_id: user.id,
      platform: 'twitter',
      page_id: accountId,
      ad_account_id: accountId,
      page_name: name,
      access_token: accessToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });
    if (error) throw error;
  },
};
