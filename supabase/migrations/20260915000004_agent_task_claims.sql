alter table public.agent_tasks
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

create index if not exists agent_tasks_claimed_idx
  on public.agent_tasks (status, claimed_at);