import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import Constants from 'expo-constants';

const API_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000';

interface NotificationState {
  unreadCount: number;
  currentUserId: string | null;
  channel: RealtimeChannel | null;
  setUnread: (n: number) => void;
  refresh: (userId: string | null) => Promise<void>;
  attach: (userId: string | null) => Promise<void>;
  detach: () => void;
}

/**
 * Single source of truth for the unread notifications counter.
 * Consumed by the Settings row badge and the Notifications screen.
 * Uses backend API as the authoritative source (bypasses any RLS quirks),
 * with Supabase direct count as a fast local fallback.
 * One realtime channel per user is attached at the App.tsx level the moment
 * a session is available so the badge stays live without any screen visit.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  currentUserId: null,
  channel: null,

  setUnread: (n) => set({ unreadCount: Math.max(0, n | 0) }),

  refresh: async (userId) => {
    if (!userId) { set({ unreadCount: 0 }); return; }

    // Primary source: backend API (most reliable — not affected by Supabase RLS
    // configuration differences between envs).
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const res = await fetch(`${API_URL}/api/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          set({ unreadCount: Math.max(0, (data.count ?? 0) | 0) });
          return;
        }
      }
    } catch { /* fall through to Supabase direct */ }

    // Fallback: Supabase direct count (works offline / without backend)
    try {
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (!error) set({ unreadCount: count ?? 0 });
    } catch { /* ignore */ }
  },

  attach: async (userId) => {
    const { currentUserId, channel } = get();

    if (currentUserId === userId && channel) {
      // Already subscribed for this user — just refresh in case we missed an event.
      await get().refresh(userId);
      return;
    }

    // Tear down previous subscription before opening a new one.
    if (channel) {
      try { await supabase.removeChannel(channel); } catch { /* ignore */ }
    }

    if (!userId) {
      set({ unreadCount: 0, currentUserId: null, channel: null });
      return;
    }

    const ch = supabase
      .channel(`notif_unread_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
        () => { get().refresh(userId); },
      )
      .subscribe();

    set({ currentUserId: userId, channel: ch });
    // Fetch count immediately after attaching
    await get().refresh(userId);
  },

  detach: () => {
    const { channel } = get();
    if (channel) {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
    }
    set({ unreadCount: 0, currentUserId: null, channel: null });
  },
}));
