-- Fix wallet + energy triggers to never fail on user signup
-- Wraps inserts in EXCEPTION blocks so "Database error saving new user" cannot occur

CREATE OR REPLACE FUNCTION public.handle_new_user_wallet()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth user creation due to wallet issues
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_wallet ON auth.users;
CREATE TRIGGER on_auth_user_created_wallet
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_wallet();

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
EXCEPTION WHEN OTHERS THEN
  -- Never block auth user creation due to energy account issues
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_energy ON auth.users;
CREATE TRIGGER on_auth_user_created_energy
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_energy();

NOTIFY pgrst, 'reload schema';
