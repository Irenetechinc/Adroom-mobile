-- AdRoom Database Migrations
-- Run this in the Supabase SQL editor: https://mrrgjvrntenlkvslfvfh.supabase.co

-- ─── Account Deletion Requests ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  user_email    TEXT,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | dismissed
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON account_deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_user_id ON account_deletion_requests(user_id);

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
