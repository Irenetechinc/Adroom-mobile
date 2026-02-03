
-- Create a table for user preferences/profile tracking
create table if not exists public.user_profiles (
  id uuid references auth.users not null primary key,
  full_name text,
  preferences jsonb default '{}'::jsonb,
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create a table for tracking generated creative assets
create table if not exists public.creative_assets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  strategy_id text, -- link to local strategy ID or future strategy table
  type text not null, -- 'IMAGE', 'VIDEO', 'COPY'
  url text,
  content text, -- for copy
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.user_profiles enable row level security;
alter table public.creative_assets enable row level security;

-- Policies
create policy "Users can view own profile" on public.user_profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on public.user_profiles
  for update using (auth.uid() = id);

create policy "Users can insert own profile" on public.user_profiles
  for insert with check (auth.uid() = id);

create policy "Users can view own assets" on public.creative_assets
  for select using (auth.uid() = user_id);

create policy "Users can insert own assets" on public.creative_assets
  for insert with check (auth.uid() = user_id);
