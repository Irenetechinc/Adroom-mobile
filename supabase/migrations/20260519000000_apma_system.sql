-- APMA: Autonomous Political Marketing Agent
-- Run in Supabase SQL editor

-- ── Political client profiles ─────────────────────────────────────────────────
create table if not exists political_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  client_type text not null, -- 'gubernatorial','presidential','senate','house_of_assembly','local_gov','public_perception'
  campaign_subtype text,     -- 'presidential','senate','house_of_assembly','local_gov_chairman' OR 'offensive','defensive'
  campaign_goal text not null, -- 'shift_positive','shift_negative','defend_positive','attack_rival'
  target_keywords text[] default '{}',
  rivals text[] default '{}',
  campaign_duration_months int not null default 6, -- 6,12,18,24
  start_date timestamptz default now(),
  end_date timestamptz,
  status text not null default 'active', -- 'active','paused','completed'
  narrative_baseline float default 0,    -- initial sentiment score (-1 to +1)
  narrative_current float default 0,
  onboarding_complete boolean default false,
  raw_intake jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists political_clients_user_idx on political_clients(user_id);

-- ── Real-time social perception data ─────────────────────────────────────────
create table if not exists political_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references political_clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  source text not null, -- 'twitter','facebook','reddit','nairaland','newsapi','google_trends','youtube','telegram'
  source_id text,       -- platform-native post/comment id
  text text not null,
  sentiment float,      -- -1 to +1
  emotions jsonb default '{}', -- {anger,joy,fear,trust,anticipation,...}
  topic text,           -- clustered narrative: 'corruption','economy','security','infrastructure',...
  intent text,          -- 'support','oppose','neutral','amplify','attack'
  url text,
  author_handle text,
  engagement_score int default 0, -- likes+shares+comments
  processed boolean default false,
  created_at timestamptz default now()
);
create index if not exists political_conv_client_idx on political_conversations(client_id);
create index if not exists political_conv_source_idx on political_conversations(source, created_at desc);
create index if not exists political_conv_topic_idx on political_conversations(topic, sentiment);

-- ── APMA daily strategic plans ────────────────────────────────────────────────
create table if not exists political_strategies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references political_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null default current_date,
  sentiment_snapshot float,
  top_narratives jsonb default '[]',
  actions jsonb not null default '[]', -- [{type,target_narrative,platform,priority,status}]
  predictions jsonb default '{}',      -- {7_day,30_day,90_day}
  narrative_score_before float,
  narrative_score_after float,
  executed boolean default false,
  created_at timestamptz default now()
);
create index if not exists political_strat_client_idx on political_strategies(client_id, plan_date desc);

-- ── Persona library (humanizer) ───────────────────────────────────────────────
create table if not exists apma_personas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references political_clients(id) on delete cascade,
  name text not null,
  age int,
  gender text,
  location text,
  occupation text,
  writing_style text, -- 'formal','casual','pidgin','academic'
  emoji_usage text,   -- 'heavy','moderate','none'
  local_slang text[] default '{}',
  typo_rate float default 0.03, -- 0-1 probability of intentional typo
  platform_affinities text[] default '{}',
  avatar_url text,
  active boolean default true,
  last_used_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists apma_personas_client_idx on apma_personas(client_id, active);

-- ── Blog registry ─────────────────────────────────────────────────────────────
create table if not exists apma_blogs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references political_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  domain_name text,
  subdomain text, -- client-name.adroomai.com
  logo_url text,
  title text not null,
  description text,
  articles_count int default 0,
  status text default 'draft', -- 'draft','live','archived'
  last_published_at timestamptz,
  seo_metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists apma_blog_articles (
  id uuid primary key default gen_random_uuid(),
  blog_id uuid not null references apma_blogs(id) on delete cascade,
  title text not null,
  slug text,
  content text,
  word_count int,
  seo_keywords text[] default '{}',
  citations jsonb default '[]',
  status text default 'draft',
  published_at timestamptz,
  created_at timestamptz default now()
);

-- ── APMA action log (cycle monitor feed) ─────────────────────────────────────
create table if not exists apma_cycle_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references political_clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  phase text not null, -- 'perception','decision','action','learning','humanizer'
  step text not null,  -- e.g. 'fetch_twitter','cluster_narratives','generate_plan','post_comment'
  status text not null default 'running', -- 'running','success','error','skipped'
  detail jsonb default '{}',
  duration_ms int,
  error_message text,
  created_at timestamptz default now()
);
create index if not exists apma_cycle_log_client_idx on apma_cycle_log(client_id, created_at desc);
create index if not exists apma_cycle_log_created_idx on apma_cycle_log(created_at desc);

-- ── Self-improvement skill registry ──────────────────────────────────────────
create table if not exists apma_skills (
  id uuid primary key default gen_random_uuid(),
  skill_name text not null unique,
  description text,
  code text,           -- the actual JS/TS module code
  version int default 1,
  status text default 'active', -- 'active','testing','deprecated'
  performance_score float,
  created_by text default 'system', -- 'system' or 'self_improvement'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists apma_self_improvement_log (
  id uuid primary key default gen_random_uuid(),
  skill_name text,
  hypothesis text,
  code_written text,
  test_result text,
  success boolean,
  performance_delta float,
  created_at timestamptz default now()
);

-- ── Social groups managed by APMA ────────────────────────────────────────────
create table if not exists apma_social_groups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references political_clients(id) on delete cascade,
  platform text not null, -- 'facebook','telegram','discord','reddit','whatsapp'
  platform_group_id text,
  name text not null,
  description text,
  member_count int default 0,
  status text default 'active',
  last_posted_at timestamptz,
  created_at timestamptz default now()
);

-- ── RLS policies ──────────────────────────────────────────────────────────────
alter table political_clients enable row level security;
alter table political_conversations enable row level security;
alter table political_strategies enable row level security;
alter table apma_personas enable row level security;
alter table apma_blogs enable row level security;
alter table apma_blog_articles enable row level security;
alter table apma_cycle_log enable row level security;
alter table apma_skills enable row level security;
alter table apma_self_improvement_log enable row level security;
alter table apma_social_groups enable row level security;

-- Users see only their own data
create policy "own_political_clients" on political_clients for all using (auth.uid() = user_id);
create policy "own_political_conv" on political_conversations for all using (auth.uid() = user_id);
create policy "own_political_strat" on political_strategies for all using (auth.uid() = user_id);
create policy "own_apma_personas" on apma_personas for all using (
  client_id in (select id from political_clients where user_id = auth.uid())
);
create policy "own_apma_blogs" on apma_blogs for all using (auth.uid() = user_id);
create policy "own_apma_blog_articles" on apma_blog_articles for all using (
  blog_id in (select id from apma_blogs where user_id = auth.uid())
);
create policy "own_apma_cycle_log" on apma_cycle_log for all using (auth.uid() = user_id);
create policy "own_apma_skills" on apma_skills for select using (true);
create policy "own_apma_self_improvement" on apma_self_improvement_log for all using (true);
create policy "own_apma_social_groups" on apma_social_groups for all using (
  client_id in (select id from political_clients where user_id = auth.uid())
);
