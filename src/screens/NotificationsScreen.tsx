import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl, ScrollView, Modal, Pressable, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Bell, BellOff, CheckCheck, X, Zap, CreditCard, AlertTriangle, Sparkles, Rocket, Send } from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { supabase } from '../services/supabase';
import { useNotificationStore } from '../store/notificationStore';
import { forcePushReregistration } from '../services/notificationService';
import Constants from 'expo-constants';
import { Skeleton } from '../components/Skeleton';

function NotificationsSkeleton() {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} scrollEnabled={false}>
      {[...Array(6)].map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12, backgroundColor: '#151B2B', borderRadius: 14, borderWidth: 1, borderColor: '#1E293B', padding: 14, marginBottom: 10 }}>
          <Skeleton width={36} height={36} borderRadius={10} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="70%" height={13} borderRadius={4} />
            <Skeleton width="100%" height={12} borderRadius={4} />
            <Skeleton width="90%" height={12} borderRadius={4} />
            <Skeleton width="30%" height={11} borderRadius={4} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || '';

interface UserNotification {
  id: string;
  title: string;
  body: string;
  data: Record<string, any>;
  is_read: boolean;
  sent_by: string;
  created_at: string;
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatFullDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function iconForType(type: string | undefined, isRead: boolean) {
  const color = isRead ? '#475569' : '#00F0FF';
  switch (type) {
    case 'topup_success':
    case 'plan_changed':
      return <CreditCard size={16} color={color} />;
    case 'low_credits':
    case 'credits_exhausted':
    case 'auto_topup_failed':
    case 'insufficient_credits':
      return <AlertTriangle size={16} color={isRead ? '#475569' : '#F59E0B'} />;
    case 'trial_started':
      return <Sparkles size={16} color={color} />;
    case 'strategy_activated':
    case 'strategy_stopped':
      return <Rocket size={16} color={color} />;
    case 'subscription_cancelled':
      return <Zap size={16} color={color} />;
    default:
      return <Bell size={16} color={color} />;
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [selected, setSelected] = useState<UserNotification | null>(null);
  const [testingPush, setTestingPush] = useState(false);

  // Diagnostic: triggers a real test push to all of this user's active devices
  // and shows a clear, actionable message about what's working / what's broken.
  const runPushTest = useCallback(async () => {
    if (testingPush) return;
    setTestingPush(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        Alert.alert('Sign in required', 'Please sign in before running the push test.');
        return;
      }
      let res = await fetch(`${BACKEND_URL}/api/push/test`, { method: 'POST', headers });
      let json: any = await res.json().catch(() => ({} as any));

      // Self-heal: if the backend reports no registered tokens for this
      // user, the device's local "we already registered" cache is stale.
      // Wipe it, force a fresh Expo push token registration, then re-test
      // automatically so the user doesn't have to do anything else.
      if (json && json.tokensFound === 0) {
        try {
          const freshToken = await forcePushReregistration();
          if (freshToken) {
            res = await fetch(`${BACKEND_URL}/api/push/test`, { method: 'POST', headers });
            json = await res.json().catch(() => ({} as any));
          }
        } catch { /* fall through and report whatever the second test returned */ }
      }

      const lines: string[] = [];
      lines.push(json.diagnosis || 'No diagnosis returned.');
      if (typeof json.tokensFound === 'number') lines.push(`\nDevices registered: ${json.tokensFound}`);
      if (json.expo?.errorSummary) lines.push(`\nExpo response: ${json.expo.errorSummary}`);
      if (json.actionable) lines.push(`\nWhat to do:\n${json.actionable}`);

      Alert.alert(
        json.success ? 'Test push sent ✓' : 'Push not delivered',
        lines.join('\n'),
        [{ text: 'OK' }],
      );
    } catch (e: any) {
      Alert.alert('Test failed', e?.message || 'Could not reach the backend. Check your connection.');
    } finally {
      setTestingPush(false);
    }
  }, [testingPush]);
  const channelRef = useRef<any>(null);

  const fetchNotifications = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      const headers = await getAuthHeaders();
      if (!headers || !BACKEND_URL) { setLoading(false); return; }
      const res = await fetch(`${BACKEND_URL}/api/notifications/inbox`, { headers });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
      // Keep the shared store (driving the Settings badge) in sync.
      useNotificationStore.getState().setUnread(data.unread || 0);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + Supabase realtime subscription on user_notifications.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      // Start realtime channel scoped to this user
      const channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload: any) => {
            const row = payload.new as UserNotification;
            if (!row) return;
            setNotifications((prev) => {
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
            if (!row.is_read) {
              setUnread((u) => u + 1);
              // Mirror into the shared store so the Settings badge bumps too.
              const cur = useNotificationStore.getState().unreadCount;
              useNotificationStore.getState().setUnread(cur + 1);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'user_notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload: any) => {
            const row = payload.new as UserNotification;
            if (!row) return;
            setNotifications((prev) => prev.map((n) => (n.id === row.id ? row : n)));
          }
        )
        .subscribe();
      channelRef.current = channel;
    })();
    return () => {
      cancelled = true;
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch {}
        channelRef.current = null;
      }
    };
  }, []);

  useFocusEffect(useCallback(() => {
    fetchNotifications();
    // Light fallback poll (60s) — realtime handles instant updates;
    // polling guards against missed events when app sleeps in background.
    const interval = setInterval(() => fetchNotifications(), 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]));

  async function markAllRead() {
    if (unread === 0 || markingRead) return;
    setMarkingRead(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      await fetch(`${BACKEND_URL}/api/notifications/inbox/all/read`, {
        method: 'PUT',
        headers,
      });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
      useNotificationStore.getState().setUnread(0);
    } catch {
    } finally {
      setMarkingRead(false);
    }
  }

  async function markOneRead(id: string) {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      await fetch(`${BACKEND_URL}/api/notifications/inbox/${id}/read`, {
        method: 'PUT',
        headers,
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnread(prev => {
        const next = Math.max(0, prev - 1);
        useNotificationStore.getState().setUnread(next);
        return next;
      });
    } catch {}
  }

  function openDetail(item: UserNotification) {
    setSelected(item);
    if (!item.is_read) markOneRead(item.id);
  }

  const renderItem = ({ item, index }: { item: UserNotification; index: number }) => {
    const type = (item.data as any)?.type;
    return (
      <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 30).springify()}>
        <TouchableOpacity
          style={[styles.notifCard, !item.is_read && styles.notifCardUnread]}
          onPress={() => openDetail(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.notifIconWrap, !item.is_read && styles.notifIconWrapUnread]}>
            {iconForType(type, item.is_read)}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.notifRow}>
              <Text style={[styles.notifTitle, !item.is_read && styles.notifTitleUnread]} numberOfLines={1}>
                {item.title}
              </Text>
              {!item.is_read && <View style={styles.unreadDot} />}
            </View>
            <Text style={styles.notifBody} numberOfLines={3}>{item.body}</Text>
            <Text style={styles.notifTime}>{timeAgo(item.created_at)}</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.headerTitle}>Notifications</Text>
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unread}</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={runPushTest}
          disabled={testingPush}
          style={styles.markReadBtn}
          activeOpacity={0.7}
          accessibilityLabel="Send a test push notification to this device"
        >
          {testingPush ? (
            <ActivityIndicator size="small" color="#00F0FF" />
          ) : (
            <Send size={18} color="#00F0FF" />
          )}
        </TouchableOpacity>
        {unread > 0 && (
          <TouchableOpacity onPress={markAllRead} disabled={markingRead} style={styles.markReadBtn} activeOpacity={0.7}>
            {markingRead ? (
              <ActivityIndicator size="small" color="#00F0FF" />
            ) : (
              <CheckCheck size={18} color="#00F0FF" />
            )}
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <NotificationsSkeleton />
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <BellOff size={32} color="#334155" />
          </View>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptySubtitle}>
            You'll receive alerts here when AdRoom has important updates for you.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNotifications(true)}
              tintColor="#00F0FF"
            />
          }
          contentContainerStyle={[styles.list, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            unread > 0 ? (
              <TouchableOpacity style={styles.markAllBar} onPress={markAllRead} disabled={markingRead}>
                <CheckCheck size={14} color="#00F0FF" />
                <Text style={styles.markAllText}>Mark all as read</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* Detail modal */}
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Animated.View entering={FadeIn.duration(180)}>
              <View style={styles.modalHeader}>
                <View style={[styles.notifIconWrap, styles.notifIconWrapUnread]}>
                  {iconForType((selected?.data as any)?.type, false)}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{selected?.title}</Text>
                  {selected?.created_at && (
                    <Text style={styles.modalTime}>{formatFullDate(selected.created_at)}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setSelected(null)} style={styles.modalCloseBtn}>
                  <X size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalBodyWrap} contentContainerStyle={{ paddingBottom: 12 }}>
                <Text style={styles.modalBody}>{selected?.body}</Text>
              </ScrollView>

              <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setSelected(null)} activeOpacity={0.8}>
                <Text style={styles.modalDoneText}>Done</Text>
              </TouchableOpacity>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
  },
  backBtn: { marginRight: 14, padding: 2 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  markReadBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  unreadBadge: {
    backgroundColor: '#00F0FF', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 20, alignItems: 'center',
  },
  unreadBadgeText: { color: '#020617', fontSize: 10, fontWeight: '800' },
  list: { padding: 16 },
  markAllBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 4, marginBottom: 8,
  },
  markAllText: { color: '#00F0FF', fontSize: 12, fontWeight: '600' },
  notifCard: {
    flexDirection: 'row', gap: 12,
    backgroundColor: '#151B2B', borderRadius: 14, borderWidth: 1, borderColor: '#1E293B',
    padding: 14, marginBottom: 10,
  },
  notifCardUnread: {
    borderColor: 'rgba(0,240,255,0.2)',
    backgroundColor: 'rgba(0,240,255,0.03)',
  },
  notifIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#0B0F19', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  notifIconWrapUnread: {
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderColor: 'rgba(0,240,255,0.2)',
  },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  notifTitle: { color: '#94A3B8', fontWeight: '600', fontSize: 13, flex: 1 },
  notifTitleUnread: { color: '#E2E8F0' },
  notifBody: { color: '#64748B', fontSize: 12, lineHeight: 18, marginBottom: 6 },
  notifTime: { color: '#334155', fontSize: 11 },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#00F0FF', flexShrink: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { color: '#475569', marginTop: 12, fontSize: 13 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: '#E2E8F0', fontWeight: '700', fontSize: 16, marginBottom: 8 },
  emptySubtitle: { color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 20, maxWidth: 260 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(2,6,23,0.78)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%', maxWidth: 480, maxHeight: '80%',
    backgroundColor: '#0F172A', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
    padding: 18,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  modalTitle: { color: '#E2E8F0', fontWeight: '800', fontSize: 16 },
  modalTime: { color: '#475569', fontSize: 11, marginTop: 2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  modalBodyWrap: { maxHeight: 360 },
  modalBody: { color: '#CBD5E1', fontSize: 14, lineHeight: 22 },
  metaWrap: { marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#0B0F19', borderWidth: 1, borderColor: '#1E293B' },
  metaLabel: { color: '#64748B', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  metaKey: { color: '#64748B', fontSize: 12, textTransform: 'capitalize' },
  metaValue: { color: '#94A3B8', fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  modalDoneBtn: {
    marginTop: 14, paddingVertical: 12, borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center',
  },
  modalDoneText: { color: '#00F0FF', fontWeight: '700', fontSize: 14 },
});
