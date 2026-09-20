alter table public.product_memory
  add column if not exists latest_refinement_asset_uri text,
  add column if not exists latest_refinement_note text;

alter table public.agent_interventions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists intervention_type text,
  add column if not exists status text default 'pending',
  add column if not exists context jsonb default '{}'::jsonb,
  add column if not exists resolved_at timestamptz;

create index if not exists agent_interventions_pending_user_idx
  on public.agent_interventions (user_id, status, intervention_type);