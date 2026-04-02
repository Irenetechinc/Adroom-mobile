
-- 1. DROP PAID TABLES AND COMPONENTS
DROP TABLE IF EXISTS public.ad_campaigns CASCADE;
DROP TABLE IF EXISTS public.ad_spend_history CASCADE;
DROP TABLE IF EXISTS public.payment_methods CASCADE;
DROP TABLE IF EXISTS public.billing_records CASCADE;
DROP TABLE IF EXISTS public.subscription_plans CASCADE;
DROP TABLE IF EXISTS public.ad_sets CASCADE;
DROP TABLE IF EXISTS public.ads CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.wallets CASCADE; -- Assuming wallet is part of paid system

-- 2. REMOVE PAID COLUMNS FROM EXISTING TABLES
-- Remove from user_memory
ALTER TABLE public.user_memory 
DROP COLUMN IF EXISTS total_spend_all_time,
DROP COLUMN IF EXISTS average_roas_all_time,
DROP COLUMN IF EXISTS preferred_strategy_type,
DROP COLUMN IF EXISTS stripe_customer_id,
DROP COLUMN IF EXISTS subscription_tier;

-- Remove from strategies
ALTER TABLE public.strategies
DROP COLUMN IF EXISTS type,
DROP COLUMN IF EXISTS cost;

-- Remove from strategy_memory
ALTER TABLE public.strategy_memory
DROP COLUMN IF EXISTS strategy_version,
DROP COLUMN IF EXISTS total_spend,
DROP COLUMN IF EXISTS total_revenue,
DROP COLUMN IF EXISTS roas,
DROP COLUMN IF EXISTS budget_total,
DROP COLUMN IF EXISTS budget_daily,
DROP COLUMN IF EXISTS campaign_structure;

-- Remove from global_strategy_memory
ALTER TABLE public.global_strategy_memory
DROP COLUMN IF EXISTS strategy_type,
DROP COLUMN IF EXISTS average_roas;

-- 3. CREATE NEW INTELLIGENCE TABLES

-- Platform Intelligence
CREATE TABLE IF NOT EXISTS public.platform_intelligence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    algorithm_priorities JSONB,
    trending_formats JSONB,
    optimal_times JSONB,
    detected_shifts JSONB,
    predictions JSONB,
    risks JSONB
);

-- Social Listening - Raw Conversations
CREATE TABLE IF NOT EXISTS public.social_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(50),
    source_id VARCHAR(255) UNIQUE,
    content TEXT,
    author VARCHAR(255),
    posted_at TIMESTAMPTZ,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    category VARCHAR(255),
    content_hash TEXT,
    entities JSONB,
    sentiment FLOAT,
    intent VARCHAR(50),
    topics TEXT[]
);

-- Emotional Intelligence - Ownership
CREATE TABLE IF NOT EXISTS public.emotional_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(255),
    emotion VARCHAR(20),
    owner_brand VARCHAR(255),
    ownership_percentage FLOAT,
    confidence FLOAT,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Emotional Intelligence - History
CREATE TABLE IF NOT EXISTS public.emotional_ownership_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(255),
    emotion VARCHAR(20),
    owner_brand VARCHAR(255),
    ownership_percentage FLOAT,
    confidence FLOAT,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- GEO Monitoring - Narrative Snapshots
CREATE TABLE IF NOT EXISTS public.narrative_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID,
    llm_model VARCHAR(50),
    query TEXT,
    response TEXT,
    sentiment FLOAT,
    claims TEXT[],
    missing_claims TEXT[],
    competitors JSONB,
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Decisions
CREATE TABLE IF NOT EXISTS public.ai_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_type VARCHAR(50),
    context JSONB,
    intelligence_used JSONB,
    weights_applied JSONB,
    options_considered JSONB,
    selected_option JSONB,
    predicted_outcome JSONB,
    actual_outcome JSONB,
    learning_analysis JSONB,
    decision_time TIMESTAMPTZ DEFAULT NOW(),
    strategy_id UUID
);

-- 4. ENHANCE EXISTING TABLES
-- Add website_url to product_memory
ALTER TABLE public.product_memory ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE public.product_memory ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;

-- Add platform unique constraint to ad_configs if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'ad_configs_user_id_platform_key'
    ) THEN
        ALTER TABLE public.ad_configs ADD CONSTRAINT ad_configs_user_id_platform_key UNIQUE (user_id, platform);
    END IF;
END $$;

-- Add new columns to product_memory
ALTER TABLE public.product_memory ADD COLUMN IF NOT EXISTS emotional_appeal_profile JSONB;
ALTER TABLE public.product_memory ADD COLUMN IF NOT EXISTS conversation_context JSONB;
ALTER TABLE public.product_memory ADD COLUMN IF NOT EXISTS ai_narrative_baseline JSONB;

-- Add new columns to strategy_memory
ALTER TABLE public.strategy_memory ADD COLUMN IF NOT EXISTS emotional_impact JSONB;
ALTER TABLE public.strategy_memory ADD COLUMN IF NOT EXISTS ai_narrative_shift JSONB;
ALTER TABLE public.strategy_memory ADD COLUMN IF NOT EXISTS platform_selection_logic JSONB;

-- 5. ENABLE RLS FOR NEW TABLES
ALTER TABLE public.platform_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emotional_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emotional_ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.narrative_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_decisions ENABLE ROW LEVEL SECURITY;

-- Basic Policies
CREATE POLICY "Authenticated users can read platform intelligence" ON public.platform_intelligence FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read social conversations" ON public.social_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read emotional ownership" ON public.emotional_ownership FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read emotional history" ON public.emotional_ownership_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own narrative snapshots" ON public.narrative_snapshots FOR SELECT USING (auth.uid() = brand_id);
-- 6. GOAL OPTIMIZATION & AGENT INTERVENTIONS
CREATE TABLE IF NOT EXISTS public.goal_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
    goal_type VARCHAR(50) NOT NULL, -- sales, awareness, promotional, launch
    target_value JSONB, -- e.g. {"reach": 10000, "conversions": 50}
    current_value JSONB,
    progress_percentage FLOAT DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.agent_interventions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
    agent_type VARCHAR(50) NOT NULL, -- sales_agent, awareness_agent, etc.
    problem_detected TEXT,
    thinking_process TEXT,
    action_taken TEXT,
    intelligence_used JSONB,
    impact_score FLOAT, -- 0-1
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.goal_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_interventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own goal progress" ON public.goal_progress FOR SELECT USING (EXISTS (SELECT 1 FROM strategies s WHERE s.id = strategy_id AND s.user_id = auth.uid()));
CREATE POLICY "Users can view their own agent interventions" ON public.agent_interventions FOR SELECT USING (EXISTS (SELECT 1 FROM strategies s WHERE s.id = strategy_id AND s.user_id = auth.uid()));
