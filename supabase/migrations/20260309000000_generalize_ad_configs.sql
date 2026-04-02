-- Generalize ad_configs table to support multiple platforms
-- We will add a 'platform' column and make columns nullable where appropriate

-- 1. Add platform column (default to 'facebook' for existing records)
alter table public.ad_configs 
add column if not exists platform text default 'facebook';

-- 2. Make facebook-specific columns nullable (page_id might not apply to all platforms, or might be named differently)
-- However, for simplicity, we can reuse 'page_id' as 'account_id' or 'profile_id' for other platforms,
-- OR we can just make them nullable and add new columns if needed.
-- Let's keep using 'page_id' as a generic "Profile/Page ID" and 'ad_account_id' as "Ad Account ID".
-- But 'page_name' is good.
alter table public.ad_configs alter column ad_account_id drop not null;

-- 3. Add unique constraint for user_id + platform (so a user can have one config per platform)
-- First, drop the existing unique constraint on user_id
alter table public.ad_configs drop constraint if exists ad_configs_user_id_key;

-- Add new unique constraint
alter table public.ad_configs add constraint ad_configs_user_id_platform_key unique (user_id, platform);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
