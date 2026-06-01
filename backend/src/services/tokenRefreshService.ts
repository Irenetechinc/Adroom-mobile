/**
 * TokenRefreshService
 * ──────────────────
 * Proactively refreshes expiring OAuth access tokens for every connected
 * platform so the AI agents never hit a 401 mid-campaign.
 *
 * Runs every 6 hours via the SchedulerService.
 *
 * Refresh strategy per platform
 * ──────────────────────────────
 * Facebook / Instagram / WhatsApp
 *   • No refresh_token; use the fb_exchange_token flow instead.
 *   • Long-lived tokens last 60 days → refresh when ≤ 7 days remain,
 *     or when updated_at is > 45 days ago (fallback if token_expires_at null).
 *
 * LinkedIn
 *   • Refresh token grant.  Access token lasts 60 days, refresh token 365 days.
 *   • Refresh when ≤ 7 days remain, or updated_at > 50 days ago.
 *
 * Twitter
 *   • Refresh token grant.  Access token lasts 2 hours.
 *   • Refresh when updated_at > 1.5 hours ago (token_expires_at will be set
 *     after first backend-side refresh).
 *
 * TikTok
 *   • Refresh token grant.  Access token lasts 24 hours.
 *   • Refresh when ≤ 2 hours remain, or updated_at > 20 hours ago.
 */

import { getServiceSupabaseClient } from '../config/supabase';

const FB_APP_ID         = process.env.FB_APP_ID;
const FB_APP_SECRET     = process.env.FB_APP_SECRET;
const LINKEDIN_CLIENT_ID     = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const TWITTER_CLIENT_ID      = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET  = process.env.TWITTER_CLIENT_SECRET;
const TIKTOK_CLIENT_KEY      = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET   = process.env.TIKTOK_CLIENT_SECRET;

interface RefreshResult {
  platform: string;
  userId: string;
  success: boolean;
  newExpiresAt?: string;
  error?: string;
}

interface TokenRow {
  user_id: string;
  platform: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  updated_at: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Retry a fetch up to maxAttempts on network errors or 5xx. */
async function retryFetch(
  url: string,
  options?: RequestInit,
  maxAttempts = 3,
  baseMs = 400,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && i < maxAttempts) {
        await delay(baseMs * i);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < maxAttempts) await delay(baseMs * i);
    }
  }
  throw lastErr;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Service ─────────────────────────────────────────────────────────────────

export class TokenRefreshService {

