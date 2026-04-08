-- ══════════════════════════════════════════════════════
-- AdRoom CMA Database Migration
-- Run this in your Supabase SQL editor
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

CREATE INDEX IF NOT EXISTS cma_savings_log_user_id_idx  ON cma_savings_log(user_id);
CREATE INDEX IF NOT EXISTS cma_savings_log_created_at_idx ON cma_savings_log(created_at DESC);
CREATE INDEX IF NOT EXISTS cma_savings_log_operation_idx ON cma_savings_log(operation);

-- 2. CMA Monitor Log (singleton row — updated every 10 min by selfMonitor)
-- Tracks real-time system burn rate, economy override status, and cost
CREATE TABLE IF NOT EXISTS cma_monitor_log (
  id                      text PRIMARY KEY DEFAULT 'singleton',
  system_burn_rate_1h     numeric(10,4) NOT NULL DEFAULT 0,
  system_cost_usd_1h      numeric(12,6) NOT NULL DEFAULT 0,
  economy_override        boolean NOT NULL DEFAULT false,
  model_breakdown         jsonb,
  recommendation          text,
  updated_at              timestamptz NOT NULL DEFAULT now()
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
CREATE POLICY IF NOT EXISTS "Service role bypass" ON cma_savings_log USING (true) WITH CHECK (true);

-- 5. Row Level Security for cma_monitor_log
ALTER TABLE cma_monitor_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Service role bypass" ON cma_monitor_log USING (true) WITH CHECK (true);

-- Done!
SELECT 'CMA migration complete' AS status;
