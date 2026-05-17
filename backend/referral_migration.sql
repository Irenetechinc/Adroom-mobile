-- Referral System Migration
-- Run this in the Supabase SQL editor or via: supabase db push

-- 1. Add referral_code column to profiles (if not already present)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- 2. Create referrals table
CREATE TABLE IF NOT EXISTS public.referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  credits_awarded INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_id) -- each user can only be referred once
);

-- 3. Indexes for fast look-up
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_referred_idx ON public.referrals (referred_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx   ON public.referrals (status);

-- 4. Row-Level Security — users can only read their own referral rows
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'referrals' AND policyname = 'referrals_select_own'
  ) THEN
    CREATE POLICY referrals_select_own ON public.referrals
      FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
  END IF;
END $$;

-- Backend service-role bypasses RLS for INSERT/UPDATE operations.

-- 5. Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS referrals_set_updated_at ON public.referrals;
CREATE TRIGGER referrals_set_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
