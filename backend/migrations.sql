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
