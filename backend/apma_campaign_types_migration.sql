-- ══════════════════════════════════════════════════════════════════════════════
-- APMA Campaign Types Migration
-- Run AFTER apma_migration.sql in your Supabase SQL Editor
-- Adds campaign_type, campaign_subtype, duration_months to apma_campaigns
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE apma_campaigns
  ADD COLUMN IF NOT EXISTS campaign_type    text NOT NULL DEFAULT 'gubernatorial',
  ADD COLUMN IF NOT EXISTS campaign_subtype text NOT NULL DEFAULT 'build',
  ADD COLUMN IF NOT EXISTS duration_months  integer NOT NULL DEFAULT 12;

-- Allowed values check
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

SELECT 'APMA campaign types migration complete' AS status;
