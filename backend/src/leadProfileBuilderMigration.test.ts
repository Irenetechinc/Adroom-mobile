import assert from 'assert';
import { promises as fs } from 'fs';
import path from 'path';

async function main(): Promise<void> {
  const migration = await fs.readFile(path.resolve(__dirname, '..', 'lead_profile_builder_migration.sql'), 'utf8');
  const legacyMigration = await fs.readFile(path.resolve(__dirname, '..', 'feature_strategy_logistics_migration.sql'), 'utf8');

  assert.match(legacyMigration, /CREATE TABLE IF NOT EXISTS public\.lead_sales_profiles/);
  assert.match(legacyMigration, /lead_id uuid NOT NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.lead_sales_profiles/);
  assert.match(migration, /ADD CONSTRAINT lead_sales_profiles_lead_id_fkey/);
  assert.match(migration, /FOREIGN KEY \(lead_id\) REFERENCES public\.agent_leads\(id\) ON DELETE CASCADE/);
  assert.match(migration, /NOT EXISTS \(\s*SELECT 1\s+FROM pg_constraint/s);
  assert.match(migration, /DROP POLICY IF EXISTS "Users read own lead sales profiles"/);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.lead_sales_profiles/);

  console.log('Lead profile builder migration compatibility checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});