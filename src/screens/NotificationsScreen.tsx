import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Bell, BellOff, CheckCheck } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase } from '../services/supabase';
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

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);

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
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchNotifications();
    // Poll every 30 seconds while screen is focused
    const interval = setInterval(() => fetchNotifications(), 30000);
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
      setUnread(prev => Math.max(0, prev - 1));
    } catch {}
  }

  const renderItem = ({ item, index }: { item: UserNotification; index: number }) => (
    <Animated.View entering={FadeInDown.delay(index * 40).springify()}>
      <TouchableOpacity
        style={[styles.notifCard, !item.is_read && styles.notifCardUnread]}
        onPress={() => !item.is_read && markOneRead(item.id)}
        activeOpacity={item.is_read ? 1 : 0.8}
      >
        <View style={[styles.notifIconWrap, !item.is_read && styles.notifIconWrapUnread]}>
          <Bell size={16} color={item.is_read ? '#475569' : '#00F0FF'} />
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
});
