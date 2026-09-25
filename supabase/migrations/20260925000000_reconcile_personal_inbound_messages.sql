-- Reconcile legacy personal_inbound_messages schemas with the backend's
-- canonical columns: message and message_timestamp.
-- Preserve old text/received_at values when migrating existing installations.
DO $$
DECLARE
  has_message BOOLEAN;
  has_legacy_text BOOLEAN;
  has_message_timestamp BOOLEAN;
  has_received_at BOOLEAN;
  has_created_at BOOLEAN;
BEGIN
  IF to_regclass('public.personal_inbound_messages') IS NULL THEN
    RAISE EXCEPTION 'personal_inbound_messages is missing; apply its create-table migration first';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'message'
  ) INTO has_message;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'text'
  ) INTO has_legacy_text;

  IF has_legacy_text AND NOT has_message THEN
    ALTER TABLE public.personal_inbound_messages RENAME COLUMN "text" TO message;
    has_message := TRUE;
    has_legacy_text := FALSE;
  ELSIF NOT has_message THEN
    ALTER TABLE public.personal_inbound_messages ADD COLUMN message TEXT;
    has_message := TRUE;
  END IF;

  IF has_legacy_text THEN
    UPDATE public.personal_inbound_messages
       SET message = COALESCE(message, "text")
     WHERE message IS NULL;
  END IF;

  UPDATE public.personal_inbound_messages
     SET message = ''
   WHERE message IS NULL;

  ALTER TABLE public.personal_inbound_messages
    ALTER COLUMN message SET NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'message_timestamp'
  ) INTO has_message_timestamp;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'received_at'
  ) INTO has_received_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personal_inbound_messages'
      AND column_name = 'created_at'
  ) INTO has_created_at;

  IF has_received_at AND NOT has_message_timestamp THEN
    ALTER TABLE public.personal_inbound_messages RENAME COLUMN received_at TO message_timestamp;
    has_message_timestamp := TRUE;
    has_received_at := FALSE;
  ELSIF NOT has_message_timestamp THEN
    ALTER TABLE public.personal_inbound_messages ADD COLUMN message_timestamp TIMESTAMPTZ;
    has_message_timestamp := TRUE;
  END IF;

  IF has_received_at AND has_created_at THEN
    UPDATE public.personal_inbound_messages
       SET message_timestamp = COALESCE(message_timestamp, received_at, created_at, now())
     WHERE message_timestamp IS NULL;
  ELSIF has_received_at THEN
    UPDATE public.personal_inbound_messages
       SET message_timestamp = COALESCE(message_timestamp, received_at, now())
     WHERE message_timestamp IS NULL;
  ELSIF has_created_at THEN
    UPDATE public.personal_inbound_messages
       SET message_timestamp = COALESCE(message_timestamp, created_at, now())
     WHERE message_timestamp IS NULL;
  ELSE
    UPDATE public.personal_inbound_messages
       SET message_timestamp = now()
     WHERE message_timestamp IS NULL;
  END IF;

  ALTER TABLE public.personal_inbound_messages
    ALTER COLUMN message_timestamp SET DEFAULT now(),
    ALTER COLUMN message_timestamp SET NOT NULL;
END $$;

DROP INDEX IF EXISTS public.personal_inbound_messages_lookup_idx;
CREATE INDEX personal_inbound_messages_lookup_idx
  ON public.personal_inbound_messages (user_id, provider, message_timestamp DESC);

-- PostgREST/Supabase API must refresh its schema cache after these changes.
NOTIFY pgrst, 'reload schema';