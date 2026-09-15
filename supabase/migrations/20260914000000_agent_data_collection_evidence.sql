-- =============================================================================
-- DATA COLLECTION EVIDENCE MIGRATION
-- Shared live evidence table for all agents, engines, and tools.
-- This stores fresh, verified web/social evidence that must be scrutized
-- before it is used by downstream logic or sent to end users.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_data_collection_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'search',
    title TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    url TEXT,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trust_score NUMERIC(4,3) NOT NULL DEFAULT 0,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verification_reason TEXT NOT NULL DEFAULT '',
    freshness_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_data_collection_strategy
    ON public.agent_data_collection_evidence (strategy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_data_collection_user
    ON public.agent_data_collection_evidence (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_data_collection_verified
    ON public.agent_data_collection_evidence (is_verified, captured_at DESC);

ALTER TABLE public.agent_data_collection_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own collection evidence" ON public.agent_data_collection_evidence;
CREATE POLICY "Users see own collection evidence"
    ON public.agent_data_collection_evidence
    FOR ALL
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role all collection evidence" ON public.agent_data_collection_evidence;
CREATE POLICY "Service role all collection evidence"
    ON public.agent_data_collection_evidence
    FOR ALL
    USING (auth.role() = 'service_role');
