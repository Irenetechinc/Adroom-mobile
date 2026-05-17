-- ══════════════════════════════════════════════════════════════════════════════
-- AdRoom — Subscriptions + Energy Accounts: Missing Columns Migration
-- Covers ALL columns the scheduler, billing, and energy services rely on.
-- Safe to run multiple times (all statements are idempotent).
-- Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── SUBSCRIPTIONS TABLE ───────────────────────────────────────────────────────

-- Billing period tracking (renewal sweep and retry sweep)
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS current_period_start   TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS current_period_end     TIMESTAMPTZ;

-- Cancellation scheduling (cancel_at_period_end=true keeps access until period ends)
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_reason          TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancelled_at           TIMESTAMPTZ;

-- Flutterwave payment method saved during trial/checkout
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS flw_card_token         TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS flw_card_last4         TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS flw_card_brand         TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS flw_subscription_id    TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_email          TEXT;

-- Trial conversion: trial_charged prevents double-billing on day 15
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_end              TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_charged          BOOLEAN NOT NULL DEFAULT false;

-- Failed renewal retry scheduling (set to now()+24h on failure, cleared on success)
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS renewal_next_retry_at  TIMESTAMPTZ;

-- Detailed status reason (e.g. "card_declined", "insufficient_funds")
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS status_detail          TEXT;

-- Auditing
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now();

-- Expand status CHECK to include 'past_due' (used by the renewal retry sweep)
-- We drop and re-add the constraint to include 'past_due' safely
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('inactive', 'trialing', 'active', 'cancelled', 'expired', 'pending_payment', 'past_due'));

-- ── INDEXES on subscriptions ──────────────────────────────────────────────────

-- Renewal sweep (active subscriptions approaching period end)
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal
  ON public.subscriptions (status, cancel_at_period_end, current_period_end)
  WHERE status = 'active';

-- Renewal retry sweep (past-due subscriptions with a scheduled retry)
CREATE INDEX IF NOT EXISTS idx_subscriptions_retry
  ON public.subscriptions (status, renewal_next_retry_at)
  WHERE status = 'past_due';

-- Trial billing sweep (trialing subscriptions not yet charged on day 15)
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial
  ON public.subscriptions (status, trial_end, trial_charged)
  WHERE status = 'trialing';

-- ── ENERGY ACCOUNTS TABLE ─────────────────────────────────────────────────────

-- Auto top-up retry: set to now()+24h when a top-up charge fails, cleared on success
ALTER TABLE public.energy_accounts ADD COLUMN IF NOT EXISTS on_demand_top_up_retry_at TIMESTAMPTZ DEFAULT NULL;

-- Index for the auto top-up retry sweep
CREATE INDEX IF NOT EXISTS idx_energy_accounts_topup_retry
  ON public.energy_accounts (on_demand_top_up_retry_at)
  WHERE on_demand_enabled = true AND on_demand_top_up_retry_at IS NOT NULL;

-- Reload PostgREST schema cache so all new columns are immediately visible
NOTIFY pgrst, 'reload schema';

SELECT 'subscriptions + energy_accounts migration complete' AS status;
