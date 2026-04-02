import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

const LINKEDIN_CLIENT_ID = process.env.EXPO_PUBLIC_LINKEDIN_CLIENT_ID;

if (!LINKEDIN_CLIENT_ID) {
  console.warn('Warning: EXPO_PUBLIC_LINKEDIN_CLIENT_ID is not configured. LinkedIn integration will fail.');
}
// const LINKEDIN_CLIENT_SECRET = process.env.EXPO_PUBLIC_LINKEDIN_CLIENT_SECRET; // Handled by backend

export const LinkedInService = {
  /**
   * Initiate LinkedIn Login Flow
   */
  async login(): Promise<string | null> {
    try {
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'adroom',
        path: 'auth/linkedin/callback',
      });

      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      if (!BACKEND_URL) {
        throw new Error('EXPO_PUBLIC_API_URL is not configured');
      }
      const callbackUrl = `${BACKEND_URL}/auth/linkedin/callback`;

      // Scopes for Marketing API
      const scopes = encodeURIComponent('r_liteprofile r_emailaddress rw_ads w_member_social');

      const state = Crypto.randomUUID();
      const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${encodeURIComponent(state)}`;
      
      console.log('[LinkedInService] Initiating login...');
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === 'success' && result.url) {
        const match = result.url.match(/code=([^&]+)/);
        const code = match ? match[1] : null;

        const stateMatch = result.url.match(/state=([^&]+)/);
        const returnedState = stateMatch ? stateMatch[1] : null;
        if (returnedState && returnedState !== state) {
          throw new Error('LinkedIn OAuth state mismatch');
        }

        if (code) {
            // Exchange code for token via backend
            const exchangeRes = await fetch(`${BACKEND_URL}/api/auth/linkedin/exchange`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, redirectUri: callbackUrl })
            });
            
            const exchangeData = await exchangeRes.json();
            if (exchangeData.access_token) {
                return exchangeData.access_token;
            } else {
                throw new Error('Failed to exchange code for token: ' + (exchangeData.error || 'Unknown error'));
            }
        }
      }
      
      return null;
    } catch (error) {
      console.error('LinkedIn login error:', error);
      throw error;
    }
  },

  /**
   * Fetch User's Ad Accounts
   */
  async getAdAccounts(accessToken: string): Promise<any[]> {
    try {
        const response = await fetch('https://api.linkedin.com/v2/me', {
            headers: { 
                Authorization: `Bearer ${accessToken}`,
                'X-Restli-Protocol-Version': '2.0.0'
            }
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
        console.error('LinkedIn getAdAccounts error:', e);
        throw e;
    }
  },

  /**
   * Post a share (text or with media) to LinkedIn
   */
  async createShare(accessToken: string, urn: string, text: string): Promise<string> {
    const body = {
        author: urn, // urn:li:person:ID or urn:li:organization:ID
        lifecycleState: "PUBLISHED",
        specificContent: {
            "com.linkedin.ugc.ShareContent": {
                shareCommentary: {
                    text: text
                },
                shareMediaCategory: "NONE"
            }
        },
        visibility: {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
    };

    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    const data = await response.json();
    if (data.id) return data.id;
    throw new Error(data.message || 'LinkedIn Share Failed');
  },

  /**
   * Save Configuration
   */
  async saveConfig(adAccountId: string, accessToken: string, accountName: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('ad_configs')
      .upsert({
        user_id: user.id,
        platform: 'linkedin',
        page_id: adAccountId,
        ad_account_id: adAccountId,
        page_name: accountName, // Using page_name to store Account Name for consistency
        access_token: accessToken,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform' }); // Note: unique constraint updated in migration

    if (error) throw error;
  }
};
