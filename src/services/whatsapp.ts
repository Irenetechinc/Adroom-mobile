import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';
import { AppState, AppStateStatus } from 'react-native';

// WhatsApp uses Facebook's OAuth dialog.
// On Android, Chrome Custom Tabs may not call the openBrowserAsync completion
// handler when the user presses the back button (changed behaviour in newer
// Android/Expo SDK versions). We use an AppState listener as a reliable
// fallback to detect when the app comes back to the foreground (browser
// dismissed) and resolve quickly instead of waiting for the full timeout.

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
    const authUrl     =
      `https://www.facebook.com/v18.0/dialog/oauth` +
      `?client_id=${FB_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&response_type=code` +
      `&scope=${scopes}` +
      `&state=${state}`;

    console.log('[WhatsAppService] Opening browser for OAuth…');

    return new Promise((resolve) => {
      const POLL_MS             = 2000;
      const TIMEOUT_MS          = 3 * 60 * 1000; // 3 min max (was 5 min)
      const BROWSER_CLOSE_GRACE = 8000;           // 8 s after browser closes
      const start               = Date.now();
      let codeReceived          = false;
      let browserClosedAt: number | null = null;
      let foregroundGraceTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: string | null) => {
        if (codeReceived && result === null) return;
        codeReceived = true;
        clearInterval(poll);
        if (foregroundGraceTimer) clearTimeout(foregroundGraceTimer);
        appStateSub.remove();
        WebBrowser.dismissBrowser().catch(() => {});
        resolve(result);
      };

      // AppState listener: when the app comes back to the foreground the
      // browser has been dismissed (back button, task switch, etc.).
      // Give the poll 8 more seconds to find the code, then give up.
      // This is the primary fix for the "stuck forever" symptom — previously
      // the only exit was the 5-minute TIMEOUT_MS if openBrowserAsync never
      // resolved its Promise (which happens on newer Android).
      const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (nextState === 'active' && !codeReceived) {
          if (!browserClosedAt) browserClosedAt = Date.now();
          // Allow the pending poll iteration(s) to run, then close out.
          if (foregroundGraceTimer) clearTimeout(foregroundGraceTimer);
          foregroundGraceTimer = setTimeout(() => {
            if (!codeReceived) finish(null);
          }, BROWSER_CLOSE_GRACE);
        }
      });

      WebBrowser.openBrowserAsync(authUrl)
        .then(() => {
          if (!codeReceived) {
            browserClosedAt = Date.now();
          }
        })
        .catch(() => {
          if (!codeReceived) finish(null);
        });

      const poll = setInterval(async () => {
        if (codeReceived) { clearInterval(poll); return; }
        if (Date.now() - start > TIMEOUT_MS) { finish(null); return; }
        if (
          browserClosedAt !== null &&
          !codeReceived &&
          Date.now() - browserClosedAt > BROWSER_CLOSE_GRACE
        ) {
          finish(null); return;
        }
        try {
          const res = await fetch(`${BACKEND_URL}/auth/poll?state=${state}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.error) { finish(null); return; }
          if (data.code) {
            codeReceived = true;
            clearInterval(poll);
            if (foregroundGraceTimer) clearTimeout(foregroundGraceTimer);
            appStateSub.remove();
            WebBrowser.dismissBrowser().catch(() => {});
            try {
              const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/whatsapp/exchange`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ code: data.code, redirectUri: callbackUrl }),
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
