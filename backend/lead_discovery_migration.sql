-- Lead DM Messages — stores every AI outbound message + lead reply per lead
CREATE TABLE IF NOT EXISTS lead_dm_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES agent_leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  message         TEXT NOT NULL,
  persona_name    TEXT,
  sequence_step   INT DEFAULT 0,
  platform        TEXT,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  meta            JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_lead_dm_messages_lead_id ON lead_dm_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_dm_messages_user_id ON lead_dm_messages(user_id);

-- Lead Discovery Log — tracks source for each lead captured
CREATE TABLE IF NOT EXISTS lead_discovery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES agent_leads(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  source          TEXT NOT NULL, -- 'social_listening' | 'reddit' | 'newsapi' | 'forum' | 'google_maps' | 'competitor' | 'search'
  source_url      TEXT,
  raw_content     TEXT,
  confidence      FLOAT DEFAULT 0.5,
  discovered_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_disc_user ON lead_discovery_log(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_disc_source ON lead_discovery_log(source);

-- Dynamic Error Log — admin dashboard only, never shown to users
CREATE TABLE IF NOT EXISTS dynamic_error_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at         TIMESTAMPTZ DEFAULT NOW(),
  error_type          TEXT NOT NULL, -- 'code_bug' | 'user_error' | 'external_factor' | 'client_behavior'
  responsibility      TEXT NOT NULL, -- 'developer' | 'user' | 'ai' | 'external'
  description         TEXT NOT NULL,
  context             JSONB DEFAULT '{}',
  attempted_solutions JSONB DEFAULT '[]',
  safe_mode_level     INT,           -- 1-4 if safe mode was activated
  status              TEXT DEFAULT 'open', -- 'open' | 'resolved' | 'in_safe_mode'
  affected_user_id    UUID,
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dyn_err_type ON dynamic_error_log(error_type);
CREATE INDEX IF NOT EXISTS idx_dyn_err_status ON dynamic_error_log(status);

-- Lead source column on agent_leads (backfill safe)
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS discovery_source TEXT DEFAULT 'salesman_scan';
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS source_url       TEXT;
ALTER TABLE agent_leads ADD COLUMN IF NOT EXISTS discovery_raw    TEXT;
