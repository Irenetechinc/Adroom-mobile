import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';

// WhatsApp uses Facebook's OAuth dialog which hijacks Chrome Custom Tabs on
// Android. We open the browser fire-and-forget and poll the backend for the
// auth code — works in Expo Go and standalone builds.

const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

export interface WhatsAppPhoneAccount {
  id: string;
  name: string;
  phone: string;
  waba_id: string;
}

export const WhatsAppService = {
  async login(): Promise<string | null> {
    const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
    if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_API_URL is not configured');
    if (!FB_APP_ID)   throw new Error('EXPO_PUBLIC_FACEBOOK_APP_ID is not configured');

    const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const callbackUrl = `${BACKEND_URL}/auth/whatsapp/callback`;
    const scopes = 'whatsapp_business_management,whatsapp_business_messaging,business_management,public_profile';
    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${FB_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&scope=${scopes}` +
      `&state=${state}`;

    console.log('[WhatsAppService] Opening browser for OAuth…');
    WebBrowser.openBrowserAsync(authUrl).catch(() => {});

    return new Promise((resolve) => {
      const POLL_MS = 2000;
      const TIMEOUT_MS = 5 * 60 * 1000;
      const start = Date.now();

      const poll = setInterval(async () => {
        if (Date.now() - start > TIMEOUT_MS) {
          clearInterval(poll);
          resolve(null);
          return;
        }
        try {
          const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.error) { clearInterval(poll); resolve(null); return; }
          if (data.code) {
            clearInterval(poll);
            try {
              const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/whatsapp/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: data.code, redirectUri: callbackUrl }),
              });
              const exchangeData = await exchangeRes.json();
              resolve(exchangeData.access_token || null);
            } catch { resolve(null); }
          }
        } catch { /* keep polling */ }
      }, POLL_MS);
    });
  },

  async getPhoneAccounts(accessToken: string): Promise<WhatsAppPhoneAccount[]> {
    try {
      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) return [];
      const res = await fetch(`${BACKEND_URL}/api/auth/whatsapp/phone-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const data = await res.json();
      return data.phone_numbers || [];
    } catch (e) {
      console.error('[WhatsAppService] getPhoneAccounts error:', e);
      return [];
    }
  },

  async saveConfig(phoneNumberId: string, accessToken: string, displayName: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase.from('ad_configs').upsert({
      user_id: user.id,
      platform: 'whatsapp',
      page_id: phoneNumberId,
      page_name: displayName,
      access_token: accessToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });

    if (error) throw error;
  },

  async getConfig() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('ad_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', 'whatsapp')
      .maybeSingle();
    return data;
  },
};
