-- Repair for deployments where lead_profile_builder_runs already exists but
-- the progress columns were not applied or are missing from PostgREST cache.
-- Run this in the authoritative Supabase SQL editor, then restart the backend.

ALTER TABLE public.lead_profile_builder_runs
  ADD COLUMN IF NOT EXISTS active_tool text,
  ADD COLUMN IF NOT EXISTS active_platform text,
  ADD COLUMN IF NOT EXISTS active_tool_status text,
  ADD COLUMN IF NOT EXISTS active_tool_error text;

NOTIFY pgrst, 'reload schema';