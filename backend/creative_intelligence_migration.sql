-- Creative decision metadata migration.
-- Apply this in Supabase after the existing creative/design-history migration.
-- This replaces the old template label with an AI-selected per-asset concept.

DO $$
BEGIN
  IF to_regclass('public.gda_design_history') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.gda_design_history
    ADD COLUMN IF NOT EXISTS creative_concept TEXT;

  -- Existing installations may still have the legacy column. Copy its value
  -- once for history compatibility; new writes use creative_concept only.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'gda_design_history'
      AND column_name = 'template'
  ) THEN
    EXECUTE 'UPDATE public.gda_design_history
      SET creative_concept = COALESCE(creative_concept, template)
      WHERE creative_concept IS NULL';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';