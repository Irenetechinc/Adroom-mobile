-- ─────────────────────────────────────────────────────────────────────────────
-- CMA Monitor Log — singleton row tracking system-wide burn rate + economy
-- override state. Persisted so the CMA survives server restarts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cma_monitor_log (
  id                   TEXT PRIMARY KEY DEFAULT 'singleton',
  system_burn_rate_1h  NUMERIC(12, 4) NOT NULL DEFAULT 0,
  system_cost_usd_1h   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  economy_override     BOOLEAN         NOT NULL DEFAULT FALSE,
  model_breakdown      JSONB           NOT NULL DEFAULT '{}',
  recommendation       TEXT            NOT NULL DEFAULT 'CMA initialised',
  updated_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Seed the singleton row so CMA init never gets a 404
INSERT INTO cma_monitor_log (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- Only service-role key may touch this table
ALTER TABLE cma_monitor_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_only_cma_monitor"
  ON cma_monitor_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
