-- Google Dorks Lead Discovery: discovered_leads table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS discovered_leads (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL,
  url             TEXT        NOT NULL,
  title           TEXT,
  snippet         TEXT,
  relevance_score INTEGER     DEFAULT 0,
  source          TEXT        DEFAULT 'google_dorks',
  dork_used       TEXT,
  platform        TEXT        DEFAULT 'web',
  platform_user_id TEXT,
  stage           TEXT        DEFAULT 'identified',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_discovered_leads_user ON discovered_leads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_leads_score ON discovered_leads(user_id, relevance_score DESC);
