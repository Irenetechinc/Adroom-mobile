-- v5_agent_deals_created_at.sql
-- Adds standard created_at timestamp to agent_deals.
-- The table originally used closed_at (the time the deal was closed/won),
-- but the dashboard and frontend code also query created_at for sorting and
-- time-ago display. This migration adds the column if it doesn't exist yet.

ALTER TABLE agent_deals
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Back-fill created_at from closed_at for any existing rows
UPDATE agent_deals
  SET created_at = closed_at
  WHERE created_at IS NULL;

-- Index for fast user-scoped recency queries
CREATE INDEX IF NOT EXISTS idx_agent_deals_created_at
  ON agent_deals (user_id, created_at DESC);
