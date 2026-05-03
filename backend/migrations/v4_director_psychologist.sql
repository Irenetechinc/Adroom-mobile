-- v4_director_psychologist.sql
-- Director Agent, Psychologist Engine, Product delivery fields, Agent deals, Video edit execution

-- ─── PRODUCT MEMORY: New fields for physical/digital products & delivery ──────
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) DEFAULT 'physical';
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50);
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS bank_account_details TEXT;
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS color VARCHAR(100);
ALTER TABLE product_memory ADD COLUMN IF NOT EXISTS available_sizes TEXT[];

-- ─── PSYCHOLOGIST PROFILES: Real-time audience behavioral predictions ─────────
CREATE TABLE IF NOT EXISTS psychologist_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(255),
    product_id UUID,
    user_id UUID,
    behavioral_profile JSONB NOT NULL DEFAULT '{}',
    emotional_triggers JSONB NOT NULL DEFAULT '{}',
    timing_patterns JSONB DEFAULT '{}',
    share_drivers JSONB DEFAULT '[]',
    trust_signals JSONB DEFAULT '[]',
    rejection_signals JSONB DEFAULT '[]',
    raw_intelligence JSONB DEFAULT '{}',
    confidence_score FLOAT DEFAULT 0.7,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psychologist_category ON psychologist_profiles(category);
CREATE INDEX IF NOT EXISTS idx_psychologist_product_id ON psychologist_profiles(product_id);
CREATE INDEX IF NOT EXISTS idx_psychologist_user_id ON psychologist_profiles(user_id);

-- Unique constraint: one profile per product (upsert target)
CREATE UNIQUE INDEX IF NOT EXISTS idx_psychologist_product_unique ON psychologist_profiles(product_id)
  WHERE product_id IS NOT NULL;

-- ─── DIRECTOR PROFILES: Unique visual identity per user/campaign ──────────────
CREATE TABLE IF NOT EXISTS director_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    product_id UUID,
    strategy_id UUID,
    visual_identity JSONB NOT NULL DEFAULT '{}',
    creative_direction JSONB NOT NULL DEFAULT '{}',
    unique_fingerprint TEXT NOT NULL,
    emotional_tone JSONB DEFAULT '{}',
    platform_adaptations JSONB DEFAULT '{}',
    generated_from JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_director_user_id ON director_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_director_strategy_id ON director_profiles(strategy_id);
CREATE INDEX IF NOT EXISTS idx_director_product_id ON director_profiles(product_id);

-- ─── AGENT DEALS: Closed deals with full buyer & delivery details ─────────────
CREATE TABLE IF NOT EXISTS agent_deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id UUID,
    user_id UUID NOT NULL,
    lead_id UUID,
    platform VARCHAR(50),
    buyer_name VARCHAR(255),
    buyer_contact VARCHAR(255),
    product_name VARCHAR(255),
    product_id UUID,
    deal_value FLOAT DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    delivery_type VARCHAR(50),
    delivery_address TEXT,
    payment_details JSONB DEFAULT '{}',
    closing_message TEXT,
    agent_reasoning TEXT,
    status VARCHAR(50) DEFAULT 'closed_won',
    closed_at TIMESTAMP DEFAULT NOW(),
    notified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_deals_user_id ON agent_deals(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_deals_strategy_id ON agent_deals(strategy_id);
CREATE INDEX IF NOT EXISTS idx_agent_deals_closed_at ON agent_deals(closed_at DESC);

-- ─── VIDEO EDIT JOBS: Execution tracking columns ──────────────────────────────
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS executed_video_url TEXT;
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS execution_status VARCHAR(50) DEFAULT 'plan_ready';
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS execution_error TEXT;
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS director_profile_id UUID;
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS psychologist_insights JSONB;
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP;
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS platform VARCHAR(50);
ALTER TABLE video_edit_jobs ADD COLUMN IF NOT EXISTS product_id UUID;

CREATE INDEX IF NOT EXISTS idx_video_edit_jobs_execution_status ON video_edit_jobs(execution_status);
