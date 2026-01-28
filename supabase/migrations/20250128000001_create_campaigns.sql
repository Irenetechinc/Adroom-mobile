create table if not exists public.campaigns (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  facebook_campaign_id text not null,
  name text not null,
  objective text not null,
  status text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.campaigns enable row level security;

create policy "Users can view their own campaigns"
  on public.campaigns for select
  using (auth.uid() = user_id);

create policy "Users can insert their own campaigns"
  on public.campaigns for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own campaigns"
  on public.campaigns for update
  using (auth.uid() = user_id);

create policy "Users can delete their own campaigns"
  on public.campaigns for delete
  using (auth.uid() = user_id);
