-- ══════════════════════════════════════════════════════════════════════════════
-- AdRoom — Token Refresh Migration
-- Adds token_expires_at to ad_configs so the background TokenRefreshService
-- can track exactly when each platform's access token expires and refresh it
-- proactively (before the agents start failing with 401 errors).
-- Safe to run multiple times (idempotent).  Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- Timestamp of when the stored access_token expires.
-- Populated automatically by the backend TokenRefreshService after each
-- successful refresh.  NULL = unknown expiry (service will use updated_at
-- heuristic to decide when to refresh).
ALTER TABLE public.ad_configs
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- Index so the refresh sweep query is fast even with many users
CREATE INDEX IF NOT EXISTS ad_configs_token_expires_at_idx
  ON public.ad_configs (token_expires_at)
  WHERE token_expires_at IS NOT NULL;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

SELECT 'token_refresh migration complete' AS status;
