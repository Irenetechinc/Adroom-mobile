-- Push tokens v2: per-device dedupe + active state + last seen tracking
-- Production push notifications require knowing WHICH physical device a token
-- belongs to (Expo tokens rotate; users reinstall; users sign in across devices).
-- We track a stable per-install device_id so re-registrations replace the old
-- row instead of piling up stale tokens that Expo will reject as
-- DeviceNotRegistered.

ALTER TABLE public.device_push_tokens
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- One active row per (user, device). Partial index so legacy NULL device_id
-- rows (pre-migration) don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_user_device_uidx
  ON public.device_push_tokens (user_id, device_id)
  WHERE device_id IS NOT NULL;

-- Fast lookup of all active tokens for a user when sending a push.
CREATE INDEX IF NOT EXISTS device_push_tokens_user_active_idx
  ON public.device_push_tokens (user_id)
  WHERE is_active = TRUE;
