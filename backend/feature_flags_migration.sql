-- Feature Flags Migration
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS feature_flags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key    TEXT        NOT NULL UNIQUE,
  label       TEXT        NOT NULL,
  description TEXT,
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS user_feature_overrides (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL,
  flag_key    TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  UNIQUE (user_id, flag_key)
);

CREATE INDEX IF NOT EXISTS ufo_user_id_idx ON user_feature_overrides (user_id);

-- Seed all default flags (all ON — preserves existing behaviour)
INSERT INTO feature_flags (flag_key, label, description, enabled) VALUES
  ('strategy_creation',     'Strategy Creation',        'Allow users to generate AI marketing strategies',           true),
  ('agent_execution',       'Autonomous Agent Posting', 'Enable agents to post, reply and DM on social platforms',   true),
  ('platform_connections',  'Platform Connections',     'Allow users to connect social media accounts',              true),
  ('lead_capture',          'Lead Capture & DMs',       'Agent lead scanning and automated direct messaging',        true),
  ('intelligence_engines',  'Intelligence Engines',     'IPE, Social Listening, Emotional and GEO monitoring',      true),
  ('push_notifications',    'Push Notifications',       'Send push notifications to users',                          true),
  ('trial_modal',           'Trial Promo Modal',        'Show 48-hr trial promotion modal to new users',             true),
  ('referral_system',       'Referral System',          'Refer & Earn — referral codes and rewards',                 true),
  ('google_maps_outreach',  'Google Maps Outreach',     'Salesman agent Google Maps business prospecting',           true),
  ('dm_detection',          'Inbound DM Detection',     'Poll platforms for incoming DM replies from leads',         true),
  ('token_refresh',         'OAuth Token Refresh',      'Automatically refresh expiring platform OAuth tokens',      true),
  ('product_manager',       'AI Product Manager',       'Autonomous product improvement agent (every 4 hrs)',        true),
  ('performance_monitoring','Performance Monitoring',   'Fetch real post metrics from connected platforms',          true)
ON CONFLICT (flag_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
