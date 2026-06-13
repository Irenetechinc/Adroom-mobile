/**
 * APMA Startup Migration
 * Ensures the apma_campaigns table has campaign_type, campaign_subtype, duration_months columns.
 * Uses pg directly with SUPABASE_DB_URL (set on Railway; skipped gracefully if not configured).
 */

import { Pool } from 'pg';

const MIGRATION_SQL = `
ALTER TABLE apma_campaigns
  ADD COLUMN IF NOT EXISTS campaign_type    text NOT NULL DEFAULT 'gubernatorial',
  ADD COLUMN IF NOT EXISTS campaign_subtype text NOT NULL DEFAULT 'build',
  ADD COLUMN IF NOT EXISTS duration_months  integer NOT NULL DEFAULT 12;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apma_campaigns_campaign_type_check'
  ) THEN
    ALTER TABLE apma_campaigns
      ADD CONSTRAINT apma_campaigns_campaign_type_check
        CHECK (campaign_type IN ('presidential','gubernatorial','senate','house','city_council','mayoral','public_perception'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apma_campaigns_campaign_subtype_check'
  ) THEN
    ALTER TABLE apma_campaigns
      ADD CONSTRAINT apma_campaigns_campaign_subtype_check
        CHECK (campaign_subtype IN ('build','defend','offensive','defensive','general'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apma_campaigns_duration_months_check'
  ) THEN
    ALTER TABLE apma_campaigns
      ADD CONSTRAINT apma_campaigns_duration_months_check
        CHECK (duration_months IN (6, 12, 18, 24));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS apma_campaigns_type_idx    ON apma_campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS apma_campaigns_subtype_idx ON apma_campaigns(campaign_subtype);
`;

function buildConnectionString(): string | null {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  if (process.env.SUPABASE_DB_PASSWORD && process.env.SUPABASE_URL) {
    const ref = process.env.SUPABASE_URL.replace('https://', '').split('.')[0];
    return `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.${ref}.supabase.co:5432/postgres`;
  }
  return null;
}

export async function runAPMAStartupMigration(): Promise<{ ok: boolean; message: string }> {
  const connStr = buildConnectionString();
  if (!connStr) {
    console.warn('[APMA Migration] Skipped — SUPABASE_DB_URL or SUPABASE_DB_PASSWORD not set.');
    console.warn('[APMA Migration] Set SUPABASE_DB_URL on Railway to auto-apply schema migrations.');
    return { ok: false, message: 'SUPABASE_DB_URL not configured — migration skipped' };
  }

  const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await pool.query(MIGRATION_SQL);
    console.log('[APMA Migration] ✓ apma_campaigns schema up-to-date (campaign_type, campaign_subtype, duration_months)');
    return { ok: true, message: 'APMA campaign columns migration applied successfully' };
  } catch (err: any) {
    console.error('[APMA Migration] Failed:', err.message);
    return { ok: false, message: err.message };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function checkAPMAMigrationStatus(): Promise<{ migrated: boolean; missing: string[] }> {
  const connStr = buildConnectionString();
  if (!connStr) return { migrated: false, missing: ['SUPABASE_DB_URL not configured'] };

  const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'apma_campaigns'
         AND column_name IN ('campaign_type','campaign_subtype','duration_months')`
    );
    const found = result.rows.map((r: any) => r.column_name);
    const required = ['campaign_type', 'campaign_subtype', 'duration_months'];
    const missing = required.filter(c => !found.includes(c));
    return { migrated: missing.length === 0, missing };
  } catch (err: any) {
    return { migrated: false, missing: [err.message] };
  } finally {
    await pool.end().catch(() => {});
  }
}
