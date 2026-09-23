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
  ('performance_monitoring','Performance Monitoring',   'Fetch real post metrics from connected platforms',          true),
  ('lead_profile_builder',  'Lead Sales Profile Builder','Build sales preparation profiles from permitted evidence', true),
  ('lead_profile_public_mentions','Public Mention Evidence','Allow public prospect excerpts in sales profiles',     true),
  ('calling_ui',            'Calling UI',               'Show call activity and calling controls in the app',         true),
  ('shipping_ui',           'Shipping UI',              'Show order and shipment tracking in the app',                true),
  ('outreach_preferences_ui','Outreach Preferences UI', 'Show outreach preference controls in the app',               true),
  ('social_facebook_connections','Facebook Connections','Allow Facebook account connections and execution',true),
  ('social_instagram_connections','Instagram Connections','Allow Instagram account connections and execution',true),
  ('social_tiktok_connections','TikTok Connections','Allow TikTok account connections and execution',true),
  ('social_twitter_connections','X/Twitter Connections','Allow X/Twitter account connections and execution',true),
  ('social_linkedin_connections','LinkedIn Connections','Allow LinkedIn account connections and execution',true),
  ('social_whatsapp_connections','WhatsApp Business Connections','Allow WhatsApp Business account connections and execution',true),
  ('social_telegram_connections','Telegram Connections','Allow Telegram personal account connections and execution',true),
  ('social_whatsapp_personal_connections','Personal WhatsApp Connections','Allow personal WhatsApp account connections and execution',true),
  ('social_signal_personal_connections','Signal Connections','Allow Signal account connections and execution',true),
  ('social_bluesky_connections','Bluesky Connections','Allow Bluesky account connections and execution',true),
  ('social_delta_chat_connections','Delta Chat Connections','Allow Delta Chat account connections and execution',true)
ON CONFLICT (flag_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
