import { Router } from 'express';
import { getServiceSupabaseClient } from '../config/supabase';
import { apmaOAuthStates } from './apmaOAuthStore';

export const apmaOAuthRouter = Router();

function getBase(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'https://api.adroomai.com').replace(/\/+$/, '');
}

function redirectUri(platform: string): string {
  return `${getBase()}/api/apma/oauth/callback/${platform}`;
}

function successPage(platformLabel: string, count: number): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Connected — APMA</title></head><body style="margin:0;background:#060d1a;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;max-width:400px;padding:0 24px"><div style="width:72px;height:72px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px">✓</div><div style="font-size:22px;font-weight:800;color:#22c55e;margin-bottom:8px">Connected!</div><div style="color:#94a3b8;font-size:14px;line-height:1.6">${platformLabel} ${count > 1 ? `(${count} accounts)` : 'account'} successfully connected to APMA.</div><div style="margin-top:28px;font-size:12px;color:#475569;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.15);border-radius:8px;padding:12px 16px">You can close this browser tab.<br>APMA Dashboard will update automatically.</div></div></body></html>`;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error — APMA</title></head><body style="margin:0;background:#060d1a;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;max-width:400px;padding:0 24px"><div style="font-size:48px;margin-bottom:16px">⚠</div><div style="font-size:18px;font-weight:700;color:#ef4444;margin-bottom:8px">Connection Failed</div><div style="color:#94a3b8;font-size:14px;line-height:1.6">${msg}</div><div style="margin-top:28px;font-size:12px;color:#475569">Close this tab and try again in APMA.</div></div></body></html>`;
}

