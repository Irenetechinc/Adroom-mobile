-- Add trial_charged flag to subscriptions to prevent double-charging on day 15
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_charged boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_billing
  ON public.subscriptions (status, trial_end)
  WHERE status = 'trialing';
