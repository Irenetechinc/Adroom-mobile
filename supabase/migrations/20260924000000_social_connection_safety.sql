ALTER TABLE public.social_account_connections
  ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recipient_action_day DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS recipient_actions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS social_connections_cooldown_idx
  ON public.social_account_connections (status, cooldown_until);

INSERT INTO public.feature_flags (flag_key, label, description, enabled) VALUES
  ('social_facebook_connections', 'Facebook connections', 'Allow Facebook account connections', true),
  ('social_instagram_connections', 'Instagram connections', 'Allow Instagram account connections', true),
  ('social_tiktok_connections', 'TikTok connections', 'Allow TikTok account connections', true),
  ('social_twitter_connections', 'X / Twitter connections', 'Allow X / Twitter account connections', true),
  ('social_linkedin_connections', 'LinkedIn connections', 'Allow LinkedIn account connections', true),
  ('social_whatsapp_connections', 'WhatsApp Business connections', 'Allow WhatsApp Business account connections', true),
  ('social_google_connections', 'Google connections', 'Allow Google account connections', true),
  ('social_telegram_connections', 'Telegram personal connections', 'Allow Telegram personal account connections', true),
  ('social_whatsapp_personal_connections', 'WhatsApp personal connections', 'Allow WhatsApp personal account connections', true),
  ('social_signal_personal_connections', 'Signal personal connections', 'Allow Signal personal account connections', true),
  ('social_bluesky_connections', 'Bluesky connections', 'Allow Bluesky account connections', true),
  ('social_delta_chat_connections', 'Delta Chat connections', 'Allow Delta Chat connections when a supported runtime is configured', false)
ON CONFLICT (flag_key) DO NOTHING;