function deniedPage(detail: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cancelled — APMA</title></head><body style="margin:0;background:#060d1a;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center;max-width:400px;padding:0 24px"><div style="font-size:48px;margin-bottom:16px">✕</div><div style="font-size:18px;font-weight:700;color:#f59e0b;margin-bottom:8px">Authorization Cancelled</div><div style="color:#94a3b8;font-size:14px">${detail || 'Access was not granted.'}</div><div style="margin-top:28px;font-size:12px;color:#475569">Close this tab and try again in APMA.</div></div></body></html>`;
}

async function upsertAccount(sb: any, payload: Record<string, any>): Promise<string | null> {
  const { client_id, platform, account_id } = payload;
  const { data: existing } = await sb
    .from('apma_social_accounts')
    .select('id')
    .eq('client_id', client_id)
    .eq('platform', platform)
    .eq('account_id', account_id)
    .maybeSingle();

  if (existing?.id) {
    await sb.from('apma_social_accounts').update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? null,
      account_name: payload.account_name,
      active: true,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await sb.from('apma_social_accounts').insert({
    ...payload,
    account_type: payload.account_type ?? 'page',
    meta: payload.meta ?? {},
    active: true,
  }).select('id').single();

  if (error) { console.error('[APMA OAuth] upsert failed', error.message); return null; }
  return created?.id as string | null;
}

apmaOAuthRouter.get('/callback/:platform', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error, error_description } = req.query as Record<string, string>;

  if (error || !code || !state) {
    const st = state ? apmaOAuthStates.get(state) : null;
    if (st) { st.status = 'error'; st.error = error_description || error || 'Authorization denied'; }
    return res.send(deniedPage(error_description || error || 'Authorization was denied.'));
  }

  const st = apmaOAuthStates.get(state);
  if (!st || st.expiresAt < Date.now()) {
    return res.send(errorPage('OAuth session expired. Please start the connection again from APMA.'));
  }

  const sb = getServiceSupabaseClient();
  const newIds: string[] = [];

  try {
    switch (platform) {
      case 'facebook':
      case 'instagram': {
        const FB_APP_ID = process.env.FB_APP_ID;
        const FB_APP_SECRET = process.env.FB_APP_SECRET;
        if (!FB_APP_ID || !FB_APP_SECRET) throw new Error('Facebook credentials not configured on server.');

        const redir = redirectUri('facebook');

        const shortRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&redirect_uri=${encodeURIComponent(redir)}&code=${encodeURIComponent(code)}`);
        const shortData = await shortRes.json() as any;
        if (!shortRes.ok || !shortData.access_token) throw new Error(shortData.error?.message ?? 'Failed to get Facebook token');
        const shortToken: string = shortData.access_token;

        const llRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${shortToken}`);
        const llData = await llRes.json() as any;
        const longToken: string = llData.access_token || shortToken;

        const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${longToken}`);
        const me = await meRes.json() as any;

        const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${longToken}&limit=25`);
        const pagesData = await pagesRes.json() as any;
        const pages: any[] = pagesData.data ?? [];

        if (pages.length > 0) {
          for (const page of pages) {
            const pageToken: string = page.access_token || longToken;

            const fbId = await upsertAccount(sb, {
              client_id: st.clientId,
              platform: 'facebook',
              account_type: 'page',
              account_id: page.id,
              account_name: page.name,
              access_token: pageToken,
            });
            if (fbId) newIds.push(fbId);

            const igRes = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${pageToken}`);
            const igData = await igRes.json() as any;
            const igId: string | undefined = igData.instagram_business_account?.id;
            if (igId) {
              const igInfoRes = await fetch(`https://graph.facebook.com/v18.0/${igId}?fields=id,name,username&access_token=${pageToken}`);
              const igInfo = await igInfoRes.json() as any;
              const igAcctId = await upsertAccount(sb, {
                client_id: st.clientId,
                platform: 'instagram',
                account_type: 'page',
                account_id: igId,
                account_name: igInfo.username || igInfo.name || igId,
                access_token: pageToken,
              });
              if (igAcctId) newIds.push(igAcctId);
            }
          }
        } else {
          const fbId = await upsertAccount(sb, {
            client_id: st.clientId,
            platform: 'facebook',
            account_type: 'persona',
            account_id: me.id,
            account_name: me.name || me.id,
            access_token: longToken,
          });
          if (fbId) newIds.push(fbId);
        }

        const platformLabel = pages.length > 0 ? 'Facebook' + (newIds.some(() => true) ? ' & Instagram' : '') : 'Facebook';
        st.status = 'completed';
        st.accountIds = newIds;
        st.expiresAt = Date.now() + 10 * 60_000;
        return res.send(successPage(platformLabel, newIds.length));
      }

      case 'twitter': {
        const CLIENT_ID = process.env.TWITTER_CLIENT_ID;
        const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
        if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Twitter credentials not configured on server.');
        if (!st.codeVerifier) throw new Error('Missing PKCE code verifier — please restart the connection.');

        const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
          },
          body: new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri('twitter'),
            code_verifier: st.codeVerifier,
            client_id: CLIENT_ID,
          }).toString(),
        });
        const tokenData = await tokenRes.json() as any;
        if (!tokenRes.ok || !tokenData.access_token) throw new Error(tokenData.error_description ?? tokenData.error ?? 'Failed to get Twitter token');

        const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=id,name,username', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userRes.json() as any;
        const user = userData.data ?? {};

        const acctId = await upsertAccount(sb, {
          client_id: st.clientId,
          platform: 'twitter',
          account_type: 'persona',
          account_id: user.id || 'unknown',
          account_name: user.name || user.username || 'Twitter Account',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
        });
        if (acctId) newIds.push(acctId);
        st.status = 'completed';
        st.accountIds = newIds;
        st.expiresAt = Date.now() + 10 * 60_000;
        return res.send(successPage('Twitter/X', newIds.length));
      }

      case 'linkedin': {
        const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
        const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
        if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('LinkedIn credentials not configured on server.');

        const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri('linkedin'),
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }).toString(),
        });
        const tokenData = await tokenRes.json() as any;
        if (!tokenRes.ok || !tokenData.access_token) throw new Error(tokenData.error_description ?? 'Failed to get LinkedIn token');

        const profileRes = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileRes.json() as any;
        const fullName = [profile.localizedFirstName, profile.localizedLastName].filter(Boolean).join(' ') || profile.id || 'LinkedIn Account';

        const acctId = await upsertAccount(sb, {
          client_id: st.clientId,
          platform: 'linkedin',
          account_type: 'persona',
          account_id: profile.id || 'unknown',
          account_name: fullName,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
        });
        if (acctId) newIds.push(acctId);
        st.status = 'completed';
        st.accountIds = newIds;
        st.expiresAt = Date.now() + 10 * 60_000;
        return res.send(successPage('LinkedIn', newIds.length));
      }

      case 'reddit': {
        const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
        const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
        if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Reddit credentials not configured on server.');

        const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
            'User-Agent': 'APMA-Political-Agent/1.0',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri('reddit'),
          }).toString(),
        });
        const tokenData = await tokenRes.json() as any;
        if (!tokenRes.ok || !tokenData.access_token) throw new Error(tokenData.error ?? 'Failed to get Reddit token');

        const meRes = await fetch('https://oauth.reddit.com/api/v1/me', {
          headers: {
            Authorization: `bearer ${tokenData.access_token}`,
            'User-Agent': 'APMA-Political-Agent/1.0',
          },
        });
        const me = await meRes.json() as any;

        const acctId = await upsertAccount(sb, {
          client_id: st.clientId,
          platform: 'reddit',
          account_type: 'persona',
          account_id: me.id || me.name || 'unknown',
          account_name: me.name || me.id || 'Reddit Account',
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
        });
        if (acctId) newIds.push(acctId);
        st.status = 'completed';
        st.accountIds = newIds;
        st.expiresAt = Date.now() + 10 * 60_000;
        return res.send(successPage('Reddit', newIds.length));
      }

      default:
        throw new Error(`Unsupported OAuth platform: ${platform}`);
    }
  } catch (err: any) {
    console.error(`[APMA OAuth] callback error (${platform}):`, err.message);
    st.status = 'error';
    st.error = err.message || 'Unknown error during authorization';
    return res.send(errorPage(err.message || 'An unexpected error occurred.'));
  }
});
