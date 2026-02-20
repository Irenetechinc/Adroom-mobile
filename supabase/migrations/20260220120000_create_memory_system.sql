-- Memory System Implementation based on AdRoom Strategy Flow PDF

-- 1. USER MEMORY EXTENSION
-- Create a profile table to store extended user memory
CREATE TABLE IF NOT EXISTS public.user_memory (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT,
    email TEXT,
    account_created_date TIMESTAMPTZ DEFAULT NOW(),
    last_active_date TIMESTAMPTZ,
    total_strategies_created INTEGER DEFAULT 0,
    total_spend_all_time NUMERIC(12, 2) DEFAULT 0,
    average_roas_all_time NUMERIC(5, 2) DEFAULT 0,
    preferred_platforms JSONB DEFAULT '[]'::jsonb, -- Array of platform names
    preferred_strategy_type TEXT, -- 'free' or 'paid'
    communication_preferences JSONB DEFAULT '{"notification_frequency": "daily", "detail_level": "standard"}'::jsonb,
    performance_patterns JSONB DEFAULT '{}'::jsonb, -- AI-detected patterns (best_time, best_format, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memory" ON public.user_memory
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own memory" ON public.user_memory
    FOR UPDATE USING (auth.uid() = user_id);

-- 2. PRODUCT MEMORY
CREATE TABLE IF NOT EXISTS public.product_memory (
    product_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    product_type TEXT,
    color TEXT,
    size TEXT,
    features JSONB DEFAULT '[]'::jsonb, -- Array of strings
    price NUMERIC(10, 2),
    description TEXT,
    target_audience TEXT, -- User entered
    target_audience_ai TEXT, -- AI enhanced
    original_scan_data JSONB, -- Raw Gemini output
    images JSONB DEFAULT '[]'::jsonb, -- Array of image URLs
    created_date TIMESTAMPTZ DEFAULT NOW(),
    times_promoted INTEGER DEFAULT 0,
    best_performing_goal TEXT,
    best_performing_platform TEXT,
    average_roas_when_promoted NUMERIC(5, 2),
    enhanced_description TEXT -- AI generated summary
);

ALTER TABLE public.product_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own products" ON public.product_memory
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own products" ON public.product_memory
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own products" ON public.product_memory
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own products" ON public.product_memory
    FOR DELETE USING (auth.uid() = user_id);

-- 3. SERVICE MEMORY
CREATE TABLE IF NOT EXISTS public.service_memory (
    service_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    service_name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    price NUMERIC(10, 2),
    pricing_model TEXT, -- e.g., 'hourly', 'fixed', 'subscription'
    service_area TEXT,
    target_audience TEXT,
    created_date TIMESTAMPTZ DEFAULT NOW(),
    times_promoted INTEGER DEFAULT 0,
    best_performing_goal TEXT,
    best_performing_platform TEXT
);

ALTER TABLE public.service_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own services" ON public.service_memory
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own services" ON public.service_memory
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own services" ON public.service_memory
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own services" ON public.service_memory
    FOR DELETE USING (auth.uid() = user_id);

-- 4. BRAND MEMORY
CREATE TABLE IF NOT EXISTS public.brand_memory (
    brand_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    brand_name TEXT NOT NULL,
    mission TEXT,
    values_list JSONB DEFAULT '[]'::jsonb, -- 'values' is reserved keyword sometimes
    voice TEXT,
    colors JSONB DEFAULT '[]'::jsonb,
    logo TEXT, -- URL
    target_audience TEXT,
    created_date TIMESTAMPTZ DEFAULT NOW(),
    times_promoted INTEGER DEFAULT 0
);

ALTER TABLE public.brand_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own brands" ON public.brand_memory
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own brands" ON public.brand_memory
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own brands" ON public.brand_memory
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own brands" ON public.brand_memory
    FOR DELETE USING (auth.uid() = user_id);

-- 5. STRATEGY MEMORY (Enhanced Strategies Table)
-- We will alter the existing table if it exists, or create new columns.
-- For simplicity in this script, we'll create a new comprehensive table 
-- and migrate data if needed later, but to avoid conflicts with existing code,
-- we'll call it 'strategy_memory' and can view it as the "Brain's record".
-- Ideally we should replace 'strategies', but let's keep it safe.

CREATE TABLE IF NOT EXISTS public.strategy_memory (
    strategy_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    strategy_name TEXT NOT NULL,
    strategy_type TEXT, -- 'product', 'service', 'brand', 'brand+product', 'brand+service'
    strategy_version TEXT, -- 'free', 'paid'
    goal TEXT, -- 'sales', 'awareness', 'promotional', 'launch', 'local', 'retargeting', 'lead_gen'
    duration_days INTEGER,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    status TEXT DEFAULT 'draft', -- 'active', 'completed', 'paused', 'cancelled', 'draft'
    product_id UUID REFERENCES public.product_memory(product_id),
    service_id UUID REFERENCES public.service_memory(service_id),
    brand_id UUID REFERENCES public.brand_memory(brand_id),
    
    -- Performance Metrics
    total_impressions INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    total_leads INTEGER DEFAULT 0,
    total_conversions INTEGER DEFAULT 0,
    total_spend NUMERIC(12, 2) DEFAULT 0,
    total_revenue NUMERIC(12, 2) DEFAULT 0,
    roas NUMERIC(5, 2) DEFAULT 0,
    
    -- Detailed Data
    platform_data JSONB DEFAULT '{}'::jsonb, -- Platforms used and their specific settings/metrics
    notes TEXT, -- AI summary
    content_calendar JSONB, -- Full schedule
    campaign_structure JSONB, -- Paid campaign structure
    budget_total NUMERIC(12, 2),
    budget_daily NUMERIC(12, 2),
    expected_outcomes JSONB, -- Predicted ranges
    optimizations_applied JSONB DEFAULT '[]'::jsonb, -- Log of changes
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.strategy_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategies" ON public.strategy_memory
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strategies" ON public.strategy_memory
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategies" ON public.strategy_memory
    FOR UPDATE USING (auth.uid() = user_id);

-- 6. PLATFORM MEMORY (Global)
CREATE TABLE IF NOT EXISTS public.platform_memory (
    platform_name TEXT PRIMARY KEY, -- 'facebook', 'instagram', 'tiktok'
    algorithm_update_history JSONB DEFAULT '[]'::jsonb,
    current_priorities JSONB DEFAULT '{}'::jsonb, -- e.g. video_preference_level, reels_weight
    trend_history JSONB DEFAULT '[]'::jsonb,
    seasonal_patterns JSONB DEFAULT '[]'::jsonb,
    industry_benchmarks JSONB DEFAULT '{}'::jsonb,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.platform_memory ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read platform memory
CREATE POLICY "Authenticated users can read platform memory" ON public.platform_memory
    FOR SELECT TO authenticated USING (true);

-- Only service role/admin can update (we'll assume service role for AI updates)

-- 7. GLOBAL STRATEGY MEMORY
CREATE TABLE IF NOT EXISTS public.global_strategy_memory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category TEXT NOT NULL, -- Industry or Category
    goal_type TEXT,
    platform TEXT,
    strategy_type TEXT, -- 'free', 'paid'
    
    -- Aggregated Stats
    total_strategies_run INTEGER DEFAULT 0,
    average_roas NUMERIC(5, 2) DEFAULT 0,
    average_success_rate NUMERIC(5, 2) DEFAULT 0,
    best_content_formats JSONB DEFAULT '[]'::jsonb,
    best_ad_copy_patterns JSONB DEFAULT '[]'::jsonb,
    worst_performing_approaches JSONB DEFAULT '[]'::jsonb,
    seasonal_trends JSONB DEFAULT '[]'::jsonb,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.global_strategy_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read global memory" ON public.global_strategy_memory
    FOR SELECT TO authenticated USING (true);

-- 8. IPE INTELLIGENCE LOG
CREATE TABLE IF NOT EXISTS public.ipe_intelligence_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    priority INTEGER, -- 1=Urgent, 2=Important, 3=Strategic
    intelligence_type TEXT, -- 'algorithm_shift', 'opportunity', 'risk', 'prediction'
    platform TEXT,
    summary TEXT,
    details JSONB,
    recommended_actions JSONB DEFAULT '[]'::jsonb,
    affected_strategies JSONB DEFAULT '[]'::jsonb, -- List of strategy_ids
    expires_at TIMESTAMPTZ
);

ALTER TABLE public.ipe_intelligence_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read intelligence" ON public.ipe_intelligence_log
    FOR SELECT TO authenticated USING (true);

