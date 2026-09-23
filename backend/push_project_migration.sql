-- Project-aware Expo push registration.
-- Run in Supabase SQL editor. This is required for mixed-project token cleanup.

ALTER TABLE public.device_push_tokens
  ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS device_push_tokens_active_project_idx
  ON public.device_push_tokens (user_id, project_id)
  WHERE is_active = true;

NOTIFY pgrst, 'reload schema';