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
  'personal_inbound_messages',
  'device_push_tokens',
  'agent_tasks',
  'agent_leads',
  'lead_dm_messages',
  'strategies',
  'strategy_conversation_runs',
  'strategy_conversation_signals',
  'agent_deals',
];

const requiredColumns: Record<string, string[]> = {
  personal_inbound_messages: ['user_id', 'provider', 'external_id', 'sender_id', 'message', 'message_timestamp'],
  device_push_tokens: ['user_id', 'token', 'project_id', 'is_active'],
  agent_tasks: ['action_type', 'selected_account_id', 'recipient_id', 'conversation_id', 'media'],
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

    const functionResult = await pool.query(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = 'public' AND routine_name = 'reserve_social_action'`,
    );
    const missingFunctions = functionResult.rows.length ? [] : ['reserve_social_action'];

    const publicationResult = await pool.query(
      `SELECT DISTINCT c.relname AS table_name
       FROM pg_publication p
       JOIN pg_publication_rel pr ON pr.prpubid = p.oid
       JOIN pg_class c ON c.oid = pr.prrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public'
         AND c.relname = ANY($1)`,
      [['agent_tasks', 'agent_leads', 'lead_dm_messages', 'strategies', 'strategy_conversation_runs', 'strategy_conversation_signals', 'agent_deals']],
    );
    const realtimeRequired = ['agent_tasks', 'agent_leads', 'lead_dm_messages', 'strategies', 'strategy_conversation_runs', 'strategy_conversation_signals', 'agent_deals'];
    const realtimeTables = new Set(publicationResult.rows.map((row: { table_name: string }) => row.table_name));
    const missingRealtimeTables = realtimeRequired.filter((table) => !realtimeTables.has(table));

    const result = {
      ok: missingTables.length === 0 && missingColumns.length === 0 && missingFunctions.length === 0 && missingRealtimeTables.length === 0,
      missingTables,
      missingColumns,
      missingFunctions,
      missingRealtimeTables,
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
