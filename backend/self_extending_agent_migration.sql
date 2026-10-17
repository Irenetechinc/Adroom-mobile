-- Self-extending agent runtime: dynamic sub-agent runs, safe composed tools,
-- execution/audit history, and realtime user milestones.

create table if not exists public.agent_subagent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_run_id uuid references public.agent_subagent_runs(id) on delete set null,
  root_run_id uuid references public.agent_subagent_runs(id) on delete set null,
  origin_type text not null default 'agent_work',
  origin_id text,
  strategy_id uuid references public.strategies(id) on delete set null,
  agent_type text not null,
  task_name text not null,
  task text not null default '',
  purpose text not null,
  scope text not null,
  constraints text[] not null default '{}',
  completion_criteria text not null,
  inherited_context jsonb not null default '{}',
  ancestry_fingerprints text[] not null default '{}',
  request_fingerprint text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'terminated')),
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  heartbeat_at timestamptz,
  result jsonb,
  error_message text,
  termination_reason text,
  credits_charged numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrade an earlier partial installation that did not persist the actual task.
alter table public.agent_subagent_runs
  add column if not exists task text not null default '';
update public.agent_subagent_runs
set task = purpose
where task is null or btrim(task) = '';

create index if not exists agent_subagent_runs_due_idx
  on public.agent_subagent_runs (status, scheduled_at, created_at);
create index if not exists agent_subagent_runs_tree_idx
  on public.agent_subagent_runs (user_id, root_run_id, created_at);
create index if not exists agent_subagent_runs_parent_idx
  on public.agent_subagent_runs (parent_run_id, created_at);
create index if not exists agent_subagent_runs_fingerprint_idx
  on public.agent_subagent_runs (user_id, request_fingerprint);

create table if not exists public.agent_dynamic_tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_agent_type text not null,
  tool_name text not null,
  purpose text not null,
  input_schema jsonb not null,
  output_schema jsonb not null,
  implementation jsonb not null,
  dependency_names text[] not null default '{}',
  granted_to_agent_types text[] not null default '{}',
  version integer not null default 1 check (version > 0),
  previous_version_id uuid references public.agent_dynamic_tools(id) on delete set null,
  signature text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'superseded', 'rejected')),
  test_results jsonb not null default '[]',
  use_count bigint not null default 0,
  last_used_at timestamptz,
  created_by_run_id uuid references public.agent_subagent_runs(id) on delete set null,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, owner_agent_type, tool_name, version)
);

create index if not exists agent_dynamic_tools_lookup_idx
  on public.agent_dynamic_tools (user_id, owner_agent_type, status, tool_name);
create index if not exists agent_dynamic_tools_signature_idx
  on public.agent_dynamic_tools (user_id, signature);

create table if not exists public.agent_dynamic_tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id uuid not null references public.agent_dynamic_tools(id) on delete cascade,
  tool_version integer not null,
  agent_type text not null,
  subagent_run_id uuid references public.agent_subagent_runs(id) on delete set null,
  status text not null check (status in ('succeeded', 'failed', 'blocked')),
  input_hash text not null,
  output jsonb,
  error_message text,
  credits_charged numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists agent_dynamic_tool_runs_tool_idx
  on public.agent_dynamic_tool_runs (tool_id, created_at desc);
create index if not exists agent_dynamic_tool_runs_user_idx
  on public.agent_dynamic_tool_runs (user_id, created_at desc);

create table if not exists public.agent_extension_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  actor_agent_type text,
  event_type text not null,
  subagent_run_id uuid references public.agent_subagent_runs(id) on delete set null,
  tool_id uuid references public.agent_dynamic_tools(id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists agent_extension_audit_log_created_idx
  on public.agent_extension_audit_log (created_at desc);
create index if not exists agent_extension_audit_log_user_idx
  on public.agent_extension_audit_log (user_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and to_regclass('public.user_notifications') is not null
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'user_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.user_notifications';
  end if;
end
$$;

alter table public.agent_subagent_runs enable row level security;
alter table public.agent_dynamic_tools enable row level security;
alter table public.agent_dynamic_tool_runs enable row level security;
alter table public.agent_extension_audit_log enable row level security;

drop policy if exists service_role_all_agent_subagent_runs on public.agent_subagent_runs;
create policy service_role_all_agent_subagent_runs on public.agent_subagent_runs
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_agent_dynamic_tools on public.agent_dynamic_tools;
create policy service_role_all_agent_dynamic_tools on public.agent_dynamic_tools
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_agent_dynamic_tool_runs on public.agent_dynamic_tool_runs;
create policy service_role_all_agent_dynamic_tool_runs on public.agent_dynamic_tool_runs
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all_agent_extension_audit_log on public.agent_extension_audit_log;
create policy service_role_all_agent_extension_audit_log on public.agent_extension_audit_log
  for all to service_role using (true) with check (true);
