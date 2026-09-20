DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_tasks_agent_type_check'
      AND conrelid = 'public.agent_tasks'::regclass
  ) THEN
    ALTER TABLE public.agent_tasks DROP CONSTRAINT agent_tasks_agent_type_check;
  END IF;

  ALTER TABLE public.agent_tasks
    ADD CONSTRAINT agent_tasks_agent_type_check
    CHECK (agent_type IN ('SALESMAN', 'AWARENESS', 'PROMOTION', 'LAUNCH', 'PRODUCT_MANAGER'));
END $$;