-- Critic Agent: quality analysis logs + model override config
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS critic_agent_logs (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID,
  agent_type   TEXT,
  task_type    TEXT,
  operation    TEXT,
  output_text  TEXT,
  quality_score INTEGER    DEFAULT 0,
  issues       JSONB       DEFAULT '[]'::jsonb,
  verdict      TEXT        DEFAULT 'approved',  -- approved | flagged | rejected
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_critic_logs_user    ON critic_agent_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_critic_logs_verdict ON critic_agent_logs(verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_critic_logs_agent   ON critic_agent_logs(agent_type, quality_score);

-- Model override config — lets admin force a model globally or per operation
CREATE TABLE IF NOT EXISTS model_override_config (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  operation       TEXT        UNIQUE NOT NULL,  -- 'all' or operation key
  forced_model    TEXT        NOT NULL,         -- 'gpt-4o' | 'gemini-flash' | 'auto'
  override_active BOOLEAN     DEFAULT TRUE,
  reason          TEXT,
  updated_by      TEXT        DEFAULT 'admin',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_override_op ON model_override_config(operation, override_active);
