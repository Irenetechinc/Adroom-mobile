import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

/**
 * Persist the last-known user id across app restarts so we can detect a
 * genuine identity change (different user logging in on the same device)
 * — not just a sign-out + sign-back-in by the same user.
 *
 * Without persistence, after the app closes lastUserId resets to null and
 * we'd treat every sign-in as "first sign-in" and never wipe stale state
 * from a previous user.
 */
const LAST_USER_ID_KEY = 'adroom-auth-last-user-id';
let lastUserIdMem: string | null = null;

const readPersistedLastUserId = async (): Promise<string | null> => {
  try {
    const v = await AsyncStorage.getItem(LAST_USER_ID_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
};

const writePersistedLastUserId = async (id: string | null) => {
  try {
    if (id) await AsyncStorage.setItem(LAST_USER_ID_KEY, id);
    else await AsyncStorage.removeItem(LAST_USER_ID_KEY);
  } catch { /* ignore */ }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  isLoading: true,
  hasActiveStrategy: false,
  initialize: async () => {
    try {
      // Hydrate the in-memory lastUserId from disk so identity-change
      // detection works even on the first auth event after app launch.
      lastUserIdMem = await readPersistedLastUserId();

      const { data: { session } } = await supabase.auth.getSession();
      let hasActive = false;
      if (session?.user?.id) {
        hasActive = await checkActiveStrategy(session.user.id);
        // If a different user has session-restored on app launch (e.g. they
        // signed in on a different account before app was killed), wipe
        // stale per-user state from the previous owner of this device.
        if (lastUserIdMem && lastUserIdMem !== session.user.id) {
          try { await useAgentStore.getState().clearAll(); } catch { /* ignore */ }
        }
        lastUserIdMem = session.user.id;
        await writePersistedLastUserId(session.user.id);
        // Always re-hydrate connected platforms from the backend on launch.
        useAgentStore.getState().loadConnectedPlatforms().catch(() => {});

        // ── Cold-start session-restore prompt ────────────────────────────
        // The user reopened the app on a fresh process with an existing
        // session. Surface the "Restore previous session or start fresh?"
        // prompt the next time the chat screen mounts. This is set BEFORE
        // the onAuthStateChange listener attaches so it always wins the
        // race against the chat screen's loadMessages().
        try { await useAgentStore.getState().setPendingSessionPrompt(true); } catch { /* ignore */ }
      }
      set({ session, user: session?.user ?? null, hasActiveStrategy: hasActive, isLoading: false });

      supabase.auth.onAuthStateChange(async (event: string, newSession: Session | null) => {
        const newUserId = newSession?.user?.id ?? null;

        // Detect identity change on sign-in: if a *different* user just
        // signed in than the last one we saw on this device, wipe their
        // connected platforms / tokens / chat history so nothing bleeds
        // through. Pure sign-out → sign-in by the same user does NOT
        // trigger this — their connected accounts persist.
        if (event === 'SIGNED_IN' && newUserId && lastUserIdMem && lastUserIdMem !== newUserId) {
          try { await useAgentStore.getState().clearAll(); } catch { /* ignore */ }
        }

        // ── Session-restore prompt ────────────────────────────────────────
        // Every fresh sign-in (NOT cold starts / token refreshes) should
        // surface the "Restore previous session or start fresh?" prompt the
        // next time the chat screen mounts. Setting the flag here covers the
        // race where loadMessages() runs before this handler completes —
        // the flag is also persisted to AsyncStorage by the agent store.
        if (event === 'SIGNED_IN' && newUserId) {
          try { await useAgentStore.getState().setPendingSessionPrompt(true); } catch { /* ignore */ }
        }

        if (newUserId) {
          lastUserIdMem = newUserId;
          await writePersistedLastUserId(newUserId);
        }

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
        // / token refresh so the Connected Accounts screen reflects the
        // server's source of truth (ad_configs table) immediately.
        if (newUserId && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
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

    // IMPORTANT: do NOT call agentStore.clearAll() here. We want connected
    // platforms / tokens / chat history to PERSIST when the same user signs
    // back in on this device. Stale data from a *different* user is wiped
    // by the identity-change branch in onAuthStateChange (above) when a
    // new user actually signs in.
    await supabase.auth.signOut();
    set({ session: null, user: null, hasActiveStrategy: false });
  },
}));
