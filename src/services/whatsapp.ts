import { supabase } from './supabase';
import { runOAuthBrowserFlow } from '../utils/oauthBrowser';

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

    const state       = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const callbackUrl = `${BACKEND_URL}/auth/whatsapp/callback`;
    const scopes      = 'whatsapp_business_management,whatsapp_business_messaging,business_management,public_profile';

    const authUrl =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${FB_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&scope=${scopes}` +
      `&state=${state}`;

    console.log('[WhatsAppService] Opening browser…');

    const foundCode = await runOAuthBrowserFlow(authUrl, `${BACKEND_URL}/auth/poll?state=${state}`);

    if (!foundCode) return null;

    try {
      const ex     = await fetch(`${BACKEND_URL}/api/auth/whatsapp/exchange`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: foundCode, redirectUri: callbackUrl }),
      });
      const exData = await ex.json();
      return exData.access_token || null;
    } catch { return null; }
  },

  async getPhoneAccounts(accessToken: string): Promise<WhatsAppPhoneAccount[]> {
    try {
      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) return [];
      const res  = await fetch(`${BACKEND_URL}/api/auth/whatsapp/phone-numbers`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ access_token: accessToken }),
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
      user_id:      user.id,
      platform:     'whatsapp',
      page_id:      phoneNumberId,
      page_name:    displayName,
      access_token: accessToken,
      updated_at:   new Date().toISOString(),
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
