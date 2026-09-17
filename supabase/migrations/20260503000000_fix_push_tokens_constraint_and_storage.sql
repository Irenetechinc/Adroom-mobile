-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 1: device_push_tokens — replace partial index with a proper unique
--         constraint so ON CONFLICT (user_id, device_id) works correctly.
--
-- Root cause: migration 20260501000000_push_tokens_v2.sql created a PARTIAL
-- unique index (WHERE device_id IS NOT NULL). PostgreSQL's ON CONFLICT column
-- inference cannot match a partial index unless the exact WHERE clause is
-- repeated in the ON CONFLICT expression, which the Supabase JS SDK does not
-- support. This caused:
--   [PushRegister] Upsert failed: there is no unique or exclusion constraint
--   matching the ON CONFLICT specification
--
-- Fix: drop the partial index and add a real UNIQUE CONSTRAINT. NULL device_id
-- values are allowed in unique constraints (multiple NULLs coexist fine in
-- PostgreSQL), and the server already validates device_id as required.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the partial index that caused the ON CONFLICT mismatch
DROP INDEX IF EXISTS public.device_push_tokens_user_device_uidx;

-- Add a proper unique constraint (non-partial) on (user_id, device_id).
-- This is what ON CONFLICT (user_id, device_id) needs to resolve against.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'device_push_tokens_user_device_key'
      AND conrelid = 'public.device_push_tokens'::regclass
  ) THEN
    ALTER TABLE public.device_push_tokens
      ADD CONSTRAINT device_push_tokens_user_device_key
      UNIQUE (user_id, device_id);
  END IF;
END $$;

-- Keep the fast lookup index for active-token queries (separate from the
-- constraint index which PostgreSQL manages automatically).
CREATE INDEX IF NOT EXISTS device_push_tokens_user_active_idx
  ON public.device_push_tokens (user_id)
  WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fix 2: Supabase Storage — create the `creative-assets` bucket.
--
-- Root cause: No migration or dashboard step ever created this bucket. Every
-- upload in CreativeService, SmartVideoEditor, and the /api/video/upload route
-- targets `storage.from('creative-assets')`, which throws:
--   [VideoUpload] Error: Bucket not found
--
-- The server startup now auto-creates the bucket via the JS SDK (ensureStorage
-- Buckets in server.ts), but this SQL migration ensures the bucket also exists
-- when the database schema is provisioned fresh (e.g. new environment, CI, or
-- Supabase project reset).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'creative-assets',
  'creative-assets',
  true,       -- public: URLs are readable without auth
  null,       -- no server-side size cap (multer enforces 200 MB app-side)
  null        -- accept all MIME types (images + videos)
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to read objects in this bucket (public read is
-- already granted by bucket.public=true, but an explicit policy is cleaner).
CREATE POLICY "Public read creative-assets" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'creative-assets');

-- Allow the service role (used by the Railway backend) to upload / delete.
-- Service role bypasses RLS automatically, so this policy covers the anon
-- key path (mobile direct uploads if ever needed in the future).
CREATE POLICY "Authenticated upload creative-assets" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'creative-assets');

CREATE POLICY "Authenticated delete own creative-assets" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'creative-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';
