-- Durable round-robin cursors keep scheduled strategy sweeps progressing
-- across restarts and horizontally scaled Railway workers.
CREATE TABLE IF NOT EXISTS public.scheduler_cursors (
  cursor_name text PRIMARY KEY,
  cursor_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduler_cursors ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS strategies_active_id_cursor_idx
  ON public.strategies (id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS agent_tasks_pending_due_idx
  ON public.agent_tasks (scheduled_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS agent_tasks_pending_content_due_idx
  ON public.agent_tasks (scheduled_at, id)
  WHERE status = 'pending'
    AND task_type IN ('POST', 'URGENCY_POST', 'TEASER', 'HASHTAG_CAMPAIGN');

NOTIFY pgrst, 'reload schema';
