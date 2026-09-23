-- Outbound safety and personal-message task contract.
-- This migration is additive and safe to run more than once.

alter table if exists public.agent_tasks
  add column if not exists action_type text,
  add column if not exists selected_account_id text,
  add column if not exists recipient_id text,
  add column if not exists conversation_id text,
  add column if not exists media jsonb;

create table if not exists public.social_action_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  action_type text not null default 'send_personal_message',
  recipient_hash text,
  status text not null check (status in ('reserved', 'success', 'failure')),
  error_code text,
  safe_error text,
  created_at timestamptz not null default now()
);

create index if not exists social_action_log_user_provider_created_idx
  on public.social_action_log (user_id, provider, created_at desc);

alter table public.social_action_log enable row level security;

-- The backend uses the service role for this table. No client policy is
-- intentionally created because action/error metadata is not user-facing.

create or replace function public.reserve_social_action(
  p_user_id uuid,
  p_provider text,
  p_recipient_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.social_account_connections%rowtype;
  today date := current_date;
  account_count integer;
  recipient_count integer;
  recipient_limit integer;
  effective_limit integer;
  warmup_days integer;
  next_recipients jsonb;
begin
  select *
    into current_row
    from public.social_account_connections
   where user_id = p_user_id
     and provider = p_provider
   for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'account_not_connected');
  end if;

  if current_row.status <> 'connected'
     or (current_row.cooldown_until is not null and current_row.cooldown_until > now()) then
    return jsonb_build_object('allowed', false, 'reason', 'account_not_ready');
  end if;

  account_count := case when current_row.action_day = today
    then coalesce(current_row.actions_today, 0) else 0 end;
  effective_limit := greatest(1, coalesce(current_row.daily_limit, 20));

  if current_row.warmup_started_at is not null then
    warmup_days := greatest(0, floor(extract(epoch from (now() - current_row.warmup_started_at)) / 86400));
    effective_limit := least(effective_limit, case
      when warmup_days < 1 then 3
      when warmup_days < 3 then 8
      when warmup_days < 7 then 15
      else effective_limit
    end);
  end if;

  if account_count >= effective_limit then
    return jsonb_build_object('allowed', false, 'reason', 'account_daily_limit');
  end if;

  next_recipients := case
    when current_row.recipient_action_day = today
      and jsonb_typeof(current_row.recipient_actions) = 'object'
      then coalesce(current_row.recipient_actions, '{}'::jsonb)
    else '{}'::jsonb
  end;

  if p_recipient_hash is not null then
    recipient_count := coalesce((next_recipients ->> p_recipient_hash)::integer, 0);
    recipient_limit := greatest(1, least(5, floor(effective_limit / 4)));
    if recipient_count >= recipient_limit then
      return jsonb_build_object('allowed', false, 'reason', 'recipient_daily_limit');
    end if;
    next_recipients := jsonb_set(next_recipients, array[p_recipient_hash], to_jsonb(recipient_count + 1), true);
  end if;

  update public.social_account_connections
     set action_day = today,
         actions_today = account_count + 1,
         recipient_action_day = today,
         recipient_actions = next_recipients,
         last_action_at = now(),
         updated_at = now()
   where id = current_row.id;

  insert into public.social_action_log (user_id, provider, recipient_hash, status)
  values (p_user_id, p_provider, p_recipient_hash, 'reserved');

  return jsonb_build_object('allowed', true, 'reason', 'reserved');
end;
$$;

revoke all on function public.reserve_social_action(uuid, text, text) from public;
grant execute on function public.reserve_social_action(uuid, text, text) to service_role;