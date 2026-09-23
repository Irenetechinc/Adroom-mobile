-- Compatibility migration for databases created with the original
-- personal_inbound_messages.received_at column.
-- Canonical field: message_timestamp.
-- Apply this after personal_inbound_messages_migration.sql in Supabase.

DO $$
BEGIN
  IF to_regclass('public.personal_inbound_messages') IS NULL THEN
    RAISE EXCEPTION 'personal_inbound_messages is missing; apply personal_inbound_messages_migration.sql first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'received_at'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'message_timestamp'
  ) THEN
    ALTER TABLE public.personal_inbound_messages
      RENAME COLUMN received_at TO message_timestamp;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'received_at'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'message_timestamp'
  ) THEN
    -- A partial migration can leave both columns behind. Keep the canonical
    -- field populated from legacy data before enforcing NOT NULL.
    UPDATE public.personal_inbound_messages
       SET message_timestamp = COALESCE(message_timestamp, received_at, created_at)
     WHERE message_timestamp IS NULL;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'message_timestamp'
  ) THEN
    ALTER TABLE public.personal_inbound_messages
      ADD COLUMN message_timestamp TIMESTAMPTZ;
    UPDATE public.personal_inbound_messages
      SET message_timestamp = created_at
      WHERE message_timestamp IS NULL;
  END IF;

  UPDATE public.personal_inbound_messages
     SET message_timestamp = COALESCE(message_timestamp, created_at)
   WHERE message_timestamp IS NULL;

  ALTER TABLE public.personal_inbound_messages
    ALTER COLUMN message_timestamp SET NOT NULL;
END $$;

DROP INDEX IF EXISTS public.personal_inbound_messages_lookup_idx;
CREATE INDEX IF NOT EXISTS personal_inbound_messages_lookup_idx
  ON public.personal_inbound_messages (user_id, provider, message_timestamp DESC);

-- Protect the lead pipeline from duplicate inbound webhook/poll events.
CREATE UNIQUE INDEX IF NOT EXISTS lead_dm_messages_inbound_external_idx
  ON public.lead_dm_messages (lead_id, ((meta->>'external_message_id')))
  WHERE direction = 'inbound' AND meta ? 'external_message_id';

NOTIFY pgrst, 'reload schema';