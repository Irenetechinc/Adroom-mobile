-- Credit Management Agent savings log
-- Records every time the CMA routed an operation to a cheaper model,
-- capturing how many credits and USD were saved vs. the default price.

CREATE TABLE IF NOT EXISTS cma_savings_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation     text NOT NULL,
  tier          text NOT NULL DEFAULT 'none',
  saved_credits numeric(10,2) NOT NULL DEFAULT 0,
  saved_usd     numeric(10,4) NOT NULL DEFAULT 0,
  model_used    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cma_savings_user    ON cma_savings_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cma_savings_created ON cma_savings_log(created_at DESC);

-- Allow service role full access (backend uses service key)
ALTER TABLE cma_savings_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON cma_savings_log
  FOR ALL USING (true)
  WITH CHECK (true);
