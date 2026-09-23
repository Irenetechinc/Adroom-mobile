-- The lead discovery SQL historically used sent_at, while the existing
-- conversation readers use created_at. Keep both fields during the transition
-- so old rows remain readable and new rows have the column the app expects.

ALTER TABLE public.lead_dm_messages
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.lead_dm_messages
SET created_at = sent_at
WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_dm_messages_created_at
  ON public.lead_dm_messages (lead_id, created_at ASC);