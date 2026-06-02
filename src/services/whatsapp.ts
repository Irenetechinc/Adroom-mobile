import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';

// WhatsApp uses Facebook's OAuth dialog.
// Same polling strategy as FacebookService — see facebook.ts for full explanation.
//
// The backend /auth/whatsapp/callback now redirects to adroom:// on success
// (same as Facebook/Instagram), so the browser closes automatically and
// openBrowserAsync.then() fires immediately, triggering rapid post-close polls.
// AppState listener is intentionally NOT used — it caused app crashes on some
// Android devices due to lifecycle timing edge cases.

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

    console.log('[WhatsAppService] Opening browser (polling mode)…');

    return new Promise((resolve) => {
      const TIMEOUT_MS = 2 * 60 * 1000;
      const start      = Date.now();
      let done         = false;

      const finish = (result: string | null) => {
        if (done) return;
        done = true;
        clearInterval(bgPoll);
        WebBrowser.dismissBrowser().catch(() => {});
        resolve(result);
      };

      const trySinglePoll = async (): Promise<boolean> => {
        try {
          const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
          if (!res.ok) return false;
          const data = await res.json();
          if (data.error) { finish(null); return true; }
          if (data.code) {
            try {
              const ex     = await fetch(`${BACKEND_URL}/api/auth/whatsapp/exchange`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ code: data.code, redirectUri: callbackUrl }),
              });
              const exData = await ex.json();
              finish(exData.access_token || null);
            } catch { finish(null); }
            return true;
          }
        } catch {}
        return false;
      };

      // Primary: poll immediately when browser closes.
      // The backend now redirects to adroom:// on success, which closes the
      // browser automatically — so this fires right after successful auth.
      WebBrowser.openBrowserAsync(authUrl)
        .then(async () => {
          for (let i = 0; i < 5 && !done; i++) {
            await new Promise<void>(r => setTimeout(r, i === 0 ? 300 : 1000));
            const found = await trySinglePoll();
            if (found) return;
          }
          finish(null);
        })
        .catch(() => finish(null));

      // Fallback: background polling (may be throttled by Android when app is
      // paused, but catches edge cases where the browser never closes).
      const bgPoll = setInterval(async () => {
        if (done) { clearInterval(bgPoll); return; }
        if (Date.now() - start > TIMEOUT_MS) { finish(null); return; }
        await trySinglePoll();
      }, 2000);
    });
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
