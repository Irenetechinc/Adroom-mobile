create table if not exists public.ad_sets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  campaign_id uuid references public.campaigns(id) on delete cascade not null,
  facebook_ad_set_id text not null,
  name text not null,
  daily_budget integer not null,
  billing_event text not null,
  optimization_goal text not null,
  status text not null,
  start_time timestamp with time zone not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.ad_sets enable row level security;

create policy "Users can view their own ad sets"
  on public.ad_sets for select
  using (auth.uid() = user_id);

create policy "Users can insert their own ad sets"
  on public.ad_sets for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own ad sets"
  on public.ad_sets for update
  using (auth.uid() = user_id);

create policy "Users can delete their own ad sets"
  on public.ad_sets for delete
  using (auth.uid() = user_id);
