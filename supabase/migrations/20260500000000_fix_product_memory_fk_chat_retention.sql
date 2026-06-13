-- ============================================================
-- Migration: Fix product_memory FK + ensure ai_conversation_memory
-- ============================================================

-- 1. Add proper FK from strategies.product_id -> product_memory(product_id)
--    (prevents "column product_memory.id does not exist" error in Supabase joins)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategies_product_id_fkey'
      AND conrelid = 'public.strategies'::regclass
  ) THEN
    ALTER TABLE public.strategies
      ADD CONSTRAINT strategies_product_id_fkey
      FOREIGN KEY (product_id)
      REFERENCES public.product_memory(product_id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- 2. Ensure ai_conversation_memory table exists (used by MemPalace chat history)
CREATE TABLE IF NOT EXISTS public.ai_conversation_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user-scoped lookups
CREATE INDEX IF NOT EXISTS idx_ai_conv_mem_user_created
  ON public.ai_conversation_memory(user_id, created_at DESC);

-- 3. Enable RLS on ai_conversation_memory
ALTER TABLE public.ai_conversation_memory ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can read own conversation memory" ON public.ai_conversation_memory;
DROP POLICY IF EXISTS "Users can insert own conversation memory" ON public.ai_conversation_memory;
DROP POLICY IF EXISTS "Users can delete own conversation memory" ON public.ai_conversation_memory;

CREATE POLICY "Users can read own conversation memory"
  ON public.ai_conversation_memory FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversation memory"
  ON public.ai_conversation_memory FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversation memory"
  ON public.ai_conversation_memory FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Auto-delete messages older than 7 days using a database function
--    Called by a cron job or by the backend cleanup endpoint.
CREATE OR REPLACE FUNCTION public.cleanup_old_conversation_memory()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM public.ai_conversation_memory
  WHERE created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION public.cleanup_old_conversation_memory() TO service_role;
