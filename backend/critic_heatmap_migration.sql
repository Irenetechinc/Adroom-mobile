-- Critic Agent Heatmap Migration
-- Adds platform column to critic_agent_logs for agent×platform heatmap
-- Run in Supabase SQL Editor

ALTER TABLE public.critic_agent_logs
  ADD COLUMN IF NOT EXISTS platform TEXT;

-- Index for fast heatmap queries (7-day window per agent×platform)
CREATE INDEX IF NOT EXISTS idx_critic_logs_heatmap
  ON public.critic_agent_logs (agent_type, platform, created_at DESC)
  WHERE platform IS NOT NULL;

-- Index for user-level queries from mobile app
CREATE INDEX IF NOT EXISTS idx_critic_logs_user_created
  ON public.critic_agent_logs (user_id, created_at DESC);
