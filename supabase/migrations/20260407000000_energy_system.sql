-- ══════════════════════════════════════════════════════════════
-- ADROOM ENERGY SYSTEM — Billing, Subscriptions & Usage Tracking
-- Energy Economics:
--   1 energy credit = $0.20 user-facing = $0.09 actual model cost
--   Company margin: ~55%
-- Safe to re-run: drops existing objects first, then recreates cleanly.
-- ══════════════════════════════════════════════════════════════

-- ── CLEAN UP any partial state from previous runs ────────────
DROP TRIGGER IF EXISTS on_auth_user_created_energy ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_energy() CASCADE;

DROP TABLE IF EXISTS public.ai_usage_logs CASCADE;
DROP TABLE IF EXISTS public.energy_transactions CASCADE;
DROP TABLE IF EXISTS public.payment_methods CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.energy_accounts CASCADE;

-- ── 1. ENERGY ACCOUNTS — user's energy balance ───────────────
CREATE TABLE public.energy_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    balance_credits NUMERIC(12, 4) DEFAULT 0,
    lifetime_credits NUMERIC(12, 4) DEFAULT 0,
    lifetime_consumed NUMERIC(12, 4) DEFAULT 0,
    on_demand_enabled BOOLEAN DEFAULT false,
    on_demand_threshold_credits NUMERIC(8, 4) DEFAULT 25,
    on_demand_top_up_amount TEXT DEFAULT '100',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.energy_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own energy account" ON public.energy_accounts
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own energy account" ON public.energy_accounts
    FOR UPDATE USING (auth.uid() = user_id);

-- ── 2. SUBSCRIPTIONS — user subscription state ───────────────
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    plan TEXT NOT NULL DEFAULT 'none'
        CHECK (plan IN ('starter', 'pro', 'pro_plus', 'none')),
    status TEXT NOT NULL DEFAULT 'inactive'
        CHECK (status IN ('inactive', 'trialing', 'active', 'cancelled', 'expired', 'pending_payment')),
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    flw_customer_id TEXT,
    flw_subscription_id TEXT,
    flw_card_token TEXT,
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

-- ── 3. ENERGY TRANSACTIONS — full credit/debit ledger ────────
CREATE TABLE public.energy_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'trial_grant', 'subscription_grant', 'topup', 'on_demand_topup')),
    credits NUMERIC(12, 4) NOT NULL,
    balance_after NUMERIC(12, 4) NOT NULL,
    description TEXT,
    operation TEXT,
    actual_cost_usd NUMERIC(10, 6),
    energy_rate NUMERIC(10, 6),
    flw_transaction_id TEXT,
    flw_tx_ref TEXT,
    amount_usd NUMERIC(10, 2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_energy_tx_user ON public.energy_transactions (user_id, created_at DESC);

ALTER TABLE public.energy_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own energy transactions" ON public.energy_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- ── 4. AI USAGE LOGS ─────────────────────────────────────────
CREATE TABLE public.ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    operation TEXT NOT NULL,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    actual_cost_usd NUMERIC(10, 6) DEFAULT 0,
    energy_debited NUMERIC(12, 4) DEFAULT 0,
    strategy_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_user ON public.ai_usage_logs (user_id, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own AI usage" ON public.ai_usage_logs
    FOR SELECT USING (auth.uid() = user_id);

-- ── 5. PAYMENT METHODS ───────────────────────────────────────
CREATE TABLE public.payment_methods (
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

-- ── 6. TRIGGER — auto-create records on new user signup ──────
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

CREATE TRIGGER on_auth_user_created_energy
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_energy();

-- ── 7. BACKFILL existing users ────────────────────────────────
INSERT INTO public.energy_accounts (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.subscriptions (user_id, plan, status)
SELECT id, 'none', 'inactive' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
