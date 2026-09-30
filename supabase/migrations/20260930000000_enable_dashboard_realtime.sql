-- Keep lead inbox counts and dashboard intelligence fresh over Supabase Realtime.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF to_regclass('public.agent_leads') IS NOT NULL THEN
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_leads;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END IF;

    IF to_regclass('public.lead_dm_messages') IS NOT NULL THEN
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_dm_messages;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END IF;

    IF to_regclass('public.platform_intelligence') IS NOT NULL THEN
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_intelligence;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END IF;
  END IF;
END $$;