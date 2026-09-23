import { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabaseClient } from '../config/supabase';
import { isPersonalProvider, normalizePlatform, normalizeSelectedPlatforms } from './platformIdentity';

/**
 * Reconnect warnings are user-action notifications, not generic execution
 * errors. Keep the eligibility rule in one place so scheduler, token refresh,
 * and personal-account paths cannot drift.
 */
export async function canNotifyReconnect(
  userId: string,
  provider: string,
  client: SupabaseClient = getServiceSupabaseClient(),
): Promise<boolean> {
  const normalized = normalizePlatform(provider);
  const { data: strategies, error: strategyError } = await client
    .from('strategies')
    .select('selected_accounts, platforms')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('status', 'active');

  if (strategyError) {
    console.error(`[ReconnectEligibility] strategy lookup failed for ${normalized}: ${strategyError.message}`);
    return false;
  }

  const selected = (strategies || []).some((strategy: any) => {
    const values = strategy.selected_accounts ?? strategy.platforms;
    return normalizeSelectedPlatforms(values).includes(normalized);
  });
  if (!selected) return false;

  if (isPersonalProvider(normalized)) {
    const { data, error } = await client
      .from('social_account_connections')
      .select('id,status')
      .eq('user_id', userId)
      .eq('provider', normalized)
      .maybeSingle();
    if (error) {
      console.error(`[ReconnectEligibility] personal account lookup failed for ${normalized}: ${error.message}`);
      return false;
    }
    return Boolean(data?.id && String(data.status) === 'needs_reconnect');
  }

  const aliases = normalized === 'twitter' ? ['twitter', 'x'] : [normalized];
  const { data, error } = await client
    .from('ad_configs')
    .select('platform,access_token')
    .eq('user_id', userId)
    .in('platform', aliases)
    .maybeSingle();
  if (error) {
    console.error(`[ReconnectEligibility] legacy account lookup failed for ${normalized}: ${error.message}`);
    return false;
  }
  // The row proves the account was actually connected. A null token is the
  // actionable state after a hard refresh failure.
  return Boolean(data?.platform && !data.access_token);
}