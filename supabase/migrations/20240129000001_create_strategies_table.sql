create table public.strategies (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  type text not null, -- 'FREE', 'PAID'
  title text not null,
  description text,
  target_audience text,
  brand_voice text,
  lifespan_weeks int,
  key_message text,
  platforms jsonb,
  estimated_reach text,
  cost text,
  actions jsonb, -- Array of strings
  assets jsonb, -- Array of CreativeAsset objects
  is_active boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table public.strategies enable row level security;

create policy "Users can view their own strategies"
  on public.strategies for select
  using (auth.uid() = user_id);

create policy "Users can insert their own strategies"
  on public.strategies for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own strategies"
  on public.strategies for update
  using (auth.uid() = user_id);