  /**
   * Main entry point called by the scheduler every 6 hours.
   * Fetches all ad_configs rows with a non-null access_token, decides which
   * ones need refreshing, and calls the platform-specific refresh logic.
   */
  async refreshExpiring(): Promise<void> {
    const supabase = getServiceSupabaseClient();
    const now = new Date();

    const { data: configs, error } = await supabase
      .from('ad_configs')
      .select('user_id, platform, access_token, refresh_token, token_expires_at, updated_at')
      .not('access_token', 'is', null);

    if (error) {
      console.error('[TokenRefresh] DB fetch error:', error.message);
      return;
    }

    const rows = (configs ?? []) as TokenRow[];
    if (!rows.length) return;

    const toRefresh = rows.filter(r => this.needsRefresh(r, now));
    if (!toRefresh.length) return;

    console.log(`[TokenRefresh] ${toRefresh.length} token(s) due for refresh`);

    const results = await Promise.allSettled(
      toRefresh.map(r => this.refresh(r)),
    );

    let ok = 0, fail = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) ok++;
      else fail++;
    }

    if (ok + fail > 0) {
      console.log(`[TokenRefresh] Cycle done — ✓ ${ok} refreshed, ✗ ${fail} failed`);
    }
  }

  // ── Decision logic ────────────────────────────────────────────────────────

  private needsRefresh(row: TokenRow, now: Date): boolean {
    const platform = row.platform;
    const expiresAt  = row.token_expires_at ? new Date(row.token_expires_at) : null;
    const updatedAt  = row.updated_at       ? new Date(row.updated_at)       : null;

    if (expiresAt) {
      // Use the explicit expiry if we have it
      const threshold = this.thresholdBeforeExpiry(platform);
      return expiresAt.getTime() - now.getTime() < threshold;
    }

    // Fallback: use updated_at as "last refreshed at" proxy
    if (!updatedAt) return true;
    const ageMs    = now.getTime() - updatedAt.getTime();
    const ageDays  = ageMs / 86_400_000;
    const ageHours = ageMs / 3_600_000;

    switch (platform) {
      case 'facebook':
      case 'instagram':
      case 'whatsapp':
        return ageDays >= 45;          // 60-day tokens; refresh at 45 days
      case 'linkedin':
        return ageDays >= 50;          // 60-day tokens; refresh at 50 days
      case 'twitter':
        return !!row.refresh_token && ageHours >= 1.5;  // 2-hour tokens
      case 'tiktok':
        return !!row.refresh_token && ageHours >= 20;   // 24-hour tokens
      default:
        return false;
    }
  }

  /** How far before expiry we kick off the refresh (in ms). */
  private thresholdBeforeExpiry(platform: string): number {
    switch (platform) {
      case 'twitter': return 30 * 60 * 1000;          // 30 min before
      case 'tiktok':  return 2  * 60 * 60 * 1000;     // 2 hr before
      default:        return 7  * 24 * 60 * 60 * 1000; // 7 days before
    }
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  private async refresh(row: TokenRow): Promise<RefreshResult> {
    try {
      switch (row.platform) {
        case 'facebook':
        case 'instagram':
        case 'whatsapp':
          return await this.refreshFacebook(row);
        case 'linkedin':
          return await this.refreshLinkedIn(row);
        case 'twitter':
          return await this.refreshTwitter(row);
        case 'tiktok':
          return await this.refreshTikTok(row);
        default:
          return { platform: row.platform, userId: row.user_id, success: false, error: 'unsupported' };
      }
    } catch (e: any) {
      console.error(`[TokenRefresh] ${row.platform} user ${row.user_id}: ${e.message}`);
      return { platform: row.platform, userId: row.user_id, success: false, error: e.message };
    }
  }

  // ── Platform implementations ──────────────────────────────────────────────

  /**
   * Facebook / Instagram / WhatsApp
   * Uses the fb_exchange_token flow — no refresh_token needed.
   * Works with any valid user access token (short- or long-lived).
   */
  private async refreshFacebook(row: TokenRow): Promise<RefreshResult> {
    if (!FB_APP_ID || !FB_APP_SECRET) {
      return { platform: row.platform, userId: row.user_id, success: false, error: 'FB credentials not configured' };
    }
    if (!row.access_token) {
      return { platform: row.platform, userId: row.user_id, success: false, error: 'no access_token' };
    }

    const params = new URLSearchParams({
      grant_type:       'fb_exchange_token',
      client_id:        FB_APP_ID,
      client_secret:    FB_APP_SECRET,
      fb_exchange_token: row.access_token,
    });

    const res  = await retryFetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params}`);
    const data: any = await res.json();

    if (!res.ok || !data.access_token) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      console.warn(`[TokenRefresh] ${row.platform} user ${row.user_id} refresh failed: ${msg}`);
      return { platform: row.platform, userId: row.user_id, success: false, error: msg };
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null;

    await this.persist(row.user_id, row.platform, {
      access_token: data.access_token,
      token_expires_at: expiresAt,
    });

    console.log(`[TokenRefresh] ✓ ${row.platform} user ${row.user_id} — expires ${expiresAt ?? 'unknown'}`);
    return { platform: row.platform, userId: row.user_id, success: true, newExpiresAt: expiresAt ?? undefined };
  }

  /**
   * LinkedIn — refresh_token grant.
   * Returns a new access_token (and sometimes a new refresh_token).
   */
  private async refreshLinkedIn(row: TokenRow): Promise<RefreshResult> {
    if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
      return { platform: 'linkedin', userId: row.user_id, success: false, error: 'LinkedIn credentials not configured' };
    }
    if (!row.refresh_token) {
      return { platform: 'linkedin', userId: row.user_id, success: false, error: 'no refresh_token stored' };
    }

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: row.refresh_token,
      client_id:     LINKEDIN_CLIENT_ID,
      client_secret: LINKEDIN_CLIENT_SECRET,
    });

    const res  = await retryFetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    const data: any = await res.json();

    if (!res.ok || !data.access_token) {
      const msg = data?.error_description || data?.error || `HTTP ${res.status}`;
      console.warn(`[TokenRefresh] linkedin user ${row.user_id} refresh failed: ${msg}`);
      return { platform: 'linkedin', userId: row.user_id, success: false, error: msg };
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null;

    await this.persist(row.user_id, 'linkedin', {
      access_token:  data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      token_expires_at: expiresAt,
    });

    console.log(`[TokenRefresh] ✓ linkedin user ${row.user_id} — expires ${expiresAt ?? 'unknown'}`);
    return { platform: 'linkedin', userId: row.user_id, success: true, newExpiresAt: expiresAt ?? undefined };
  }

  /**
   * Twitter — refresh_token grant.
   * Access tokens last ~2 hours; refresh tokens are valid until revoked.
   */
  private async refreshTwitter(row: TokenRow): Promise<RefreshResult> {
    if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
      return { platform: 'twitter', userId: row.user_id, success: false, error: 'Twitter credentials not configured' };
    }
    if (!row.refresh_token) {
      return { platform: 'twitter', userId: row.user_id, success: false, error: 'no refresh_token stored' };
    }

    const basic = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');
    const body  = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: row.refresh_token,
      client_id:     TWITTER_CLIENT_ID,
    });

    const res  = await retryFetch('https://api.twitter.com/2/oauth2/token', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${basic}`,
      },
      body: body.toString(),
    });
    const data: any = await res.json();

    if (!res.ok || !data.access_token) {
      const msg = data?.error_description || data?.error || `HTTP ${res.status}`;
      console.warn(`[TokenRefresh] twitter user ${row.user_id} refresh failed: ${msg}`);
      return { platform: 'twitter', userId: row.user_id, success: false, error: msg };
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null;

    await this.persist(row.user_id, 'twitter', {
      access_token:  data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      token_expires_at: expiresAt,
    });

    console.log(`[TokenRefresh] ✓ twitter user ${row.user_id} — expires ${expiresAt ?? 'unknown'}`);
    return { platform: 'twitter', userId: row.user_id, success: true, newExpiresAt: expiresAt ?? undefined };
  }

  /**
   * TikTok — refresh_token grant.
   * Access tokens last 24 hours; refresh tokens last 365 days.
   */
  private async refreshTikTok(row: TokenRow): Promise<RefreshResult> {
    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
      return { platform: 'tiktok', userId: row.user_id, success: false, error: 'TikTok credentials not configured' };
    }
    if (!row.refresh_token) {
      return { platform: 'tiktok', userId: row.user_id, success: false, error: 'no refresh_token stored' };
    }

    const body = new URLSearchParams({
      client_key:    TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: row.refresh_token,
    });

    const res  = await retryFetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    const raw: any  = await res.json();
    const data: any = raw?.data ?? raw; // TikTok sometimes wraps in .data

    if (!res.ok || !data?.access_token) {
      const msg = raw?.message || raw?.error?.description || `HTTP ${res.status}`;
      console.warn(`[TokenRefresh] tiktok user ${row.user_id} refresh failed: ${msg}`);
      return { platform: 'tiktok', userId: row.user_id, success: false, error: msg };
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : null;

    await this.persist(row.user_id, 'tiktok', {
      access_token:  data.access_token,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
      token_expires_at: expiresAt,
    });

    console.log(`[TokenRefresh] ✓ tiktok user ${row.user_id} — expires ${expiresAt ?? 'unknown'}`);
    return { platform: 'tiktok', userId: row.user_id, success: true, newExpiresAt: expiresAt ?? undefined };
  }

  // ── Persistence helper ────────────────────────────────────────────────────

  private async persist(
    userId: string,
    platform: string,
    fields: Record<string, string | null>,
  ): Promise<void> {
    const supabase = getServiceSupabaseClient();
    const { error } = await supabase
      .from('ad_configs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('platform', platform);

    if (error) {
      console.error(`[TokenRefresh] DB persist error for ${platform} user ${userId}:`, error.message);
      throw new Error(error.message);
    }
  }
}

export const tokenRefreshService = new TokenRefreshService();
