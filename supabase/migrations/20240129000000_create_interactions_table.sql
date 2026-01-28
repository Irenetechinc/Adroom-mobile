create table public.interactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  interaction_id text not null, -- Facebook Comment ID or Message ID
  platform text not null, -- 'facebook', 'instagram'
  type text not null, -- 'comment', 'message'
  context_history jsonb default '[]'::jsonb, -- Array of { role: 'user'|'agent', content: string }
  last_interaction_at timestamptz default now(),
  status text default 'active', -- 'active', 'resolved'
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.interactions enable row level security;

create policy "Users can view their own interactions"
  on public.interactions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own interactions"
  on public.interactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own interactions"
  on public.interactions for update
  using (auth.uid() = user_id);
