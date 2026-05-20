-- ══════════════════════════════════════════════════════════════════════════════
-- APMA — Autonomous Political Marketing Agent — Database Migration
-- Run in your Supabase SQL Editor AFTER all AdRoom migrations
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. APMA Clients ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_clients (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  description     text,
  country         text NOT NULL DEFAULT 'NG',
  goal            text NOT NULL DEFAULT 'improve',  -- improve | damage
  target_entities jsonb DEFAULT '[]',               -- rival names, topics to address
  status          text NOT NULL DEFAULT 'active',   -- active | paused | archived
  contract_signed boolean NOT NULL DEFAULT false,
  api_key         text UNIQUE NOT NULL,              -- desktop app auth key
  api_key_hash    text NOT NULL,
  narrative_score numeric(5,4) NOT NULL DEFAULT 0,  -- -1.0 to +1.0
  baseline_score  numeric(5,4) NOT NULL DEFAULT 0,
  target_score    numeric(5,4) NOT NULL DEFAULT 0.6,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_clients_slug_idx   ON apma_clients(slug);
CREATE INDEX IF NOT EXISTS apma_clients_status_idx ON apma_clients(status);

-- ─── 2. APMA Campaigns ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_campaigns (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  name            text NOT NULL,
  goal            text NOT NULL DEFAULT 'improve',
  status          text NOT NULL DEFAULT 'active',   -- active | paused | completed
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  end_date        date,
  narrative_score_start numeric(5,4) DEFAULT 0,
  narrative_score_current numeric(5,4) DEFAULT 0,
  narrative_score_target  numeric(5,4) DEFAULT 0.6,
  platforms       jsonb NOT NULL DEFAULT '["twitter","facebook","reddit"]',
  keywords        jsonb NOT NULL DEFAULT '[]',
  daily_budget_usd numeric(10,2) DEFAULT 0,
  total_posts     integer NOT NULL DEFAULT 0,
  total_comments  integer NOT NULL DEFAULT 0,
  total_blogs     integer NOT NULL DEFAULT 0,
  total_groups    integer NOT NULL DEFAULT 0,
  config          jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_campaigns_client_id_idx ON apma_campaigns(client_id);
CREATE INDEX IF NOT EXISTS apma_campaigns_status_idx    ON apma_campaigns(status);

-- ─── 3. Political Conversations (Perception Layer) ───────────────────────────
CREATE TABLE IF NOT EXISTS political_conversations (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  source          text NOT NULL,   -- twitter | facebook | reddit | nairaland | news | youtube
  external_id     text,
  author_handle   text,
  content         text NOT NULL,
  sentiment       numeric(5,4),    -- -1.0 to +1.0
  emotions        jsonb DEFAULT '{}',
  topics          jsonb DEFAULT '[]',
  narrative_cluster text,
  engagement_score  numeric(10,2) DEFAULT 0,
  url             text,
  published_at    timestamptz,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pol_conv_client_id_idx   ON political_conversations(client_id);
CREATE INDEX IF NOT EXISTS pol_conv_campaign_id_idx ON political_conversations(campaign_id);
CREATE INDEX IF NOT EXISTS pol_conv_source_idx      ON political_conversations(source);
CREATE INDEX IF NOT EXISTS pol_conv_created_at_idx  ON political_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS pol_conv_sentiment_idx   ON political_conversations(sentiment);

-- ─── 4. Political Strategies (Decision Layer) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS political_strategies (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  plan_date       date NOT NULL DEFAULT CURRENT_DATE,
  plan            jsonb NOT NULL,              -- full daily plan JSON
  objective       text NOT NULL,
  target_narrative text NOT NULL,
  sentiment_at_creation numeric(5,4) DEFAULT 0,
  sentiment_shift_target numeric(5,4) DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending', -- pending | executing | completed
  actions_total   integer DEFAULT 0,
  actions_done    integer DEFAULT 0,
  effectiveness   numeric(5,4),                -- measured after execution
  created_at      timestamptz NOT NULL DEFAULT now(),
  executed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS pol_strat_campaign_id_idx ON political_strategies(campaign_id);
CREATE INDEX IF NOT EXISTS pol_strat_plan_date_idx   ON political_strategies(plan_date DESC);
CREATE INDEX IF NOT EXISTS pol_strat_status_idx      ON political_strategies(status);

-- ─── 5. APMA Personas (Humanizer Layer) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_personas (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       uuid REFERENCES apma_clients(id) ON DELETE SET NULL,
  name            text NOT NULL,
  age             integer NOT NULL,
  gender          text NOT NULL,
  occupation      text NOT NULL,
  location        text NOT NULL,
  country         text NOT NULL DEFAULT 'NG',
  writing_style   text NOT NULL,   -- formal | casual | slang | academic
  emoji_usage     text NOT NULL,   -- none | low | medium | high
  political_lean  text NOT NULL,   -- left | centre | right
  bio             text,
  avatar_url      text,
  platforms       jsonb DEFAULT '["twitter","facebook"]',
  platform_handles jsonb DEFAULT '{}',   -- { twitter: "@handle", ... }
  active          boolean NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  usage_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_personas_client_id_idx ON apma_personas(client_id);
CREATE INDEX IF NOT EXISTS apma_personas_active_idx    ON apma_personas(active);
CREATE INDEX IF NOT EXISTS apma_personas_last_used_idx ON apma_personas(last_used_at DESC NULLS LAST);

-- ─── 6. APMA Actions Log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_actions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  strategy_id     uuid REFERENCES political_strategies(id) ON DELETE SET NULL,
  persona_id      uuid REFERENCES apma_personas(id) ON DELETE SET NULL,
  action_type     text NOT NULL,   -- post | comment | reply | dm | blog_create | group_create | share | like
  platform        text NOT NULL,
  content_summary text,
  external_id     text,            -- platform post/comment ID if returned
  url             text,
  metadata        jsonb DEFAULT '{}',
  success         boolean NOT NULL DEFAULT false,
  error           text,
  engagement      jsonb DEFAULT '{}',   -- { likes, shares, comments, reach }
  executed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_actions_campaign_id_idx  ON apma_actions(campaign_id);
CREATE INDEX IF NOT EXISTS apma_actions_client_id_idx    ON apma_actions(client_id);
CREATE INDEX IF NOT EXISTS apma_actions_action_type_idx  ON apma_actions(action_type);
CREATE INDEX IF NOT EXISTS apma_actions_executed_at_idx  ON apma_actions(executed_at DESC);
CREATE INDEX IF NOT EXISTS apma_actions_success_idx      ON apma_actions(success);

-- ─── 7. APMA Blog Sites ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_blog_sites (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  domain          text NOT NULL,
  subdomain       text,
  name            text NOT NULL,
  tagline         text,
  logo_url        text,
  status          text NOT NULL DEFAULT 'creating', -- creating | live | paused | down
  article_count   integer NOT NULL DEFAULT 0,
  monthly_visits  integer NOT NULL DEFAULT 0,
  seo_score       integer DEFAULT 0,
  config          jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_blogs_campaign_id_idx ON apma_blog_sites(campaign_id);
CREATE INDEX IF NOT EXISTS apma_blogs_status_idx      ON apma_blog_sites(status);

-- ─── 8. APMA Blog Articles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_blog_articles (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  blog_id         uuid NOT NULL REFERENCES apma_blog_sites(id) ON DELETE CASCADE,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  title           text NOT NULL,
  slug            text NOT NULL,
  content         text NOT NULL,
  excerpt         text,
  keywords        jsonb DEFAULT '[]',
  seo_title       text,
  seo_description text,
  status          text NOT NULL DEFAULT 'draft',  -- draft | published
  word_count      integer DEFAULT 0,
  views           integer NOT NULL DEFAULT 0,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_articles_blog_id_idx     ON apma_blog_articles(blog_id);
CREATE INDEX IF NOT EXISTS apma_articles_campaign_id_idx ON apma_blog_articles(campaign_id);
CREATE INDEX IF NOT EXISTS apma_articles_status_idx      ON apma_blog_articles(status);

-- ─── 9. APMA Social Groups ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_social_groups (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  platform        text NOT NULL,       -- facebook | telegram | discord | reddit
  external_id     text,               -- platform group/channel ID
  name            text NOT NULL,
  url             text,
  member_count    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active',
  admin_persona_id uuid REFERENCES apma_personas(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_groups_campaign_id_idx ON apma_social_groups(campaign_id);
CREATE INDEX IF NOT EXISTS apma_groups_platform_idx    ON apma_social_groups(platform);

-- ─── 10. APMA Sentiment History (time-series for graphs) ─────────────────────
CREATE TABLE IF NOT EXISTS apma_sentiment_history (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  score           numeric(5,4) NOT NULL,
  sample_size     integer NOT NULL DEFAULT 0,
  dominant_topic  text,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_sentiment_campaign_id_idx  ON apma_sentiment_history(campaign_id);
CREATE INDEX IF NOT EXISTS apma_sentiment_recorded_at_idx  ON apma_sentiment_history(recorded_at DESC);

-- ─── 11. APMA Recommendations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apma_recommendations (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     uuid NOT NULL REFERENCES apma_campaigns(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES apma_clients(id) ON DELETE CASCADE,
  text            text NOT NULL,
  action_type     text NOT NULL,
  priority        text NOT NULL DEFAULT 'medium',   -- low | medium | high | critical
  status          text NOT NULL DEFAULT 'pending',  -- pending | implementing | done | vetoed
  auto_implement  boolean NOT NULL DEFAULT true,
  veto_deadline   timestamptz,
  implemented_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apma_recs_campaign_id_idx ON apma_recommendations(campaign_id);
CREATE INDEX IF NOT EXISTS apma_recs_status_idx      ON apma_recommendations(status);

-- ─── 12. APMA Self-Improvement Logs (Learning Layer) ──────────────────────────
CREATE TABLE IF NOT EXISTS apma_self_improvement_logs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_name      text NOT NULL,
  description     text NOT NULL,
  code_snippet    text,
  test_result     text,
  deployed        boolean NOT NULL DEFAULT false,
  performance_delta numeric(5,4),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── 13. RLS Policies (service role bypass for all APMA tables) ──────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'apma_clients','apma_campaigns','political_conversations',
    'political_strategies','apma_personas','apma_actions',
    'apma_blog_sites','apma_blog_articles','apma_social_groups',
    'apma_sentiment_history','apma_recommendations','apma_self_improvement_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "APMA service bypass" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "APMA service bypass" ON %I USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

SELECT 'APMA migration complete' AS status;
