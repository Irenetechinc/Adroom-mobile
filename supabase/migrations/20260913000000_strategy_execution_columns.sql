-- Keep strategy persistence compatible with the AI generation and execution contracts.
-- These columns are additive and preserve existing strategy rows.
alter table public.strategies
  add column if not exists goal text,
  add column if not exists rationale text,
  add column if not exists content_pillars jsonb default '[]'::jsonb,
  add column if not exists schedule jsonb default '[]'::jsonb,
  add column if not exists estimated_outcomes jsonb default '{}'::jsonb,
  add column if not exists status text default 'generated',
  add column if not exists selected_accounts jsonb default '[]'::jsonb,
  add column if not exists product_type text,
  add column if not exists dispatch_address text;

create index if not exists strategies_user_active_updated_idx
  on public.strategies (user_id, is_active, updated_at desc);

alter table public.strategies replica identity full;
