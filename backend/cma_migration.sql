-- ══════════════════════════════════════════════════════
-- AdRoom CMA Database Migration — FIXED
-- Run this in your Supabase SQL Editor
-- ══════════════════════════════════════════════════════

-- 1. CMA Savings Log
-- Tracks every time the CMA routed to a cheaper model and the credits/USD saved
CREATE TABLE IF NOT EXISTS cma_savings_log (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation     text NOT NULL,
  tier          text NOT NULL DEFAULT 'none',
  saved_credits numeric(10,4) NOT NULL DEFAULT 0,
  saved_usd     numeric(12,6) NOT NULL DEFAULT 0,
  model_used    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cma_savings_log_user_id_idx   ON cma_savings_log(user_id);
CREATE INDEX IF NOT EXISTS cma_savings_log_created_at_idx ON cma_savings_log(created_at DESC);
CREATE INDEX IF NOT EXISTS cma_savings_log_operation_idx  ON cma_savings_log(operation);

-- 2. CMA Monitor Log (singleton row — updated every 10 min by selfMonitor)
-- Tracks real-time system burn rate, economy override status, and cost
CREATE TABLE IF NOT EXISTS cma_monitor_log (
  id                  text PRIMARY KEY DEFAULT 'singleton',
  system_burn_rate_1h numeric(10,4) NOT NULL DEFAULT 0,
  system_cost_usd_1h  numeric(12,6) NOT NULL DEFAULT 0,
  economy_override    boolean NOT NULL DEFAULT false,
  model_breakdown     jsonb,
  recommendation      text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Insert the singleton row if it doesn't exist
INSERT INTO cma_monitor_log (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

-- 3. AI Usage Logs (if not already created)
-- Tracks all AI operations with cost info for CMA daily-cap calculations
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  model           text NOT NULL,
  operation       text NOT NULL,
  actual_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  energy_debited  numeric(10,4) NOT NULL DEFAULT 0,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_logs_user_id_idx    ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx ON ai_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_operation_idx  ON ai_usage_logs(operation);

-- 4. Row Level Security for cma_savings_log
ALTER TABLE cma_savings_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role bypass" ON cma_savings_log;
CREATE POLICY "Service role bypass" ON cma_savings_log
  USING (true)
  WITH CHECK (true);

-- 5. Row Level Security for cma_monitor_log
ALTER TABLE cma_monitor_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role bypass" ON cma_monitor_log;
CREATE POLICY "Service role bypass" ON cma_monitor_log
  USING (true)
  WITH CHECK (true);

-- 6. Row Level Security for ai_usage_logs (if not already set)
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role bypass" ON ai_usage_logs;
CREATE POLICY "Service role bypass" ON ai_usage_logs
  USING (true)
  WITH CHECK (true);

-- Done!
SELECT 'CMA migration complete' AS status;

-- 7. Global free-model quota (atomic across all Railway instances)
CREATE TABLE IF NOT EXISTS public.free_ai_usage (
  usage_date date PRIMARY KEY DEFAULT current_date,
  request_count integer NOT NULL DEFAULT 0,
  token_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.free_ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role bypass" ON public.free_ai_usage;
CREATE POLICY "Service role bypass" ON public.free_ai_usage TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.reserve_free_ai_request(p_tokens integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minute_count integer;
  v_requests integer;
  v_tokens bigint;
  v_now timestamptz := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('adroom-free-ai-quota'));
  SELECT count(*) INTO v_minute_count
  FROM public.ai_usage_logs
  WHERE model LIKE '%-free'
    AND created_at >= v_now - interval '1 minute';

  IF v_minute_count >= 5 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'minute_limit', 'active', v_minute_count);
  END IF;

  INSERT INTO public.free_ai_usage (usage_date, request_count, token_count, updated_at)
  VALUES (current_date, 1, greatest(p_tokens, 0), v_now)
  ON CONFLICT (usage_date) DO UPDATE SET
    request_count = public.free_ai_usage.request_count + 1,
    token_count = public.free_ai_usage.token_count + greatest(p_tokens, 0),
    updated_at = v_now
  RETURNING request_count, token_count INTO v_requests, v_tokens;

  IF v_requests > 500 OR v_tokens > 1000000 THEN
    UPDATE public.free_ai_usage
    SET request_count = request_count - 1,
        token_count = token_count - greatest(p_tokens, 0),
        updated_at = v_now
    WHERE usage_date = current_date;
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'requests', v_requests - 1, 'tokens', v_tokens - greatest(p_tokens, 0));
  END IF;

  RETURN jsonb_build_object('allowed', true, 'requests', v_requests, 'tokens', v_tokens);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_free_ai_request(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_free_ai_request(integer) TO service_role;
