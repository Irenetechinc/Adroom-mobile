-- ─────────────────────────────────────────────────────────────────────────────
-- APMA Social Accounts — multi-account social media connections for APMA use
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS apma_social_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  platform        text NOT NULL,           -- facebook|instagram|twitter|whatsapp|telegram|reddit|linkedin
  account_type    text NOT NULL DEFAULT 'persona',  -- persona|page|phone
  account_id      text NOT NULL,           -- platform-specific ID (page_id, phone_id, user_id)
  account_name    text NOT NULL,
  access_token    text,                    -- encrypted in production; long-lived token
  refresh_token   text,
  token_expires_at timestamptz,
  phone_number    text,                    -- for WhatsApp
  waba_id         text,                    -- for WhatsApp Business Account
  meta            jsonb DEFAULT '{}',      -- extra platform-specific data
  active          boolean NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  usage_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_social_accounts_client_id_idx  ON apma_social_accounts(client_id);
CREATE INDEX IF NOT EXISTS apma_social_accounts_platform_idx   ON apma_social_accounts(platform);
CREATE INDEX IF NOT EXISTS apma_social_accounts_active_idx     ON apma_social_accounts(active);

-- Client profiles — AI-generated intelligence brief per client+campaign
CREATE TABLE IF NOT EXISTS apma_client_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  profile         jsonb NOT NULL DEFAULT '{}',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS apma_client_profiles_client_id_idx ON apma_client_profiles(client_id);

-- Update the goal column to allow get_votes
ALTER TABLE apma_clients   DROP CONSTRAINT IF EXISTS apma_clients_goal_check;
ALTER TABLE apma_campaigns DROP CONSTRAINT IF EXISTS apma_campaigns_goal_check;

ALTER TABLE apma_clients
  ADD CONSTRAINT apma_clients_goal_check
  CHECK (goal IN ('improve','damage','get_votes'));

ALTER TABLE apma_campaigns
  ADD CONSTRAINT apma_campaigns_goal_check
  CHECK (goal IN ('improve','damage','get_votes'));
