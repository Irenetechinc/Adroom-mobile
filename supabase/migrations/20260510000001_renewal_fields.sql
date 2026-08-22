-- Add renewal retry tracking to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS renewal_next_retry_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS status_detail text DEFAULT NULL;

-- past_due status index for retry sweep
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal_retry
  ON public.subscriptions (status, renewal_next_retry_at)
  WHERE status = 'past_due';
