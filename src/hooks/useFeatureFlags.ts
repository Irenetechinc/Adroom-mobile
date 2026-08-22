import { useEffect, useRef, useState } from 'react';
import { supabase } from '../config/supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const CACHE_TTL_MS = 30 * 1000;

interface FlagMap { [key: string]: boolean }

let cachedFlags: FlagMap | null = null;
let cacheTs   = 0;
let inflight:   Promise<FlagMap> | null = null;

async function loadFlags(): Promise<FlagMap> {
  if (cachedFlags && Date.now() - cacheTs < CACHE_TTL_MS) return cachedFlags;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return {};

      const res = await fetch(`${BACKEND_URL}/api/feature-flags`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return cachedFlags ?? {};
      const json = await res.json();
      const map: FlagMap = {};
      for (const f of json.flags ?? []) map[f.flag_key] = f.enabled;
      cachedFlags = map;
      cacheTs     = Date.now();
      return map;
    } catch {
      return cachedFlags ?? {};
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Invalidate the in-memory cache (e.g. after login). */
export function invalidateFeatureFlagCache(): void {
  cachedFlags = null;
  cacheTs     = 0;
}

/**
 * React hook — resolves feature flags for the current user.
 *
 * ```ts
 * const { isEnabled } = useFeatureFlags();
 * if (!isEnabled('strategy_creation')) return <FeatureLockedScreen />;
 * ```
 *
 * Defaults to `true` while loading or on error so existing screens are
 * never accidentally hidden due to a network hiccup.
 */
export function useFeatureFlags() {
  const [flags, setFlags] = useState<FlagMap>(cachedFlags ?? {});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadFlags().then(map => {
      if (mountedRef.current) setFlags(map);
    });
    return () => { mountedRef.current = false; };
  }, []);

  const isEnabled = (key: string): boolean => flags[key] ?? true;

  return { isEnabled, flags };
}

export default useFeatureFlags;
