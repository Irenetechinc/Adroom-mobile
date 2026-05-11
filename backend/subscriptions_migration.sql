-- ══════════════════════════════════════════════════════════════════════════════
-- AdRoom — Subscriptions Table: Missing Columns Migration
-- Safe to run multiple times (all statements are idempotent).
-- Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- Billing period tracking (renewal sweep and retry sweep)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start   TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;

-- Cancellation scheduling (cancel_at_period_end=true keeps access until period ends)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_reason          TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at           TIMESTAMPTZ;

-- Flutterwave payment method saved during trial/checkout
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS flw_card_token         TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS flw_card_last4         TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS flw_card_brand         TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS flw_subscription_id    TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_email          TEXT;

-- Trial conversion
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_end              TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_charged          BOOLEAN NOT NULL DEFAULT false;

-- Failed renewal retry scheduling (set to now()+24h on failure, cleared on success)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_next_retry_at  TIMESTAMPTZ;

-- Auditing
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now();

-- Index for the renewal sweep query (status + cancel_at_period_end + current_period_end)
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal
  ON subscriptions (status, cancel_at_period_end, current_period_end)
  WHERE status = 'active';

-- Index for the renewal retry sweep (status = past_due + retry time)
CREATE INDEX IF NOT EXISTS idx_subscriptions_retry
  ON subscriptions (status, renewal_next_retry_at)
  WHERE status = 'past_due';

-- Index for the trial billing sweep
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial
  ON subscriptions (status, trial_end, trial_charged)
  WHERE status = 'trialing';

SELECT 'subscriptions migration complete' AS status;
