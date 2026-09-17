alter table public.agent_skills
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists lifecycle_status text not null default 'candidate',
  add column if not exists version integer not null default 1,
  add column if not exists previous_version_id uuid,
  add column if not exists updated_at timestamptz not null default now();