
-- Create Wallets Table
create table if not exists public.wallets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  balance decimal(12, 2) default 0.00 not null,
  currency text default 'NGN' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create Transactions Table
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  wallet_id uuid references public.wallets(id) on delete cascade not null,
  type text check (type in ('DEPOSIT', 'DEDUCTION', 'REFUND')) not null,
  amount decimal(12, 2) not null,
  fee decimal(12, 2) default 0.00,
  reference text unique not null,
  status text check (status in ('PENDING', 'SUCCESS', 'FAILED')) default 'PENDING' not null,
  description text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;

create policy "Users can view their own wallet"
  on public.wallets for select
  using (auth.uid() = user_id);

create policy "Users can view their own transactions"
  on public.transactions for select
  using (wallet_id in (select id from public.wallets where user_id = auth.uid()));

-- Function to handle new user wallet creation
create or replace function public.handle_new_user_wallet()
returns trigger as $$
begin
  insert into public.wallets (user_id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user
drop trigger if exists on_auth_user_created_wallet on auth.users;
create trigger on_auth_user_created_wallet
  after insert on auth.users
  for each row execute procedure public.handle_new_user_wallet();
