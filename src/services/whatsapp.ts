import { supabase } from './supabase';
import { Linking } from 'react-native';

// WhatsApp uses Facebook's OAuth dialog, which detects Chrome Custom Tabs on
// Android and redirects to the native Facebook app — breaking openAuthSessionAsync.
// Fix: open via system browser (Linking.openURL) and catch the adroom:// deep-link.

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

    const callbackUrl = `${BACKEND_URL}/auth/whatsapp/callback`;
    const scopes = 'whatsapp_business_management,whatsapp_business_messaging,business_management,public_profile';
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${scopes}`;

    console.log('[WhatsAppService] Opening system browser for OAuth…');

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
        if (!url.startsWith('adroom://auth/whatsapp/callback')) return;
        console.log('[WhatsAppService] Deep-link received:', url);

        const errorMatch = url.match(/[?&]error=([^&]+)/);
        if (errorMatch) { finish(null); return; }

        const codeMatch = url.match(/[?&]code=([^&]+)/);
        const code = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
        if (!code) { finish(null); return; }

        try {
          const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/whatsapp/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, redirectUri: callbackUrl }),
          });
          const exchangeData = await exchangeRes.json();
          if (exchangeData.access_token) finish(exchangeData.access_token);
          else finish(new Error(exchangeData.error || 'Token exchange failed'));
        } catch (e: any) {
          finish(new Error(e.message || 'Token exchange failed'));
        }
      });

      timeoutId = setTimeout(() => finish(null), 5 * 60 * 1000);
      Linking.openURL(authUrl).catch((e) => finish(new Error(e.message)));
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
