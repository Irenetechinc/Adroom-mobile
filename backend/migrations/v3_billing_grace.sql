-- v3_billing_grace.sql
-- Adds cancel_at_period_end to subscriptions to support grace-period cancellation,
-- so users keep access until current_period_end after cancelling.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

-- Helpful index for the sweep that flips overdue cancellations to 'cancelled'
CREATE INDEX IF NOT EXISTS idx_subscriptions_cancel_sweep
  ON subscriptions (cancel_at_period_end, status, current_period_end);
