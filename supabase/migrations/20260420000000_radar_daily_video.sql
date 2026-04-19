-- ─── Radar Intelligence Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.radar_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id TEXT NOT NULL,
  competitor_mentions TEXT[] DEFAULT '{}',
  trending_topics TEXT[] DEFAULT '{}',
  sentiment_score FLOAT DEFAULT 0.5,
  opportunities TEXT[] DEFAULT '{}',
  threats TEXT[] DEFAULT '{}',
  local_insights TEXT[] DEFAULT '{}',
  recommended_actions TEXT[] DEFAULT '{}',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_radar_intel_user_id ON public.radar_intel(user_id);
CREATE INDEX IF NOT EXISTS idx_radar_intel_strategy_id ON public.radar_intel(strategy_id);
CREATE INDEX IF NOT EXISTS idx_radar_intel_scanned_at ON public.radar_intel(scanned_at DESC);

-- ─── Strategy Daily Reports Table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strategy_daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id TEXT NOT NULL,
  report_date DATE NOT NULL,
  headline TEXT,
  performance_score INT DEFAULT 0,
  highlights TEXT[] DEFAULT '{}',
  insights TEXT[] DEFAULT '{}',
  next_actions TEXT[] DEFAULT '{}',
  tasks_completed INT DEFAULT 0,
  tasks_failed INT DEFAULT 0,
  impressions_today INT DEFAULT 0,
  clicks_today INT DEFAULT 0,
  conversions_today INT DEFAULT 0,
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(strategy_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_user_id ON public.strategy_daily_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_strategy_id ON public.strategy_daily_reports(strategy_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON public.strategy_daily_reports(report_date DESC);

-- ─── Video Edit Jobs Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_edit_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id TEXT,
  source_video_uri TEXT,
  edit_plan JSONB DEFAULT '{}',
  script_text TEXT,
  estimated_duration INT DEFAULT 30,
  platform_optimizations TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'plan_ready',
  output_video_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_edit_jobs_user_id ON public.video_edit_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_edit_jobs_strategy_id ON public.video_edit_jobs(strategy_id);
