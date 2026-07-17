-- AdRoom Database Migrations
-- Run this in the Supabase SQL editor: https://mrrgjvrntenlkvslfvfh.supabase.co

-- ─── Account Deletion Requests ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,                                        -- nullable: web submissions may not have a matched user
  user_email    TEXT,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',             -- pending | approved | dismissed
  source        TEXT DEFAULT 'app',                          -- 'app' (in-app) | 'web' (Play Store link)
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON account_deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_user_id ON account_deletion_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_email ON account_deletion_requests(user_email);

-- If the table already exists, add the source column and make user_id nullable:
-- ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'app';
-- ALTER TABLE account_deletion_requests ALTER COLUMN user_id DROP NOT NULL;

-- ─── Payment Proof Requests ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_proof_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  lead_id       UUID NOT NULL,
  strategy_id   UUID,
  notification_id UUID,
  inbound_message TEXT NOT NULL,
  action        TEXT DEFAULT NULL,          -- confirm | reject | not_seen | NULL (pending)
  acted_at      TIMESTAMPTZ,
  platform      TEXT,
  platform_username TEXT,
  product_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppr_user_id ON payment_proof_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_ppr_lead_id ON payment_proof_requests(lead_id);
CREATE INDEX IF NOT EXISTS idx_ppr_action ON payment_proof_requests(action);

-- Add action columns to user_notifications for actionable notifications
-- ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT NULL;
-- ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS action_taken TEXT DEFAULT NULL;
-- ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS action_at TIMESTAMPTZ DEFAULT NULL;
-- ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS action_ref_id UUID DEFAULT NULL;

-- ─── User Notifications Inbox ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT false,
  sent_by     TEXT DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_is_read ON user_notifications(user_id, is_read);
