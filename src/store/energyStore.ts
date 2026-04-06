import { create } from 'zustand';
import { supabase } from '../services/supabase';
import Constants from 'expo-constants';

const API_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000';

export interface EnergyAccount {
  id: string;
  user_id: string;
  balance_credits: number;
  lifetime_credits: number;
  lifetime_consumed: number;
  on_demand_enabled: boolean;
  on_demand_threshold_credits: number;
  on_demand_top_up_amount: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'starter' | 'pro' | 'pro_plus' | 'none';
  status: 'trialing' | 'active' | 'cancelled' | 'expired' | 'inactive' | 'pending_payment';
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  flw_card_last4: string | null;
  flw_card_brand: string | null;
  billing_email: string | null;
  cancelled_at: string | null;
}

export interface EnergyTransaction {
  id: string;
  type: string;
  credits: number;
  balance_after: number;
  description: string;
  operation: string | null;
  amount_usd: number | null;
  created_at: string;
}

export const PLAN_DETAILS = {
  starter: { name: 'Starter', price: 20, credits: 100, actualBudget: 9, color: '#00F0FF' },
  pro:     { name: 'Pro',     price: 45, credits: 300, actualBudget: 25, color: '#7C3AED' },
  pro_plus:{ name: 'Pro+',   price: 100, credits: 600, actualBudget: 45, color: '#F59E0B' },
  none:    { name: 'Free',    price: 0,  credits: 0,   actualBudget: 0,  color: '#64748B' },
};

export const TOPUP_OPTIONS = [
  { id: 'topup_600', credits: 600, price: 120, label: '600 Energy',  best: true  },
  { id: 'topup_300', credits: 300, price: 50,  label: '300 Energy',  best: false },
  { id: 'topup_100', credits: 100, price: 25,  label: '100 Energy',  best: false },
];

interface EnergyState {
  account: EnergyAccount | null;
  subscription: Subscription | null;
  transactions: EnergyTransaction[];
  isLoading: boolean;
  lastFetched: number | null;

  // Actions
  fetchEnergy: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  startTrial: () => Promise<{ success: boolean; message: string }>;
  cancelSubscription: (reason?: string) => Promise<{ success: boolean }>;
  toggleOnDemand: (enabled: boolean) => Promise<void>;
  verifyAndApplyPayment: (
    transactionId: string,
    txRef: string,
    type: 'subscription' | 'topup',
    planOrPackId: string,
  ) => Promise<{ success: boolean; message: string; credits?: number }>;
}

export const useEnergyStore = create<EnergyState>((set, get) => ({
  account: null,
  subscription: null,
  transactions: [],
  isLoading: false,
  lastFetched: null,

  fetchEnergy: async () => {
    set({ isLoading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { set({ isLoading: false }); return; }

      const [accountRes, subRes, txRes] = await Promise.all([
        supabase.from('energy_accounts').select('*').eq('user_id', session.user.id).single(),
        supabase.from('subscriptions').select('*').eq('user_id', session.user.id).single(),
        supabase.from('energy_transactions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(30),
      ]);

      set({
        account: accountRes.data ?? null,
        subscription: subRes.data ?? null,
        transactions: txRes.data ?? [],
        isLoading: false,
        lastFetched: Date.now(),
      });
    } catch (err) {
      console.error('[EnergyStore] fetch error:', err);
      set({ isLoading: false });
    }
  },

  refreshBalance: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('energy_accounts').select('*').eq('user_id', session.user.id).single();
    if (data) set({ account: data });
  },

  startTrial: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { success: false, message: 'Not authenticated.' };

      const res = await fetch(`${API_URL}/api/billing/start-trial`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) await get().fetchEnergy();
      return { success: data.success ?? false, message: data.message ?? 'An error occurred.' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },

  cancelSubscription: async (reason?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { success: false };

      const res = await fetch(`${API_URL}/api/billing/cancel-subscription`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (data.success) await get().fetchEnergy();
      return { success: data.success ?? false };
    } catch { return { success: false }; }
  },

  toggleOnDemand: async (enabled: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from('energy_accounts')
      .update({ on_demand_enabled: enabled })
      .eq('user_id', session.user.id);
    set((s) => ({ account: s.account ? { ...s.account, on_demand_enabled: enabled } : null }));
  },

  verifyAndApplyPayment: async (transactionId, txRef, type, planOrPackId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { success: false, message: 'Not authenticated.' };

      const endpoint = type === 'subscription' ? '/api/billing/verify-subscription' : '/api/billing/verify-topup';
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: transactionId, tx_ref: txRef, plan_id: planOrPackId, pack_id: planOrPackId }),
      });
      const data = await res.json();
      if (data.success) await get().fetchEnergy();
      return { success: data.success ?? false, message: data.message ?? '', credits: data.credits };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
}));
