create table if not exists public.scheduler_locks (
  lock_name text primary key,
  owner_id uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists scheduler_locks_expiry_idx
  on public.scheduler_locks (expires_at);