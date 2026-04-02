create table if not exists public.intelligence_sources (
  id uuid default gen_random_uuid() primary key,
  platform text not null,
  name text not null,
  url text not null,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists intelligence_sources_url_key on public.intelligence_sources(url);

alter table public.intelligence_sources enable row level security;

create policy "Authenticated can read intelligence sources"
  on public.intelligence_sources for select
  to authenticated
  using (true);

create table if not exists public.system_logs (
  id uuid default gen_random_uuid() primary key,
  level text not null,
  module text not null,
  message text not null,
  details jsonb,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.system_logs enable row level security;

create policy "Users can view their own system logs"
  on public.system_logs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own system logs"
  on public.system_logs for insert
  with check (auth.uid() = user_id);

insert into public.intelligence_sources (platform, name, url, is_active)
values
  ('facebook', 'Meta Newsroom', 'https://about.fb.com/news/', true),
  ('instagram', 'Instagram Blog', 'https://about.instagram.com/blog', true),
  ('linkedin', 'LinkedIn News', 'https://news.linkedin.com/', true),
  ('x', 'X Developer Blog', 'https://developer.x.com/en/blog', true)
on conflict (url) do nothing;

notify pgrst, 'reload schema';
