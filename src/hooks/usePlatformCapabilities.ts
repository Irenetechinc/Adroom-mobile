import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export type PlatformCapability = {
  provider: string;
  enabled: boolean;
  comingSoon: boolean;
  configured: boolean;
  available: boolean;
  reason: 'disabled' | 'coming_soon' | 'missing_server_configuration' | 'bridge_unavailable' | 'available' | string;
};

export function usePlatformCapabilities() {
  const [capabilities, setCapabilities] = useState<Record<string, PlatformCapability>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !BACKEND_URL) return;
      const response = await fetch(`${BACKEND_URL}/api/platform-capabilities`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) return;
      const json = await response.json();
      const next: Record<string, PlatformCapability> = {};
      for (const capability of json.capabilities || []) next[capability.provider] = capability;
      setCapabilities(next);
    } catch {
      // Account screens remain usable with their existing flag/config data.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { capabilities, loading, reload: load };
}

export default usePlatformCapabilities;