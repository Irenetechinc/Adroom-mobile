-- Social account safety, feature control, and delivery state.
-- Run this in the Supabase SQL editor after feature_flags_migration.sql.
-- No Replit-managed service is required.

ALTER TABLE public.social_account_connections
  ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recipient_action_day DATE,
  ADD COLUMN IF NOT EXISTS recipient_actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

UPDATE public.social_account_connections
SET warmup_started_at = COALESCE(warmup_started_at, connected_at)
WHERE warmup_started_at IS NULL;

CREATE INDEX IF NOT EXISTS social_connections_cooldown_idx
  ON public.social_account_connections (status, cooldown_until);

-- These keys are deliberately separate:
-- *_connections controls whether a user may connect/use a provider.
-- *_coming_soon controls the user-facing availability state for new setup.
INSERT INTO public.feature_flags (flag_key, label, description, enabled) VALUES
  ('social_telegram_connections', 'Telegram personal connections', 'Allow Telegram user-account connections and automation', true),
  ('social_whatsapp_personal_connections', 'WhatsApp personal connections', 'Allow WhatsApp personal connections and automation', true),
  ('social_signal_personal_connections', 'Signal personal connections', 'Allow Signal personal connections and automation', true),
  ('social_bluesky_connections', 'Bluesky connections', 'Allow Bluesky connections and automation', true),
  ('social_delta_chat_connections', 'Delta Chat connections', 'Allow Delta Chat connections and automation', true),
  ('social_telegram_coming_soon', 'Telegram coming soon', 'Show Telegram as coming soon for new connections', false),
  ('social_whatsapp_personal_coming_soon', 'WhatsApp personal coming soon', 'Show WhatsApp personal as coming soon for new connections', false),
  ('social_signal_personal_coming_soon', 'Signal coming soon', 'Show Signal as coming soon for new connections', false),
  ('social_bluesky_coming_soon', 'Bluesky coming soon', 'Show Bluesky as coming soon for new connections', false),
  ('social_delta_chat_coming_soon', 'Delta Chat coming soon', 'Show Delta Chat as coming soon for new connections', false)
ON CONFLICT (flag_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';