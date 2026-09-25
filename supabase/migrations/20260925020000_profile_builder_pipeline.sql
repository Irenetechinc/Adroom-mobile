-- Public-profile enrichment pipeline state.
-- Only public, non-sensitive profile output is exposed through this table.
-- Internal tool diagnostics stay in server logs and are never written here.
CREATE TABLE IF NOT EXISTS public.lead_profile_builder_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.agent_leads(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','identified','discovering','profile_ready','psychology_complete','completed','failed')),
  selected_platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools_attempted JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_evidence_count INTEGER NOT NULL DEFAULT 0,
  public_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lead_id)
);

CREATE INDEX IF NOT EXISTS lead_profile_builder_runs_user_idx
  ON public.lead_profile_builder_runs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS lead_profile_builder_runs_lead_idx
  ON public.lead_profile_builder_runs (lead_id, updated_at DESC);

ALTER TABLE public.lead_profile_builder_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own profile builder runs"
  ON public.lead_profile_builder_runs;
CREATE POLICY "Users read own profile builder runs"
  ON public.lead_profile_builder_runs
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS profile_status TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS profile_error TEXT;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_profile_builder_runs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;