-- Durable inbound storage for personal-provider messages.
-- WhatsApp receives messages through a live Baileys socket; keeping these
-- records in Supabase prevents Railway restarts/deploys from losing replies.
CREATE TABLE IF NOT EXISTS public.personal_inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  message_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS personal_inbound_messages_lookup_idx
  ON public.personal_inbound_messages (user_id, provider, message_timestamp DESC);

ALTER TABLE public.personal_inbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their personal inbound messages"
  ON public.personal_inbound_messages;
CREATE POLICY "Users can read their personal inbound messages"
  ON public.personal_inbound_messages FOR SELECT
  USING (auth.uid() = user_id);