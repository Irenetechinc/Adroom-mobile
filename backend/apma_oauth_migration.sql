-- ============================================================
-- APMA OAuth Migration
-- Run this in Supabase SQL Editor after apma_migration.sql
-- Adds unique constraint so OAuth upserts never create duplicates
-- and adds refresh_token column if not already present
-- ============================================================

-- 1. Add refresh_token column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'apma_social_accounts' AND column_name = 'refresh_token'
  ) THEN
    ALTER TABLE apma_social_accounts ADD COLUMN refresh_token TEXT;
  END IF;
END $$;

-- 2. Add token_expires_at column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'apma_social_accounts' AND column_name = 'token_expires_at'
  ) THEN
    ALTER TABLE apma_social_accounts ADD COLUMN token_expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- 3. Add unique constraint so connecting the same account twice updates instead of duplicating
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apma_social_accounts_client_platform_account_unique'
  ) THEN
    ALTER TABLE apma_social_accounts
    ADD CONSTRAINT apma_social_accounts_client_platform_account_unique
    UNIQUE (client_id, platform, account_id);
  END IF;
END $$;
