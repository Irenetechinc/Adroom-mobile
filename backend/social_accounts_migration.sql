-- Personal social-account connections.
-- Provider credentials/session blobs are encrypted by the backend before they
-- are stored. The mobile app only receives safe display metadata.

CREATE TABLE IF NOT EXISTS public.social_account_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_id TEXT,
  display_name TEXT,
  handle TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  credential_ciphertext TEXT,
  credential_iv TEXT,
  credential_tag TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  daily_limit INTEGER NOT NULL DEFAULT 20,
  actions_today INTEGER NOT NULL DEFAULT 0,
  action_day DATE NOT NULL DEFAULT CURRENT_DATE,
  last_action_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS social_connections_user_idx
  ON public.social_account_connections (user_id);

CREATE INDEX IF NOT EXISTS social_connections_status_idx
  ON public.social_account_connections (provider, status);

ALTER TABLE public.social_account_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their social connections"
  ON public.social_account_connections;
CREATE POLICY "Users can view their social connections"
  ON public.social_account_connections FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their social connections"
  ON public.social_account_connections;
CREATE POLICY "Users can delete their social connections"
  ON public.social_account_connections FOR DELETE
  USING (auth.uid() = user_id);

-- These rows are written by the authenticated backend with the service role.
-- Clients must never be allowed to insert/update credential columns directly.

ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS connection_type TEXT;
ALTER TABLE public.ad_configs ADD COLUMN IF NOT EXISTS account_id TEXT;

INSERT INTO feature_flags (flag_key, label, description, enabled) VALUES
  ('telegram_personal', 'Telegram Personal Accounts', 'Connect a Telegram user account for autonomous conversations', true),
  ('whatsapp_personal', 'WhatsApp Personal Accounts', 'Connect WhatsApp through a secure pairing code', true),
  ('signal_personal', 'Signal Personal Accounts', 'Connect Signal through phone verification', true),
  ('bluesky_personal', 'Bluesky Accounts', 'Connect Bluesky with a handle and app password', true)
ON CONFLICT (flag_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';