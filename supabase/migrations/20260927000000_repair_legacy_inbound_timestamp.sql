-- Older Railway/Supabase installations may still have a NOT NULL received_at
-- column while newer code writes message_timestamp. Keep both timestamp names
-- valid during the rolling schema transition.
DO $$
DECLARE
  has_message_timestamp BOOLEAN;
  has_created_at BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'personal_inbound_messages'
       AND column_name = 'received_at'
  ) THEN
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'personal_inbound_messages'
         AND column_name = 'message_timestamp'
    ) INTO has_message_timestamp;
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'personal_inbound_messages'
         AND column_name = 'created_at'
    ) INTO has_created_at;

    IF has_message_timestamp AND has_created_at THEN
      EXECUTE 'UPDATE public.personal_inbound_messages
                  SET received_at = COALESCE(received_at, message_timestamp, created_at, NOW())
                WHERE received_at IS NULL';
    ELSIF has_message_timestamp THEN
      EXECUTE 'UPDATE public.personal_inbound_messages
                  SET received_at = COALESCE(received_at, message_timestamp, NOW())
                WHERE received_at IS NULL';
    ELSIF has_created_at THEN
      EXECUTE 'UPDATE public.personal_inbound_messages
                  SET received_at = COALESCE(received_at, created_at, NOW())
                WHERE received_at IS NULL';
    ELSE
      EXECUTE 'UPDATE public.personal_inbound_messages
                  SET received_at = NOW()
                WHERE received_at IS NULL';
    END IF;

    ALTER TABLE public.personal_inbound_messages
      ALTER COLUMN received_at SET DEFAULT NOW(),
      ALTER COLUMN received_at SET NOT NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';