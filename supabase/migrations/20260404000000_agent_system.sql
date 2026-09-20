-- Agent Tasks: Every action an agent schedules gets a row here
CREATE TABLE IF NOT EXISTS public.agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL CHECK (agent_type IN ('SALESMAN', 'AWARENESS', 'PROMOTION', 'LAUNCH')),
    task_type TEXT NOT NULL, -- POST, DM, REPLY, HASHTAG_BLITZ, STORY, REEL, THREAD
    platform TEXT NOT NULL,  -- facebook, instagram, twitter, linkedin, tiktok
    scheduled_at TIMESTAMPTZ NOT NULL,
    executed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','done','failed','skipped')),
    content JSONB NOT NULL DEFAULT '{}',   -- headline, body, image_prompt, hashtags, cta
    result JSONB DEFAULT '{}',             -- platform_post_id, reach, likes, comments
    retry_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_due ON public.agent_tasks (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_agent_tasks_strategy ON public.agent_tasks (strategy_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON public.agent_tasks (user_id);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own agent tasks" ON public.agent_tasks FOR ALL USING (auth.uid() = user_id);

-- Agent Skills: Dynamic skills that agents create themselves when they hit a gap
CREATE TABLE IF NOT EXISTS public.agent_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_type TEXT NOT NULL,
    skill_name TEXT NOT NULL UNIQUE,
    skill_description TEXT NOT NULL,
    trigger_condition TEXT NOT NULL,       -- When should this skill auto-activate?
    execution_prompt TEXT NOT NULL,        -- The GPT-4o prompt template for this skill
    parameters JSONB DEFAULT '{}',         -- What inputs does the skill expect?
    success_metric TEXT,                   -- How do we know it worked?
    used_count INT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    avg_impact_score FLOAT DEFAULT 0,
    created_by_agent_run TEXT,             -- Which strategy_id triggered creation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Performance: Real metrics fetched from platform APIs
CREATE TABLE IF NOT EXISTS public.agent_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    task_id UUID REFERENCES public.agent_tasks(id),
    platform TEXT NOT NULL,
    platform_post_id TEXT,
    metric_date DATE DEFAULT CURRENT_DATE,
    impressions INT DEFAULT 0,
    reach INT DEFAULT 0,
    likes INT DEFAULT 0,
    comments INT DEFAULT 0,
    shares INT DEFAULT 0,
    clicks INT DEFAULT 0,
    leads_captured INT DEFAULT 0,
    conversions INT DEFAULT 0,
    dms_sent INT DEFAULT 0,
    dms_replied INT DEFAULT 0,
    paid_equivalent_usd DECIMAL(10,2) DEFAULT 0,
    raw_platform_data JSONB DEFAULT '{}',
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_perf_strategy ON public.agent_performance (strategy_id);
CREATE INDEX IF NOT EXISTS idx_agent_perf_date ON public.agent_performance (metric_date DESC);

ALTER TABLE public.agent_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own performance" ON public.agent_performance FOR ALL USING (auth.uid() = user_id);

-- Leads: People the SALESMAN agent is nurturing
CREATE TABLE IF NOT EXISTS public.agent_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    platform_username TEXT,
    first_interaction TEXT,                -- The comment/message that identified them
    intent_score FLOAT DEFAULT 0,          -- 0.0 = low, 1.0 = confirmed buyer
    intent_signals JSONB DEFAULT '[]',     -- Which signals scored them
    stage TEXT DEFAULT 'identified' CHECK (stage IN ('identified','engaged','nurturing','converted','lost')),
    dm_sequence_step INT DEFAULT 0,
    last_contacted_at TIMESTAMPTZ,
    next_followup_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform, platform_user_id)
);

ALTER TABLE public.agent_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own leads" ON public.agent_leads FOR ALL USING (auth.uid() = user_id);

-- Ensure strategies table has required columns for active agent tracking
ALTER TABLE public.strategies 
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS agent_type TEXT,
    ADD COLUMN IF NOT EXISTS current_execution_plan JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS platform_selection_logic JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS content_calendar JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS duration INT,
    ADD COLUMN IF NOT EXISTS product_id UUID;
