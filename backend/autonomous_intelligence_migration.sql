-- =============================================================================
-- AUTONOMOUS INTELLIGENCE MIGRATION
-- Tables for: self-evolution log, lead evolution queries,
--             follow-up evolution engine, AI prompt log
--
-- Run in Supabase SQL editor AFTER all other AdRoom migrations.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SELF EVOLUTION LOG
--    Every lead-discovery self-evolution cycle decision is persisted here.
--    The AI Brain reads this on each cycle to improve its own decisions.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_evolution_log (
    id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent                   TEXT NOT NULL,                    -- e.g. 'LEAD_DISCOVERY', 'SALESMAN'
    cycle_date              TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_performance      JSONB NOT NULL DEFAULT '[]',      -- array of { source, leadCount, avgScore }
    conversion_by_source    JSONB NOT NULL DEFAULT '{}',      -- { source: count }
    analysis                TEXT NOT NULL DEFAULT '',         -- AI Brain's prose analysis
    adopted_sources         JSONB NOT NULL DEFAULT '[]',      -- array of adopt decisions
    scaled_back_sources     JSONB NOT NULL DEFAULT '[]',      -- array of scale-back decisions
    new_source_ideas        JSONB NOT NULL DEFAULT '[]',      -- proposed new source experiments
    overall_recommendation  TEXT NOT NULL DEFAULT '',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_self_evolution_log_agent     ON self_evolution_log (agent);
CREATE INDEX IF NOT EXISTS idx_self_evolution_log_cycle     ON self_evolution_log (cycle_date DESC);

-- Enable RLS — service role only (backend reads/writes directly)
ALTER TABLE self_evolution_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_self_evolution_log" ON self_evolution_log;
CREATE POLICY "service_role_all_self_evolution_log" ON self_evolution_log
    FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LEAD EVOLUTION QUERIES
--    Evolved search query variations adopted by the self-evolution engine.
--    The discovery cycle loads these and merges them with AI-generated base queries.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_evolution_queries (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    source          TEXT NOT NULL,   -- 'social_listening' | 'reddit' | 'forum' | 'search_engine' | 'review_site'
    query           TEXT NOT NULL,
    rationale       TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'retired'
    discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at      TIMESTAMPTZ,
    performance     JSONB DEFAULT '{}'                -- filled by future evolution cycles
);

-- Unique per source+query so upsert works cleanly
CREATE UNIQUE INDEX IF NOT EXISTS uidx_lead_evolution_queries_source_query
    ON lead_evolution_queries (source, query);

CREATE INDEX IF NOT EXISTS idx_lead_evolution_queries_source  ON lead_evolution_queries (source, status);

ALTER TABLE lead_evolution_queries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_lead_evolution_queries" ON lead_evolution_queries;
CREATE POLICY "service_role_all_lead_evolution_queries" ON lead_evolution_queries
    FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FOLLOW-UP EVOLUTION LOG
--    Every AI-determined follow-up timing/channel decision is logged here.
--    When a lead converts, the matching rows are updated with outcome='converted'
--    so the AI Brain learns which intervals and channels actually close deals.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_up_evolution_log (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id             UUID REFERENCES agent_leads(id) ON DELETE CASCADE,
    platform            TEXT NOT NULL,
    stage               TEXT NOT NULL,
    dm_sequence_step    INT NOT NULL DEFAULT 0,
    intent_score        NUMERIC(4,3),
    interval_ms_chosen  BIGINT NOT NULL,                    -- the interval the AI chose
    winning_interval_ms BIGINT,                             -- filled when outcome = 'converted'
    channel             TEXT NOT NULL DEFAULT '',           -- platform used for this touchpoint
    experiment_note     TEXT NOT NULL DEFAULT 'none',       -- what experiment was being run
    outcome             TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'converted' | 'no_response' | 'unsubscribed'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_follow_up_evolution_platform  ON follow_up_evolution_log (platform, outcome);
CREATE INDEX IF NOT EXISTS idx_follow_up_evolution_lead      ON follow_up_evolution_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_evolution_created   ON follow_up_evolution_log (created_at DESC);

ALTER TABLE follow_up_evolution_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_follow_up_evolution_log" ON follow_up_evolution_log;
CREATE POLICY "service_role_all_follow_up_evolution_log" ON follow_up_evolution_log
    FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AI PROMPT LOG (Capability 2)
--    Lightweight log of every significant AI Brain decision.
--    Lets the system audit its own reasoning and learn from past prompts.
--    Only key decisions are logged (not every small Economy call).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_prompt_log (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_type      TEXT NOT NULL,          -- 'SALESMAN' | 'AWARENESS' | 'LEAD_DISCOVERY' | etc.
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    strategy_id     UUID,
    operation       TEXT NOT NULL,          -- e.g. 'buildSkill', 'selfLearnFromPerformance', 'evolveDiscoverySources'
    prompt_summary  TEXT NOT NULL DEFAULT '', -- first 500 chars of the prompt
    response_summary TEXT NOT NULL DEFAULT '', -- first 500 chars of the response
    model_used      TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    latency_ms      INT,
    success         BOOLEAN NOT NULL DEFAULT TRUE,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_log_agent      ON ai_prompt_log (agent_type);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_log_operation  ON ai_prompt_log (operation);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_log_user       ON ai_prompt_log (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_log_created    ON ai_prompt_log (created_at DESC);

ALTER TABLE ai_prompt_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_ai_prompt_log" ON ai_prompt_log;
CREATE POLICY "service_role_all_ai_prompt_log" ON ai_prompt_log
    FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE — summary of tables created
-- ─────────────────────────────────────────────────────────────────────────────
-- self_evolution_log          — records every lead-discovery evolution cycle decision
-- lead_evolution_queries      — evolved search queries adopted by the self-evolution engine
-- follow_up_evolution_log     — AI-chosen follow-up intervals + outcomes for learning
-- ai_prompt_log               — lightweight audit log of key AI Brain decisions
