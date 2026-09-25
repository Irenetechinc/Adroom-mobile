-- Shared, privacy-scoped sales preparation profiles used by the conversation
-- and salesman agents. This migration is Supabase-native and does not require
-- a hosted backend or platform-specific service.
CREATE TABLE IF NOT EXISTS public.lead_sales_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  confidence_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  privacy_scope TEXT NOT NULL DEFAULT 'public_and_user_owned_evidence',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lead_id)
);

CREATE INDEX IF NOT EXISTS lead_sales_profiles_user_idx
  ON public.lead_sales_profiles (user_id, updated_at DESC);

ALTER TABLE public.lead_sales_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own lead sales profiles"
  ON public.lead_sales_profiles;
CREATE POLICY "Users manage own lead sales profiles"
  ON public.lead_sales_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);