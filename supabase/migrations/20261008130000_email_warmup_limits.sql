-- Email-specific warm-up and per-recipient caps. Other channels keep the
-- existing reserve_social_action behavior unchanged.
create table if not exists public.email_domain_daily_usage (
  sender_domain text not null,
  usage_day date not null,
  send_count integer not null default 0 check (send_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (sender_domain, usage_day)
);

alter table public.email_domain_daily_usage enable row level security;
revoke all on table public.email_domain_daily_usage from public, anon, authenticated;
grant all on table public.email_domain_daily_usage to service_role;

create index if not exists social_email_domain_warmup_idx
  on public.social_account_connections (lower(split_part(account_id, '@', 2)), warmup_started_at)
  where provider = 'email' and status = 'connected';

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
  sender_domain text;
  domain_days integer;
  domain_mailboxes integer;
  domain_limit integer;
  domain_send_count integer;
  public_mail_provider_domain boolean;
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
    if p_provider = 'email' then
      effective_limit := least(effective_limit, case
        when warmup_days < 7 then 5
        when warmup_days < 14 then 10
        when warmup_days < 21 then 15
        when warmup_days < 28 then 20
        when warmup_days < 35 then 25
        when warmup_days < 42 then 35
        else 45
      end);
    else
      effective_limit := least(effective_limit, case
        when warmup_days < 1 then 3
        when warmup_days < 3 then 8
        when warmup_days < 7 then 15
        else effective_limit
      end);
    end if;
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
    recipient_limit := case
      when p_provider = 'email' then 1
      else greatest(1, least(5, floor(effective_limit / 4)))
    end;
    if recipient_count >= recipient_limit then
      return jsonb_build_object('allowed', false, 'reason', 'recipient_daily_limit');
    end if;
    next_recipients := jsonb_set(next_recipients, array[p_recipient_hash], to_jsonb(recipient_count + 1), true);
  end if;

  if p_provider = 'email' then
    sender_domain := lower(split_part(coalesce(current_row.account_id, ''), '@', 2));
    if sender_domain = '' then
      return jsonb_build_object('allowed', false, 'reason', 'email_sender_domain_missing');
    end if;

    public_mail_provider_domain := sender_domain = any(array[
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
      'msn.com', 'office365.com', 'yahoo.com', 'icloud.com', 'me.com', 'mac.com',
      'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'fastmail.com',
      'fastmail.fm', 'gmx.com', 'gmx.net', 'gmx.de', 'zoho.com', 'zoho.eu'
    ]);

    if public_mail_provider_domain then
      insert into public.email_domain_daily_usage (sender_domain, usage_day, send_count)
      values (sender_domain, today, 1)
      on conflict (sender_domain, usage_day) do update
        set send_count = public.email_domain_daily_usage.send_count + 1,
            updated_at = now();
    else
      select count(*),
             greatest(0, floor(extract(epoch from (now() - min(warmup_started_at))) / 86400))::integer
        into domain_mailboxes, domain_days
        from public.social_account_connections
       where provider = 'email'
         and status = 'connected'
         and lower(split_part(account_id, '@', 2)) = sender_domain;

      domain_limit := least(6, greatest(1, coalesce(domain_mailboxes, 1))) * case
        when coalesce(domain_days, 0) < 7 then 5
        when domain_days < 14 then 10
        when domain_days < 21 then 15
        when domain_days < 28 then 20
        when domain_days < 35 then 25
        when domain_days < 42 then 35
        else 45
      end;

      insert into public.email_domain_daily_usage (sender_domain, usage_day, send_count)
      values (sender_domain, today, 1)
      on conflict (sender_domain, usage_day) do update
        set send_count = public.email_domain_daily_usage.send_count + 1,
            updated_at = now()
        where public.email_domain_daily_usage.send_count < domain_limit
      returning send_count into domain_send_count;

      if domain_send_count is null then
        return jsonb_build_object('allowed', false, 'reason', 'email_domain_daily_limit');
      end if;
    end if;
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
