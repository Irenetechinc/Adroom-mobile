-- Consent-first autonomous calling campaigns. Existing call_logs and strategies
-- remain the single execution and strategy records used by the call pipeline.

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS contact_timezone text,
  ADD COLUMN IF NOT EXISTS call_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_consent_source text;

CREATE TABLE IF NOT EXISTS public.call_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.strategies(id) ON DELETE SET NULL,
  name text NOT NULL,
  goal text NOT NULL,
  product_name text NOT NULL,
  product_description text NOT NULL,
  product_image_url text,
  product_price text,
  follow_up_days integer NOT NULL DEFAULT 7 CHECK (follow_up_days BETWEEN 1 AND 90),
  default_timezone text NOT NULL,
  calling_start_hour smallint NOT NULL DEFAULT 9 CHECK (calling_start_hour BETWEEN 0 AND 23),
  calling_end_hour smallint NOT NULL DEFAULT 17 CHECK (calling_end_hour BETWEEN 1 AND 24),
  daily_limit integer NOT NULL DEFAULT 25 CHECK (daily_limit BETWEEN 1 AND 25),
  max_attempts smallint NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_approval', 'approved', 'running', 'paused', 'stopped', 'completed')),
  generated_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  failure_reason text,
  approved_at timestamptz,
  started_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (calling_start_hour < calling_end_hour)
);

CREATE INDEX IF NOT EXISTS call_campaigns_user_status_idx
  ON public.call_campaigns(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS call_campaigns_running_idx
  ON public.call_campaigns(status, updated_at)
  WHERE status = 'running';

ALTER TABLE public.call_campaigns ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'call_campaigns'
      AND policyname = 'Users read own call campaigns'
  ) THEN
    CREATE POLICY "Users read own call campaigns" ON public.call_campaigns
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
GRANT SELECT ON public.call_campaigns TO authenticated;

CREATE TABLE IF NOT EXISTS public.call_campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.call_campaigns(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.agent_leads(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone_e164 text NOT NULL,
  email text,
  company text,
  notes text,
  time_zone text NOT NULL,
  call_consent boolean NOT NULL DEFAULT false,
  consent_confirmed boolean NOT NULL DEFAULT false,
  consent_source text,
  consent_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduling', 'queued', 'calling', 'completed', 'no_answer', 'failed', 'converted', 'opted_out', 'blocked', 'stopped')),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_call_id uuid,
  last_finalized_call_id uuid,
  last_outcome text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS call_campaign_contacts_due_idx
  ON public.call_campaign_contacts(campaign_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS call_campaign_contacts_user_phone_idx
  ON public.call_campaign_contacts(user_id, phone_e164);

ALTER TABLE public.call_campaign_contacts ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'call_campaign_contacts'
      AND policyname = 'Users read own call campaign contacts'
  ) THEN
    CREATE POLICY "Users read own call campaign contacts" ON public.call_campaign_contacts
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
GRANT SELECT ON public.call_campaign_contacts TO authenticated;

CREATE TABLE IF NOT EXISTS public.call_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  source text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS call_suppressions_user_phone_idx
  ON public.call_suppressions(user_id, phone_e164);
ALTER TABLE public.call_suppressions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.call_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_contact_id uuid REFERENCES public.call_campaign_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credits_charged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credits_debited numeric(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outcome text;

CREATE INDEX IF NOT EXISTS call_logs_campaign_created_idx
  ON public.call_logs(campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.call_credit_charges (
  call_id uuid PRIMARY KEY REFERENCES public.call_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits numeric(12, 4) NOT NULL CHECK (credits > 0 AND credits <= 25),
  balance_after numeric(12, 4) NOT NULL,
  energy_transaction_id uuid REFERENCES public.energy_transactions(id) ON DELETE SET NULL,
  charged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_credit_charges ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS call_credit_charges_user_time_idx
  ON public.call_credit_charges(user_id, charged_at DESC);

-- Idempotent per-call charge. The call row is locked first so retries after an
-- ambiguous network response return the existing charge rather than double-bill.
CREATE OR REPLACE FUNCTION public.charge_call_credits(
  p_call_id uuid,
  p_user_id uuid,
  p_credits numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call uuid;
  v_existing public.call_credit_charges%ROWTYPE;
  v_balance numeric(12, 4);
  v_new_balance numeric(12, 4);
  v_transaction_id uuid;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 OR p_credits > 25 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CREDIT_AMOUNT');
  END IF;

  SELECT id INTO v_call
  FROM public.call_logs
  WHERE id = p_call_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CALL_NOT_FOUND');
  END IF;

  SELECT * INTO v_existing
  FROM public.call_credit_charges
  WHERE call_id = p_call_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_charged', true,
      'credits', v_existing.credits, 'balance_after', v_existing.balance_after
    );
  END IF;

  SELECT balance_credits INTO v_balance
  FROM public.energy_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ENERGY_ACCOUNT_MISSING');
  END IF;
  v_balance := COALESCE(v_balance, 0);
  IF v_balance < p_credits THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'INSUFFICIENT_ENERGY',
      'balance', v_balance, 'required', p_credits
    );
  END IF;

  v_new_balance := v_balance - p_credits;
  UPDATE public.energy_accounts
  SET balance_credits = v_new_balance,
      lifetime_consumed = COALESCE(lifetime_consumed, 0) + p_credits,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.energy_transactions (
    user_id, type, credits, balance_after, description, operation,
    actual_cost_usd, energy_rate, metadata
  ) VALUES (
    p_user_id, 'debit', -p_credits, v_new_balance,
    'Autonomous voice call charge', 'autonomous_call',
    0, 0.09,
    jsonb_build_object('call_id', p_call_id, 'billing_basis', 'per_provider_attempt')
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO public.call_credit_charges (
    call_id, user_id, credits, balance_after, energy_transaction_id
  ) VALUES (p_call_id, p_user_id, p_credits, v_new_balance, v_transaction_id);

  UPDATE public.call_logs
  SET credits_charged = true, credits_debited = p_credits
  WHERE id = p_call_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true, 'already_charged', false,
    'credits', p_credits, 'balance_after', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.charge_call_credits(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_call_credits(uuid, uuid, numeric) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.call_campaigns;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.call_campaign_contacts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
