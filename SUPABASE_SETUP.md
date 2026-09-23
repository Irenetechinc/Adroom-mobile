# Supabase setup checklist

The backend uses Supabase PostgreSQL and the Supabase service role from Railway.
These migrations are not applied automatically by the mobile app.

## Apply in the Supabase SQL editor

Run the existing project migrations first, then run these additive migrations:

1. `backend/feature_flags_migration.sql`
2. `supabase/migrations/20260924010000_outbound_safety_task_contract.sql`
3. `supabase/migrations/20260924011000_creative_freshness_metadata.sql`
4. The existing inbound-message, social-account safety, push-project, token-refresh,
   feature-strategy-logistics, lead-message, and conversation migrations listed in
   `replit.md`.

Run each file as a complete statement batch. The files use `IF NOT EXISTS` or
`ON CONFLICT` where practical and do not delete existing rows. The outbound
reservation function is intentionally fail-closed until the migration has been
applied; this prevents concurrent workers from bypassing account or recipient
limits.

## Verify after applying

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'reserve_social_action';

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'agent_tasks'
  and column_name in ('action_type', 'selected_account_id', 'recipient_id', 'conversation_id', 'media');
```

Enable Supabase Realtime for the tables already used by the mobile screens:
`agent_tasks`, `agent_leads`, `lead_dm_messages`, `strategies`,
`strategy_conversation_runs`, `strategy_conversation_signals`, and `agent_deals`.
Do not expose credential, session, or action-log tables to the client.