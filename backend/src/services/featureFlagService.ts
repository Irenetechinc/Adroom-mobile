import { getServiceSupabaseClient } from '../config/supabase';

export interface FeatureFlag {
  flag_key:    string;
  label:       string;
  description: string | null;
  enabled:     boolean;
  updated_at:  string;
  updated_by:  string | null;
}

export interface UserOverride {
  user_id:    string;
  flag_key:   string;
  enabled:    boolean;
  updated_at: string;
  updated_by: string | null;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;

let globalFlagsCache:   { data: FeatureFlag[]; ts: number } | null = null;
const userOverrideCache = new Map<string, { data: UserOverride[]; ts: number }>();

function globalCacheExpired(): boolean {
  return !globalFlagsCache || Date.now() - globalFlagsCache.ts > CACHE_TTL_MS;
}
function userCacheExpired(userId: string): boolean {
  const entry = userOverrideCache.get(userId);
  return !entry || Date.now() - entry.ts > CACHE_TTL_MS;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchGlobalFlags(): Promise<FeatureFlag[]> {
  if (!globalCacheExpired()) return globalFlagsCache!.data;
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb
    .from('feature_flags')
    .select('*')
    .order('flag_key');
  if (error) {
    console.error('[FeatureFlags] Failed to load global flags:', error.message);
    return globalFlagsCache?.data ?? [];
  }
  globalFlagsCache = { data: data as FeatureFlag[], ts: Date.now() };
  return globalFlagsCache.data;
}

async function fetchUserOverrides(userId: string): Promise<UserOverride[]> {
  if (!userCacheExpired(userId)) return userOverrideCache.get(userId)!.data;
  const sb = getServiceSupabaseClient();
  const { data, error } = await sb
    .from('user_feature_overrides')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    console.error('[FeatureFlags] Failed to load user overrides:', error.message);
    return userOverrideCache.get(userId)?.data ?? [];
  }
  userOverrideCache.set(userId, { data: data as UserOverride[], ts: Date.now() });
  return userOverrideCache.get(userId)!.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a feature is enabled for a user.
 * User-level overrides take precedence over the global flag.
 * Falls back to TRUE if the flag doesn't exist (new code before migration).
 */
export async function isEnabled(flagKey: string, userId?: string): Promise<boolean> {
  const [flags, overrides] = await Promise.all([
    fetchGlobalFlags(),
    userId ? fetchUserOverrides(userId) : Promise.resolve([] as UserOverride[]),
  ]);

  const userOverride = overrides.find(o => o.flag_key === flagKey);
  if (userOverride !== undefined) return userOverride.enabled;

  const globalFlag = flags.find(f => f.flag_key === flagKey);
  if (globalFlag !== undefined) return globalFlag.enabled;

  return true;
}

/** Returns all global flags (for admin & mobile list endpoint). */
export async function getAllFlags(): Promise<FeatureFlag[]> {
  return fetchGlobalFlags();
}

/** Returns all overrides for one user. */
export async function getUserOverrides(userId: string): Promise<UserOverride[]> {
  return fetchUserOverrides(userId);
}

/**
 * Returns flags merged with user overrides — ready to send to the mobile app.
 * Each entry has the effective enabled value for that user.
 */
export async function getFlagsForUser(userId: string): Promise<{ flag_key: string; enabled: boolean }[]> {
  const [flags, overrides] = await Promise.all([
    fetchGlobalFlags(),
    fetchUserOverrides(userId),
  ]);
  const overrideMap = new Map(overrides.map(o => [o.flag_key, o.enabled]));
  return flags.map(f => ({
    flag_key: f.flag_key,
    enabled:  overrideMap.has(f.flag_key) ? overrideMap.get(f.flag_key)! : f.enabled,
  }));
}

// ─── Admin mutations ──────────────────────────────────────────────────────────

export async function setGlobalFlag(
  flagKey: string,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  const sb = getServiceSupabaseClient();
  const { error } = await sb
    .from('feature_flags')
    .update({ enabled, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('flag_key', flagKey);
  if (error) throw new Error(error.message);
  globalFlagsCache = null;
}

export async function setUserOverride(
  userId: string,
  flagKey: string,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  const sb = getServiceSupabaseClient();
  const { error } = await sb
    .from('user_feature_overrides')
    .upsert(
      { user_id: userId, flag_key: flagKey, enabled, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: 'user_id,flag_key' },
    );
  if (error) throw new Error(error.message);
  userOverrideCache.delete(userId);
}

export async function removeUserOverride(
  userId: string,
  flagKey: string,
): Promise<void> {
  const sb = getServiceSupabaseClient();
  const { error } = await sb
    .from('user_feature_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('flag_key', flagKey);
  if (error) throw new Error(error.message);
  userOverrideCache.delete(userId);
}

/** Wipe all in-memory caches (call after bulk changes). */
export function invalidateCache(): void {
  globalFlagsCache = null;
  userOverrideCache.clear();
}
