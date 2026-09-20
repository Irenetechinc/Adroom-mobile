-- Prompt A/B variants and supervisor observability.
CREATE TABLE IF NOT EXISTS agent_prompt_variants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_type TEXT NOT NULL,
    operation TEXT NOT NULL,
    variant_key TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'adopted', 'rolled_back', 'retired')),
    impressions INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    average_score NUMERIC(8, 5) NOT NULL DEFAULT 0,
    last_outcome JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_type, operation, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_variants_selection
    ON agent_prompt_variants (agent_type, operation, status, impressions);

ALTER TABLE agent_prompt_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_agent_prompt_variants" ON agent_prompt_variants;
CREATE POLICY "service_role_all_agent_prompt_variants" ON agent_prompt_variants
    FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS agent_supervisor_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_supervisor_runs_created
    ON agent_supervisor_runs (created_at DESC);

ALTER TABLE agent_supervisor_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_agent_supervisor_runs" ON agent_supervisor_runs;
CREATE POLICY "service_role_all_agent_supervisor_runs" ON agent_supervisor_runs
    FOR ALL USING (auth.role() = 'service_role');