-- Keep user-specific audience reports separate from the shared platform feed.
CREATE TABLE IF NOT EXISTS public.strategy_audience_intelligence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    strategy_id UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
    intel_type TEXT NOT NULL DEFAULT 'demographic_analysis',
    data JSONB NOT NULL,
    confidence TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT strategy_audience_intelligence_type_check
        CHECK (intel_type = 'demographic_analysis'),
    CONSTRAINT strategy_audience_intelligence_user_strategy_type_key
        UNIQUE (user_id, strategy_id, intel_type)
);

CREATE INDEX IF NOT EXISTS strategy_audience_intelligence_strategy_generated_idx
    ON public.strategy_audience_intelligence (strategy_id, generated_at DESC);

ALTER TABLE public.strategy_audience_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own audience intelligence"
    ON public.strategy_audience_intelligence;
CREATE POLICY "Users can read their own audience intelligence"
    ON public.strategy_audience_intelligence
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = strategy_audience_intelligence.user_id
        AND EXISTS (
            SELECT 1
            FROM public.strategies AS s
            WHERE s.id = strategy_audience_intelligence.strategy_id
              AND s.user_id = auth.uid()
        )
    );

REVOKE ALL ON TABLE public.strategy_audience_intelligence FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.strategy_audience_intelligence TO authenticated;
GRANT ALL ON TABLE public.strategy_audience_intelligence TO service_role;

-- No authenticated INSERT, UPDATE, or DELETE policy is created; writes use the backend service role.