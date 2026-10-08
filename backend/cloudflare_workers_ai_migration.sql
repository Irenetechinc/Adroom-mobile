-- Cloudflare Workers AI provider configuration and account-level usage.
-- Run in the Supabase SQL editor before enabling the provider in the admin UI.

CREATE TABLE IF NOT EXISTS public.cloudflare_ai_provider_settings (
  id text PRIMARY KEY CHECK (id = 'global'),
  free_mode_enabled boolean NOT NULL DEFAULT false,
  universal_free_mode_enabled boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cloudflare_ai_provider_settings (id)
VALUES ('global')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.cloudflare_ai_provider_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role bypass" ON public.cloudflare_ai_provider_settings;
CREATE POLICY "Service role bypass" ON public.cloudflare_ai_provider_settings
  TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.cloudflare_ai_provider_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.cloudflare_ai_daily_usage (
  usage_date date NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('text', 'image')),
  neurons_used bigint NOT NULL DEFAULT 0 CHECK (neurons_used >= 0),
  call_count integer NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  is_exhausted boolean NOT NULL DEFAULT false,
  health_status text NOT NULL DEFAULT 'ready'
    CHECK (health_status IN ('ready', 'healthy', 'exhausted', 'unhealthy', 'degraded')),
  last_status_code integer,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, account_type)
);

COMMENT ON TABLE public.cloudflare_ai_daily_usage IS
  'Admin-only estimated Cloudflare Workers AI usage. Neuron estimates use model pricing and returned token usage; Cloudflare remains authoritative for actual billing.';

CREATE INDEX IF NOT EXISTS cloudflare_ai_daily_usage_updated_at_idx
  ON public.cloudflare_ai_daily_usage (updated_at DESC);

ALTER TABLE public.cloudflare_ai_daily_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role bypass" ON public.cloudflare_ai_daily_usage;
CREATE POLICY "Service role bypass" ON public.cloudflare_ai_daily_usage
  TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON public.cloudflare_ai_daily_usage TO service_role;

CREATE OR REPLACE FUNCTION public.record_cloudflare_ai_usage(
  p_account_type text,
  p_neurons bigint DEFAULT 0,
  p_status_code integer DEFAULT NULL,
  p_health_status text DEFAULT 'degraded',
  p_last_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cloudflare_ai_daily_usage%ROWTYPE;
  v_date date := timezone('UTC', now())::date;
BEGIN
  IF p_account_type NOT IN ('text', 'image') THEN
    RAISE EXCEPTION 'Invalid Cloudflare account type';
  END IF;

  IF p_health_status NOT IN ('healthy', 'exhausted', 'unhealthy', 'degraded') THEN
    RAISE EXCEPTION 'Invalid Cloudflare health status';
  END IF;

  INSERT INTO public.cloudflare_ai_daily_usage (
    usage_date,
    account_type,
    neurons_used,
    call_count,
    is_exhausted,
    health_status,
    last_status_code,
    last_error,
    updated_at
  )
  VALUES (
    v_date,
    p_account_type,
    greatest(coalesce(p_neurons, 0), 0),
    1,
    p_health_status = 'exhausted',
    p_health_status,
    p_status_code,
    left(p_last_error, 180),
    now()
  )
  ON CONFLICT (usage_date, account_type) DO UPDATE SET
    neurons_used = public.cloudflare_ai_daily_usage.neurons_used + greatest(coalesce(EXCLUDED.neurons_used, 0), 0),
    call_count = public.cloudflare_ai_daily_usage.call_count + 1,
    is_exhausted = public.cloudflare_ai_daily_usage.is_exhausted OR EXCLUDED.is_exhausted,
    health_status = CASE
      WHEN EXCLUDED.health_status = 'exhausted' THEN 'exhausted'
      WHEN EXCLUDED.health_status = 'unhealthy' THEN 'unhealthy'
      WHEN public.cloudflare_ai_daily_usage.is_exhausted THEN 'exhausted'
      WHEN EXCLUDED.health_status = 'healthy' THEN 'healthy'
      ELSE EXCLUDED.health_status
    END,
    last_status_code = CASE
      WHEN EXCLUDED.health_status = 'healthy' THEN NULL
      ELSE EXCLUDED.last_status_code
    END,
    last_error = CASE
      WHEN EXCLUDED.health_status = 'healthy' THEN NULL
      ELSE EXCLUDED.last_error
    END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'usage_date', v_row.usage_date,
    'account_type', v_row.account_type,
    'neurons_used', v_row.neurons_used,
    'call_count', v_row.call_count,
    'is_exhausted', v_row.is_exhausted,
    'health_status', v_row.health_status,
    'last_status_code', v_row.last_status_code,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_cloudflare_ai_usage(text, bigint, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cloudflare_ai_usage(text, bigint, integer, text, text) TO service_role;
