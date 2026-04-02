-- Remove from strategies table
ALTER TABLE strategies DROP COLUMN IF EXISTS total_spend;
ALTER TABLE strategies DROP COLUMN IF EXISTS total_revenue;
ALTER TABLE strategies DROP COLUMN IF EXISTS roas;
ALTER TABLE strategies DROP COLUMN IF EXISTS budget_total;
ALTER TABLE strategies DROP COLUMN IF EXISTS budget_daily;
ALTER TABLE strategies DROP COLUMN IF EXISTS strategy_version;

-- Remove from users table
ALTER TABLE users DROP COLUMN IF EXISTS total_spend_all_time;
ALTER TABLE users DROP COLUMN IF EXISTS average_roas_all_time;
ALTER TABLE users DROP COLUMN IF EXISTS preferred_strategy_type;
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE users DROP COLUMN IF EXISTS subscription_tier;

-- Remove entire tables
DROP TABLE IF EXISTS ad_campaigns;
DROP TABLE IF EXISTS ad_spend_history;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS billing_records;
DROP TABLE IF EXISTS subscription_plans;

-- Platform Intelligence
CREATE TABLE IF NOT EXISTS platform_intelligence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform VARCHAR(50),
    captured_at TIMESTAMP DEFAULT NOW(),
    algorithm_priorities JSONB,
    trending_formats JSONB,
    optimal_times JSONB,
    detected_shifts JSONB,
    predictions JSONB,
    risks JSONB
);

-- Social Listening
CREATE TABLE IF NOT EXISTS social_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(50),
    source_id VARCHAR(255),
    content TEXT,
    author VARCHAR(255),
    posted_at TIMESTAMP,
    collected_at TIMESTAMP DEFAULT NOW(),
    category VARCHAR(255),
    entities JSONB,
    sentiment FLOAT,
    intent VARCHAR(50),
    topics TEXT[]
);

ALTER TABLE social_conversations ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS social_conversations_source_id_uniq ON social_conversations(source_id);

CREATE TABLE IF NOT EXISTS processed_social_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    social_conversation_id UUID UNIQUE REFERENCES social_conversations(id) ON DELETE CASCADE,
    entities JSONB,
    sentiment FLOAT,
    intent VARCHAR(50),
    topics TEXT[],
    processed_at TIMESTAMP DEFAULT NOW(),
    processor VARCHAR(100),
    processing_error TEXT
);

-- Emotional Intelligence
CREATE TABLE IF NOT EXISTS emotional_ownership (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(255),
    emotion VARCHAR(20),
    owner_brand VARCHAR(255),
    ownership_percentage FLOAT,
    confidence FLOAT,
    detected_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emotional_ownership_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(255),
    emotion VARCHAR(20),
    owner_brand VARCHAR(255),
    ownership_percentage FLOAT,
    confidence FLOAT,
    detected_at TIMESTAMP DEFAULT NOW()
);

-- GEO Monitoring
CREATE TABLE IF NOT EXISTS narrative_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID,
    llm_model VARCHAR(50),
    query TEXT,
    response TEXT,
    sentiment FLOAT,
    claims TEXT[],
    missing_claims TEXT[],
    competitors JSONB,
    captured_at TIMESTAMP DEFAULT NOW()
);

-- AI Decisions
CREATE TABLE IF NOT EXISTS ai_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_type VARCHAR(50),
    context JSONB,
    intelligence_used JSONB,
    weights_applied JSONB,
    options_considered JSONB,
    selected_option JSONB,
    predicted_outcome JSONB,
    actual_outcome JSONB,
    decision_time TIMESTAMP DEFAULT NOW(),
    strategy_id UUID,
    learning_analysis JSONB 
);

CREATE TABLE IF NOT EXISTS service_state (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(255),
    captured_at TIMESTAMP DEFAULT NOW(),
    questions JSONB,
    pain_points JSONB,
    trending_topics JSONB,
    sentiment_trend JSONB
);

-- Engagement Logs (For history tracking)
CREATE TABLE IF NOT EXISTS engagement_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    external_user_id VARCHAR(255),
    interaction_type VARCHAR(50),
    external_id VARCHAR(255),
    input_text TEXT,
    reply_text TEXT,
    sentiment FLOAT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Enhance existing tables
ALTER TABLE products ADD COLUMN IF NOT EXISTS emotional_appeal_profile JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS conversation_context JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ai_narrative_baseline JSONB;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS emotional_impact JSONB;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS ai_narrative_shift JSONB;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS platform_selection_logic JSONB;
