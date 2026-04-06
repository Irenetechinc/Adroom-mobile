-- ══════════════════════════════════════════════════════════════
-- ADROOM ENERGY SYSTEM — Billing, Subscriptions & Usage Tracking
-- Energy Economics:
--   1 energy credit = $0.20 user-facing = $0.09 actual model cost
--   Company margin: ~55%
-- ══════════════════════════════════════════════════════════════

-- 1. ENERGY ACCOUNTS — user's energy balance
CREATE TABLE IF NOT EXISTS public.energy_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    balance_credits NUMERIC(12, 4) DEFAULT 0,       -- current energy credits
    lifetime_credits NUMERIC(12, 4) DEFAULT 0,      -- total ever purchased
    lifetime_consumed NUMERIC(12, 4) DEFAULT 0,     -- total ever consumed
    on_demand_enabled BOOLEAN DEFAULT false,        -- auto top-up when empty
    on_demand_threshold_credits NUMERIC(8, 4) DEFAULT 25, -- trigger at 25 credits ($5)
    on_demand_top_up_amount TEXT DEFAULT '100',     -- top-up pack to purchase
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.energy_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own energy account" ON public.energy_accounts
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own energy account" ON public.energy_accounts
    FOR UPDATE USING (auth.uid() = user_id);

-- 2. SUBSCRIPTIONS — user subscription state
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    plan TEXT NOT NULL CHECK (plan IN ('starter', 'pro', 'pro_plus', 'none')),
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('trialing', 'active', 'cancelled', 'expired', 'pending_payment')),
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    -- Flutterwave data
    flw_customer_id TEXT,
    flw_subscription_id TEXT,
    flw_card_token TEXT,             -- tokenized card for recurring charges
    flw_card_last4 TEXT,
    flw_card_brand TEXT,
    billing_email TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription" ON public.subscriptions
    FOR SELECT USING (auth.uid() = user_id);

-- 3. ENERGY TRANSACTIONS — full credit/debit ledger
CREATE TABLE IF NOT EXISTS public.energy_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'trial_grant', 'subscription_grant', 'topup', 'on_demand_topup')),
    credits NUMERIC(12, 4) NOT NULL,               -- positive = credit, negative = debit
    balance_after NUMERIC(12, 4) NOT NULL,
    description TEXT,
    -- debit-specific
    operation TEXT,                                 -- 'scan_product', 'generate_strategy', etc.
    actual_cost_usd NUMERIC(10, 6),                -- real model cost
    energy_rate NUMERIC(10, 6),                    -- credits per $1 actual
    -- payment reference
    flw_transaction_id TEXT,
    flw_tx_ref TEXT,
    amount_usd NUMERIC(10, 2),                     -- dollars paid for top-ups
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_tx_user ON public.energy_transactions (user_id, created_at DESC);

ALTER TABLE public.energy_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own energy transactions" ON public.energy_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- 4. AI USAGE LOGS — per-call tracking for auditing
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    model TEXT NOT NULL,                            -- 'gpt-4o', 'gemini-flash', 'imagen-3'
    operation TEXT NOT NULL,                        -- 'generate_strategy', 'scan_product', etc.
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    actual_cost_usd NUMERIC(10, 6) DEFAULT 0,
    energy_debited NUMERIC(12, 4) DEFAULT 0,
    strategy_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON public.ai_usage_logs (user_id, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own AI usage" ON public.ai_usage_logs
    FOR SELECT USING (auth.uid() = user_id);

-- 5. PAYMENT METHODS — stored Flutterwave card tokens
CREATE TABLE IF NOT EXISTS public.payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    flw_token TEXT NOT NULL,
    last4 TEXT,
    brand TEXT,
    exp_month TEXT,
    exp_year TEXT,
    email TEXT,
    is_default BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own payment methods" ON public.payment_methods
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own payment methods" ON public.payment_methods
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own payment methods" ON public.payment_methods
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own payment methods" ON public.payment_methods
    FOR DELETE USING (auth.uid() = user_id);

-- 6. FUNCTION — auto-create energy account when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_energy()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.energy_accounts (user_id, balance_credits)
    VALUES (NEW.id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.subscriptions (user_id, plan, status)
    VALUES (NEW.id, 'none', 'inactive')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_energy ON auth.users;
CREATE TRIGGER on_auth_user_created_energy
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_energy();

-- Backfill existing users
INSERT INTO public.energy_accounts (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, plan, status)
SELECT id, 'none', 'inactive' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
