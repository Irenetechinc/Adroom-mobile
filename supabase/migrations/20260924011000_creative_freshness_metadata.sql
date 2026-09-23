alter table if exists public.gda_design_history
  add column if not exists intelligence_freshness jsonb,
  add column if not exists decision_metadata jsonb,
  add column if not exists creative_concept text;