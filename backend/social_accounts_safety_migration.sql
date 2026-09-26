-- Social account safety, feature control, and delivery state.
-- Run this in the Supabase SQL editor after feature_flags_migration.sql.
-- No editor-managed service is required.

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

-- Every reservation is recorded without storing a recipient address or
-- provider credential. The service role writes these rows; users may only
-- read their own safe audit entries.
CREATE TABLE IF NOT EXISTS public.social_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  recipient_hash TEXT,
  error_code TEXT,
  safe_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_action_log_user_created_idx
  ON public.social_action_log (user_id, created_at DESC);

ALTER TABLE public.social_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their social action logs"
  ON public.social_action_log;
CREATE POLICY "Users can view their social action logs"
  ON public.social_action_log FOR SELECT
  USING (auth.uid() = user_id);

-- Atomically reserve a personal-account action. The row lock prevents
-- concurrent Railway scheduler instances from exceeding account or recipient
-- limits. Warm-up is intentionally conservative for newly connected accounts:
-- 3 actions on day 0, 5 through day 2, 10 through day 6, then the configured
-- daily limit. A reservation is consumed even when the provider later fails.
CREATE OR REPLACE FUNCTION public.reserve_social_action(
  p_user_id UUID,
  p_provider TEXT,
  p_recipient_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection public.social_account_connections%ROWTYPE;
  v_today DATE := CURRENT_DATE;
  v_warmup_days INTEGER;
  v_warmup_limit INTEGER;
  v_account_limit INTEGER;
  v_recipient_count INTEGER := 0;
  v_actions JSONB;
  v_next_actions INTEGER;
BEGIN
  SELECT *
    INTO v_connection
    FROM public.social_account_connections
   WHERE user_id = p_user_id
     AND provider = lower(trim(p_provider))
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'connection_missing');
  END IF;

  IF v_connection.status <> 'connected' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'connection_not_ready');
  END IF;

  IF v_connection.cooldown_until IS NOT NULL
     AND v_connection.cooldown_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'cooldown',
      'cooldown_until', v_connection.cooldown_until
    );
  END IF;

  IF v_connection.action_day IS DISTINCT FROM v_today THEN
    v_connection.actions_today := 0;
    v_connection.action_day := v_today;
  END IF;

  IF v_connection.recipient_action_day IS DISTINCT FROM v_today THEN
    v_connection.recipient_action_day := v_today;
    v_connection.recipient_actions := '{}'::jsonb;
  END IF;

  v_warmup_days := GREATEST(
    0,
    v_today - COALESCE(v_connection.warmup_started_at::date, v_today)
  );
  v_warmup_limit := CASE
    WHEN v_warmup_days < 1 THEN 3
    WHEN v_warmup_days < 3 THEN 5
    WHEN v_warmup_days < 7 THEN 10
    ELSE 200
  END;
  v_account_limit := LEAST(
    GREATEST(COALESCE(v_connection.daily_limit, 20), 1),
    v_warmup_limit
  );

  IF v_connection.actions_today >= v_account_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'actions_today', v_connection.actions_today,
      'daily_limit', v_account_limit
    );
  END IF;

  IF NULLIF(trim(COALESCE(p_recipient_hash, '')), '') IS NOT NULL THEN
    v_recipient_count := COALESCE(
      NULLIF(v_connection.recipient_actions ->> trim(p_recipient_hash), '')::INTEGER,
      0
    );
    -- Personal outreach must not repeatedly hit one recipient in one day.
    IF v_recipient_count >= 3 THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'recipient_limit',
        'recipient_daily_limit', 3
      );
    END IF;
    v_actions := jsonb_set(
      COALESCE(v_connection.recipient_actions, '{}'::jsonb),
      ARRAY[trim(p_recipient_hash)],
      to_jsonb(v_recipient_count + 1),
      true
    );
  ELSE
    v_actions := COALESCE(v_connection.recipient_actions, '{}'::jsonb);
  END IF;

  v_next_actions := v_connection.actions_today + 1;
  UPDATE public.social_account_connections
     SET actions_today = v_next_actions,
         action_day = v_today,
         recipient_action_day = v_today,
         recipient_actions = v_actions,
         last_action_at = now(),
         updated_at = now()
   WHERE id = v_connection.id;

  INSERT INTO public.social_action_log (
    user_id, provider, action_type, status, recipient_hash
  ) VALUES (
    p_user_id, lower(trim(p_provider)), 'send_personal_message',
    'reserved', NULLIF(trim(COALESCE(p_recipient_hash, '')), '')
  );

  RETURN jsonb_build_object(
    'allowed', true,
    'actions_today', v_next_actions,
    'daily_limit', v_account_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_social_action(UUID, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_social_action(UUID, TEXT, TEXT)
  TO service_role;

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