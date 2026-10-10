import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL || (() => {
  const url = String(process.env.SUPABASE_URL || '');
  const password = String(process.env.SUPABASE_DB_PASSWORD || '');
  if (!url || !password) return '';
  const ref = url.replace(/^https?:\/\//, '').split('.')[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
})();

const requiredTables = [
  'feature_flags',
  'user_feature_overrides',
  'social_account_connections',
  'social_action_log',
  'email_oauth_states',
  'personal_inbound_messages',
  'device_push_tokens',
  'agent_tasks',
  'agent_leads',
  'lead_dm_messages',
  'strategies',
  'strategy_conversation_runs',
  'strategy_conversation_signals',
  'agent_deals',
  'call_logs',
  'call_campaigns',
  'call_campaign_contacts',
  'call_suppressions',
  'call_credit_charges',
  'shipments',
  'user_phone_numbers',
  'outreach_preferences',
  'lead_profile_builder_runs',
  'lead_sales_profiles',
  'scheduler_cursors',
  'cloudflare_ai_provider_settings',
  'cloudflare_ai_daily_usage',
];

const requiredColumns: Record<string, string[]> = {
  cloudflare_ai_provider_settings: ['id', 'free_mode_enabled', 'universal_free_mode_enabled', 'updated_at'],
  cloudflare_ai_daily_usage: [
    'usage_date', 'account_type', 'neurons_used', 'call_count', 'is_exhausted',
    'health_status', 'last_status_code', 'last_error', 'updated_at',
  ],
  social_account_connections: [
    'provider', 'status', 'credential_ciphertext', 'credential_iv', 'credential_tag',
    'warmup_started_at', 'consecutive_errors', 'cooldown_until',
    'recipient_action_day', 'recipient_actions', 'last_inbound_at',
  ],
  social_action_log: ['user_id', 'provider', 'action_type', 'status', 'recipient_hash', 'created_at'],
  agent_leads: [
    'phone', 'phone_number', 'contact_phone', 'contact_timezone', 'call_consent',
    'call_consent_at', 'call_consent_source',
  ],
  call_logs: [
    'user_id', 'lead_id', 'status', 'consent_confirmed', 'summary',
    'campaign_id', 'campaign_contact_id', 'credits_charged', 'credits_debited', 'outcome',
  ],
  call_campaigns: [
    'user_id', 'strategy_id', 'name', 'goal', 'product_name', 'product_description',
    'default_timezone', 'calling_start_hour', 'calling_end_hour', 'daily_limit',
    'max_attempts', 'status', 'generated_strategy',
  ],
  call_campaign_contacts: [
    'user_id', 'campaign_id', 'lead_id', 'phone_e164', 'time_zone',
    'call_consent', 'consent_confirmed', 'status', 'attempt_count',
    'next_attempt_at', 'last_call_id', 'last_finalized_call_id',
  ],
  call_suppressions: ['user_id', 'phone_e164', 'source'],
  call_credit_charges: ['call_id', 'user_id', 'credits', 'balance_after', 'charged_at'],
  shipments: ['user_id', 'product_type', 'pickup_address', 'delivery_address', 'status', 'pickup_details', 'tracking_events'],
  user_phone_numbers: ['user_id', 'phone_number', 'provider', 'provider_sid', 'status'],
  personal_inbound_messages: ['user_id', 'provider', 'external_id', 'sender_id', 'message', 'message_timestamp'],
  lead_profile_builder_runs: ['active_tool', 'active_platform', 'active_tool_status', 'active_tool_error'],
  device_push_tokens: ['user_id', 'token', 'project_id', 'is_active'],
  agent_tasks: ['action_type', 'selected_account_id', 'recipient_id', 'conversation_id', 'media'],
  scheduler_cursors: ['cursor_name', 'cursor_value', 'updated_at'],
  email_oauth_states: ['state', 'user_id', 'email', 'expires_at'],
};

async function main(): Promise<void> {
  if (!connectionString) throw new Error('SUPABASE_DB_URL or SUPABASE_URL plus SUPABASE_DB_PASSWORD is required');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [requiredTables],
    );
    const foundTables = new Set(tables.rows.map((row: { table_name: string }) => row.table_name));
    const missingTables = requiredTables.filter((table) => !foundTables.has(table));

    const columns = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [Object.keys(requiredColumns)],
    );
    const foundColumns = new Set(columns.rows.map((row: { table_name: string; column_name: string }) => `${row.table_name}.${row.column_name}`));
    const missingColumns = Object.entries(requiredColumns).flatMap(([table, names]) =>
      names.filter((name) => !foundColumns.has(`${table}.${name}`)).map((name) => `${table}.${name}`),
    );

    const requiredFunctions = ['reserve_social_action', 'record_cloudflare_ai_usage', 'charge_call_credits'];
    const functionResult = await pool.query(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = 'public' AND routine_name = ANY($1)`,
      [requiredFunctions],
    );
    const foundFunctions = new Set(functionResult.rows.map((row: { routine_name: string }) => row.routine_name));
    const missingFunctions = requiredFunctions.filter((name) => !foundFunctions.has(name));
    const requiredEmailFlags = ['social_email_connections', 'social_email_coming_soon'];
    const featureFlagResult = foundTables.has('feature_flags')
      ? await pool.query(
        `SELECT flag_key FROM public.feature_flags WHERE flag_key = ANY($1)`,
        [requiredEmailFlags],
      )
      : { rows: [] };
    const foundEmailFlags = new Set(featureFlagResult.rows.map((row: { flag_key: string }) => row.flag_key));
    const missingFeatureFlags = requiredEmailFlags.filter((flag) => !foundEmailFlags.has(flag));

    const publicationResult = await pool.query(
      `SELECT DISTINCT c.relname AS table_name
       FROM pg_publication p
       JOIN pg_publication_rel pr ON pr.prpubid = p.oid
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public'
          AND c.relname = ANY($1)`,
      [['agent_tasks', 'agent_leads', 'lead_dm_messages', 'strategies', 'strategy_conversation_runs', 'strategy_conversation_signals', 'agent_deals', 'lead_profile_builder_runs', 'lead_sales_profiles', 'call_campaigns', 'call_campaign_contacts', 'call_logs']],
    );
    const realtimeRequired = ['agent_tasks', 'agent_leads', 'lead_dm_messages', 'strategies', 'strategy_conversation_runs', 'strategy_conversation_signals', 'agent_deals', 'lead_profile_builder_runs', 'lead_sales_profiles', 'call_campaigns', 'call_campaign_contacts', 'call_logs'];
    const realtimeTables = new Set(publicationResult.rows.map((row: { table_name: string }) => row.table_name));
    const missingRealtimeTables = realtimeRequired.filter((table) => !realtimeTables.has(table));

    const result = {
      ok: missingTables.length === 0 && missingColumns.length === 0 && missingFunctions.length === 0 && missingRealtimeTables.length === 0 && missingFeatureFlags.length === 0,
      missingTables,
      missingColumns,
      missingFunctions,
      missingRealtimeTables,
      missingFeatureFlags,
      checkedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[migration-check] FAILED: ${error.message}`);
  process.exitCode = 1;
});
