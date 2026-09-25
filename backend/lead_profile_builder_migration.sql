-- Public-profile enrichment pipeline.
-- Apply this migration in Supabase before enabling the background worker.

ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS profile_status text NOT NULL DEFAULT 'queued';
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS profile_error text;

CREATE TABLE IF NOT EXISTS public.lead_profile_builder_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.agent_leads(id) ON DELETE CASCADE,
  strategy_id uuid,
  status text NOT NULL DEFAULT 'queued',
  selected_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools_attempted jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_evidence_count integer NOT NULL DEFAULT 0,
  public_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lead_id)
);

ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS strategy_id uuid;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued';
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS selected_platforms jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS tools_attempted jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS public_evidence_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS public_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.lead_profile_builder_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS lead_profile_builder_runs_queue_idx
  ON public.lead_profile_builder_runs(status, next_attempt_at, updated_at);
CREATE INDEX IF NOT EXISTS lead_profile_builder_runs_user_idx
  ON public.lead_profile_builder_runs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_sales_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.agent_leads(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_count integer NOT NULL DEFAULT 0,
  confidence_score numeric(5,4) NOT NULL DEFAULT 0,
  privacy_scope text NOT NULL DEFAULT 'public_and_user_owned_evidence',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lead_id)
);

ALTER TABLE public.lead_profile_builder_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sales_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile builder runs" ON public.lead_profile_builder_runs;
CREATE POLICY "Users read own profile builder runs"
  ON public.lead_profile_builder_runs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own lead sales profiles" ON public.lead_sales_profiles;
CREATE POLICY "Users read own lead sales profiles"
  ON public.lead_sales_profiles FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  IF to_regclass('public.agent_leads') IS NOT NULL THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_leads;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_profile_builder_runs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_sales_profiles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;