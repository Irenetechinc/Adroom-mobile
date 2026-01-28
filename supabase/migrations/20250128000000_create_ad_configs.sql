create table if not exists public.ad_configs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ad_account_id text not null,
  access_token text not null,
  page_id text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id)
);

alter table public.ad_configs enable row level security;

create policy "Users can view their own ad config"
  on public.ad_configs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own ad config"
  on public.ad_configs for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own ad config"
  on public.ad_configs for update
  using (auth.uid() = user_id);

create policy "Users can delete their own ad config"
  on public.ad_configs for delete
  using (auth.uid() = user_id);
