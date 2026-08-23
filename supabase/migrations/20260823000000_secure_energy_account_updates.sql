-- Prevent clients from changing balances or billing state directly.
DROP POLICY IF EXISTS "Users can update own energy account" ON public.energy_accounts;

CREATE OR REPLACE FUNCTION public.set_on_demand_preferences(
  p_enabled BOOLEAN,
  p_pack_id TEXT DEFAULT NULL
)
RETURNS public.energy_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_account public.energy_accounts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_pack_id IS NOT NULL AND p_pack_id NOT IN ('topup_100', 'topup_300', 'topup_600') THEN
    RAISE EXCEPTION 'Invalid top-up pack';
  END IF;

  UPDATE public.energy_accounts
  SET on_demand_enabled = p_enabled,
      on_demand_top_up_amount = COALESCE(p_pack_id, on_demand_top_up_amount),
      on_demand_top_up_retry_at = CASE
        WHEN NOT p_enabled OR p_pack_id IS NOT NULL THEN NULL
        ELSE on_demand_top_up_retry_at
      END,
      updated_at = NOW()
  WHERE user_id = auth.uid()
  RETURNING * INTO updated_account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Energy account not found';
  END IF;

  RETURN updated_account;
END;
$$;

REVOKE ALL ON FUNCTION public.set_on_demand_preferences(BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_on_demand_preferences(BOOLEAN, TEXT) TO authenticated;
