-- ══════════════════════════════════════════════════════════════════════════════
-- AdRoom — Profiles + Referral System Migration
-- Safe to run multiple times (all statements are idempotent).
-- Run in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. PROFILES TABLE — create if it does not exist yet ──────────────────────
-- This table extends auth.users with app-level profile data.
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT,
  full_name     TEXT,
  avatar_url    TEXT,
  referral_code TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- If the table already existed without some columns, add them safely:
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name     TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url    TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 2. RLS on profiles ───────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- ── 3. TRIGGER — auto-create profile row on new user signup ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- ── 4. BACKFILL — create profile rows for any existing auth users ────────────
INSERT INTO public.profiles (id, full_name, username)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''),
  COALESCE(raw_user_meta_data->>'username', split_part(email, '@', 1), '')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── 5. REFERRALS TABLE ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  credits_awarded INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_id)
);

-- ── 6. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_referred_idx ON public.referrals (referred_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx   ON public.referrals (status);

-- ── 7. RLS on referrals ──────────────────────────────────────────────────────
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'referrals' AND policyname = 'referrals_select_own'
  ) THEN
    CREATE POLICY referrals_select_own ON public.referrals
      FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
  END IF;
END $$;

-- Backend service-role bypasses RLS for INSERT/UPDATE operations.

-- ── 8. Auto-update updated_at on referrals ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS referrals_set_updated_at ON public.referrals;
CREATE TRIGGER referrals_set_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

SELECT 'profiles + referral migration complete' AS status;
