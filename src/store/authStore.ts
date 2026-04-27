import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { useAgentStore } from './agentStore';
import { unregisterPushToken } from '../services/notificationService';

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  hasActiveStrategy: boolean;
  initialize: () => Promise<void>;
  refreshActiveStrategy: () => Promise<void>;
  signOut: () => Promise<void>;
}

const checkActiveStrategy = async (userId: string): Promise<boolean> => {
  try {
    const { count, error } = await supabase
      .from('strategies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);
    if (error) {
      // If column missing or other transient error, treat as no active strategy
      // so the user lands on the chat to start one rather than a broken dashboard.
      return false;
    }
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
};

// Track previous user id so we can detect identity changes (a different user
// logging in on the same device) and wipe stale per-user persisted state.
let lastUserId: string | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  isLoading: true,
  hasActiveStrategy: false,
  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let hasActive = false;
      if (session?.user?.id) {
        hasActive = await checkActiveStrategy(session.user.id);
        lastUserId = session.user.id;
        // Ensure connected platforms are hydrated from the backend on app
        // launch — the local persisted snapshot may be empty (e.g. after a
        // previous signOut() wiped it) but the user's ad_configs in Supabase
        // are the source of truth and must always be re-fetched on sign-in.
        useAgentStore.getState().loadConnectedPlatforms().catch(() => {});
      }
      set({ session, user: session?.user ?? null, hasActiveStrategy: hasActive, isLoading: false });

      supabase.auth.onAuthStateChange(async (_event: string, newSession: Session | null) => {
        const newUserId = newSession?.user?.id ?? null;

        // If the user identity changed (different account on same device),
        // clear the persisted agent state so connected platforms / tokens /
        // chat history from a previous user never bleed through.
        if (lastUserId && newUserId && lastUserId !== newUserId) {
          try { await useAgentStore.getState().clearAll(); } catch { /* ignore */ }
        }
        lastUserId = newUserId;

        let active = false;
        if (newSession?.user?.id) {
          active = await checkActiveStrategy(newSession.user.id);
        }
        set({
          session: newSession,
          user: newSession?.user ?? null,
          hasActiveStrategy: active,
          isLoading: false,
        });

        // Re-hydrate connected platforms from the backend on every sign-in
        // (SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED). This is what makes
        // the Connected Accounts screen show the correct state after a user
        // logs out and back in — without this, signOut wipes the in-memory
        // map and re-login leaves it empty until the next manual refresh.
        if (newUserId) {
          useAgentStore.getState().loadConnectedPlatforms().catch(() => {});
        }
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ isLoading: false });
    }
  },
  refreshActiveStrategy: async () => {
    const userId = get().session?.user?.id;
    if (!userId) {
      set({ hasActiveStrategy: false });
      return;
    }
    const active = await checkActiveStrategy(userId);
    set({ hasActiveStrategy: active });
  },
  signOut: async () => {
    // Deactivate this device's push token first — must happen while we still
    // have a valid session so the backend authorizes the request. Otherwise
    // the previous user keeps receiving pushes when someone else signs in
    // on this device.
    try { await unregisterPushToken(); } catch { /* ignore */ }
    // Wipe per-user persisted state BEFORE Supabase signOut so the next user
    // logging in on this device starts from a clean slate.
    try { await useAgentStore.getState().clearAll(); } catch { /* ignore */ }
    await supabase.auth.signOut();
    lastUserId = null;
    set({ session: null, user: null, hasActiveStrategy: false });
  },
}));
