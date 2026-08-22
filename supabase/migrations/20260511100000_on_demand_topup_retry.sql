-- Auto top-up retry tracking
-- Stores the next retry time when an auto top-up charge fails.
-- Cleared on: successful charge, user disables auto top-up, user changes pack.

ALTER TABLE public.energy_accounts
  ADD COLUMN IF NOT EXISTS on_demand_top_up_retry_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_energy_accounts_topup_retry
  ON public.energy_accounts (on_demand_top_up_retry_at)
  WHERE on_demand_enabled = true AND on_demand_top_up_retry_at IS NOT NULL;
