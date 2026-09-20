-- Adds the missing `status` column to public.strategies that backend services
-- (scheduler, goalOptimization, server.ts strategy endpoints) already query.
--
-- The `is_active` boolean is retained as the canonical "actively running" flag,
-- but `status` provides finer-grained lifecycle states (active / paused / etc.)
-- needed for pause/resume endpoints and scheduler activity checks.

ALTER TABLE public.strategies
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Backfill: any existing rows that are currently active should be marked 'active',
-- everything else defaults to 'inactive' so they don't show up in active queries.
UPDATE public.strategies
SET status = CASE
    WHEN is_active IS TRUE THEN 'active'
    ELSE 'inactive'
END
WHERE status = 'active' AND is_active IS NOT TRUE;

-- Helpful index for the very common (user_id, is_active, status) lookup pattern.
CREATE INDEX IF NOT EXISTS idx_strategies_user_active_status
    ON public.strategies (user_id, is_active, status);
