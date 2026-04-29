import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

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
 * Consumed by the Settings row badge and the Notifications screen so they
 * always agree. One realtime channel per user, attached at the App.tsx level
 * the moment a session is available, then refreshed on every insert/update
 * to user_notifications for that user.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  currentUserId: null,
  channel: null,

  setUnread: (n) => set({ unreadCount: Math.max(0, n | 0) }),

  refresh: async (userId) => {
    if (!userId) { set({ unreadCount: 0 }); return; }
    try {
      const { count, error } = await supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (error) return;
      set({ unreadCount: count ?? 0 });
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
