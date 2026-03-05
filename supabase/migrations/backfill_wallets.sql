insert into public.wallets (user_id)
select u.id
from auth.users u
left join public.wallets w on w.user_id = u.id
where w.user_id is null
on conflict (user_id) do nothing;
