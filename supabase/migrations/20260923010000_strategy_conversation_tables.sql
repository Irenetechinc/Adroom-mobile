-- Conversation discovery/run state used by the strategy coordinator and
-- dashboard. This migration is intentionally Supabase-native; no hosted
-- external hosting service is required.

CREATE TABLE IF NOT EXISTS public.strategy_conversation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal TEXT,
  identified INTEGER NOT NULL DEFAULT 0,
  high_potential INTEGER NOT NULL DEFAULT 0,
  engaged INTEGER NOT NULL DEFAULT 0,
  routed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategy_conversation_runs_user_created_idx
  ON public.strategy_conversation_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategy_conversation_runs_strategy_created_idx
  ON public.strategy_conversation_runs (strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.strategy_conversation_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal TEXT,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  author_name TEXT,
  author_id TEXT,
  text TEXT NOT NULL,
  url TEXT,
  kind TEXT,
  intent_score NUMERIC(5,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'identified',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS strategy_conversation_signals_user_captured_idx
  ON public.strategy_conversation_signals (user_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS strategy_conversation_signals_strategy_captured_idx
  ON public.strategy_conversation_signals (strategy_id, captured_at DESC);

ALTER TABLE public.strategy_conversation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_conversation_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their strategy conversation runs" ON public.strategy_conversation_runs;
CREATE POLICY "Users can view their strategy conversation runs"
  ON public.strategy_conversation_runs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their strategy conversation signals" ON public.strategy_conversation_signals;
CREATE POLICY "Users can view their strategy conversation signals"
  ON public.strategy_conversation_signals FOR SELECT USING (auth.uid() = user_id);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.strategy_conversation_runs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.strategy_conversation_signals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;