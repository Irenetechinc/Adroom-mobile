-- ══════════════════════════════════════════════════════════════════════════════
-- AdRoom — ad_configs Missing Columns Migration
-- Adds every platform-specific column that the app writes but the base table
-- never defined.  Safe to run multiple times (all statements are idempotent).
-- Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Core columns missing from the original 2025-01 table ─────────────────────

-- Human-readable account / page name (all platforms)
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS page_name TEXT;

-- OAuth refresh token (TikTok; reserved for others)
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS refresh_token TEXT;

-- TikTok Open ID (unique per user per app)
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS open_id TEXT;

-- ── LinkedIn-specific ─────────────────────────────────────────────────────────

-- LinkedIn personal URN (urn:li:person:…)
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS person_urn TEXT;

-- LinkedIn organisation URN (urn:li:organization:…) for company pages
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS org_urn TEXT;

-- ── Facebook / Instagram ──────────────────────────────────────────────────────

-- Instagram Professional Account ID linked to a Facebook Page
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS instagram_account_id TEXT;

-- ── Ensure ad_account_id is nullable (some platforms don't use it) ────────────
ALTER TABLE public.ad_configs ALTER COLUMN ad_account_id DROP NOT NULL;

-- ── Ensure page_id is nullable (WhatsApp uses page_id = phone_number_id) ──────
ALTER TABLE public.ad_configs ALTER COLUMN page_id DROP NOT NULL;

-- ── Ensure access_token is nullable during upsert flows ──────────────────────
ALTER TABLE public.ad_configs ALTER COLUMN access_token DROP NOT NULL;

-- ── Ensure the (user_id, platform) unique constraint exists ──────────────────
-- (Added by 20260309 migration, but guard here in case that wasn't run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_configs_user_id_platform_key'
  ) THEN
    -- Drop the old single-column unique constraint if still present
    ALTER TABLE public.ad_configs DROP CONSTRAINT IF EXISTS ad_configs_user_id_key;
    ALTER TABLE public.ad_configs ADD CONSTRAINT ad_configs_user_id_platform_key
      UNIQUE (user_id, platform);
  END IF;
END $$;

-- ── Ensure platform column exists and defaults to 'facebook' ─────────────────
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'facebook';

-- Reload PostgREST schema cache so new columns are immediately visible
NOTIFY pgrst, 'reload schema';

SELECT 'ad_configs migration complete' AS status;
