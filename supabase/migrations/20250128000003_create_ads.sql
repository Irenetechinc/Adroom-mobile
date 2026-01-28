create table if not exists public.ads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ad_set_id uuid references public.ad_sets(id) on delete cascade not null,
  facebook_ad_id text not null,
  name text not null,
  status text not null,
  creative_id text,
  preview_shareable_link text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.ads enable row level security;

create policy "Users can view their own ads"
  on public.ads for select
  using (auth.uid() = user_id);

create policy "Users can insert their own ads"
  on public.ads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own ads"
  on public.ads for update
  using (auth.uid() = user_id);

create policy "Users can delete their own ads"
  on public.ads for delete
  using (auth.uid() = user_id);
