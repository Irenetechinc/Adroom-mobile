alter table public.critic_agent_logs
  add column if not exists blocked boolean not null default false,
  add column if not exists retry_count integer not null default 0;

alter table public.agent_skills
  add column if not exists lifecycle_status text not null default 'candidate',
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists version integer not null default 1,
  add column if not exists previous_version_id uuid,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists agent_skills_lifecycle_idx
  on public.agent_skills (agent_type, lifecycle_status, updated_at);