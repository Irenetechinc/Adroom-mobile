alter table public.strategies
  add column if not exists duration_days integer,
  add column if not exists ends_at timestamptz;

create index if not exists strategies_active_expiry_idx
  on public.strategies (is_active, ends_at);