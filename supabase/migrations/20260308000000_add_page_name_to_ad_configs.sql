alter table public.ad_configs 
add column if not exists page_name text;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
