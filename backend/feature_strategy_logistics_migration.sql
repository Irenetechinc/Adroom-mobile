-- Optional strategy inputs for account selection and logistics.
ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS selected_accounts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'physical';
ALTER TABLE public.strategies ADD COLUMN IF NOT EXISTS dispatch_address text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategies_product_type_check') THEN
    ALTER TABLE public.strategies ADD CONSTRAINT strategies_product_type_check CHECK (product_type IN ('physical', 'digital'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS strategies_selected_accounts_idx ON public.strategies USING gin (selected_accounts);

-- Public prospect intelligence stores public excerpts only; no private enrichment.
CREATE TABLE IF NOT EXISTS public.public_prospect_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid,
  source text NOT NULL,
  source_url text NOT NULL,
  public_author text,
  content_excerpt text NOT NULL,
  intent_score numeric(5,2) NOT NULL DEFAULT 0,
  buying_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  collected_at timestamptz NOT NULL DEFAULT now(),
  robots_allowed boolean NOT NULL DEFAULT true,
  UNIQUE(user_id, source_url)
);
ALTER TABLE public.public_prospect_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own public prospect mentions" ON public.public_prospect_mentions FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS public_prospect_mentions_user_idx ON public.public_prospect_mentions(user_id, collected_at DESC);

-- Explicit user controls for future outreach/calling agents.
CREATE TABLE IF NOT EXISTS public.outreach_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  do_not_call boolean NOT NULL DEFAULT false,
  public_data_collection boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.outreach_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own outreach preferences" ON public.outreach_preferences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid,
  strategy_id uuid,
  status text NOT NULL DEFAULT 'queued',
  consent_confirmed boolean NOT NULL DEFAULT false,
  provider text,
  provider_call_id text,
  started_at timestamptz,
  ended_at timestamptz,
  transcript text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own call logs" ON public.call_logs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS call_logs_user_created_idx ON public.call_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id uuid,
  product_id uuid,
  lead_id uuid,
  product_type text NOT NULL DEFAULT 'physical',
  pickup_address text,
  delivery_address text,
  carrier text,
  tracking_number text,
  status text NOT NULL DEFAULT 'awaiting_dispatch',
  pickup_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  tracking_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  pickup_confirmed_at timestamptz,
  pickup_evidence_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own shipments" ON public.shipments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS shipments_user_status_idx ON public.shipments(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_sales_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_count integer NOT NULL DEFAULT 0,
  confidence_score numeric(5,4) NOT NULL DEFAULT 0,
  privacy_scope text NOT NULL DEFAULT 'public_and_user_owned_evidence',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lead_id)
);
ALTER TABLE public.lead_sales_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own lead sales profiles" ON public.lead_sales_profiles;
CREATE POLICY "Users manage own lead sales profiles" ON public.lead_sales_profiles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS lead_sales_profiles_user_idx ON public.lead_sales_profiles(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.user_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  provider text NOT NULL,
  provider_sid text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id),
  UNIQUE(provider, provider_sid)
);
ALTER TABLE public.user_phone_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own phone numbers" ON public.user_phone_numbers;
CREATE POLICY "Users read own phone numbers" ON public.user_phone_numbers FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_phone_numbers_status_idx ON public.user_phone_numbers(status);
