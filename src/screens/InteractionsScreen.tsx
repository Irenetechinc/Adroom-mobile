import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { DrawerActions } from '@react-navigation/native';
import {
  Menu, MessageSquare, Heart, CornerDownRight,
  ThumbsUp, Edit3, Wifi, WifiOff, RefreshCw,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { Skeleton } from '../components/Skeleton';

function InteractionsSkeleton() {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} scrollEnabled={false}>
      {[...Array(5)].map((_, i) => (
        <View key={i} style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 14, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Skeleton width={38} height={38} borderRadius={10} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="50%" height={13} borderRadius={4} />
              <Skeleton width="35%" height={11} borderRadius={4} />
            </View>
          </View>
          <View style={{ backgroundColor: '#0B0F19', borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <Skeleton width="100%" height={12} borderRadius={4} style={{ marginBottom: 5 }} />
            <Skeleton width="75%" height={12} borderRadius={4} />
          </View>
          <View style={{ backgroundColor: 'rgba(0,240,255,0.04)', borderRadius: 10, padding: 10 }}>
            <Skeleton width="30%" height={11} borderRadius={4} style={{ marginBottom: 6 }} />
            <Skeleton width="90%" height={12} borderRadius={4} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

type InteractionType = 'comment' | 'message' | 'reply';

interface Interaction {
  id: string;
  type: InteractionType;
  platform: string;
  clientName: string;
  content: string;
  adroomReply?: string;
  isReplied: boolean;
  isLiked: boolean;
  parentId?: string;
  externalId?: string;
  createdAt: string;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function platformColor(platform: string): string {
  switch (platform?.toLowerCase()) {
    case 'facebook': return '#1877F2';
    case 'instagram': return '#E1306C';
    case 'tiktok': return '#010101';
    case 'twitter':
    case 'x': return '#1DA1F2';
    case 'linkedin': return '#0A66C2';
    case 'whatsapp': return '#25D366';
    default: return '#475569';
  }
}

function platformInitial(platform: string): string {
  switch (platform?.toLowerCase()) {
    case 'facebook': return 'f';
    case 'instagram': return 'IG';
    case 'tiktok': return 'T';
    case 'twitter':
    case 'x': return 'X';
    case 'linkedin': return 'in';
    case 'whatsapp': return 'WA';
    default: return platform?.[0]?.toUpperCase() || '?';
  }
}

const InteractionCard = ({ item, index }: { item: Interaction; index: number }) => {
  const pColor = platformColor(item.platform);

  return (
    <Animated.View entering={FadeInDown.delay(index * 40).springify()}>
      <View style={styles.card}>
        {/* Platform badge + client name row */}
        <View style={styles.cardHeader}>
          <View style={[styles.platformBadge, { backgroundColor: pColor }]}>
            <Text style={styles.platformLetter}>{platformInitial(item.platform)}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.clientName}>{item.clientName || 'Anonymous'}</Text>
            <Text style={styles.metaRow}>
              <Text style={[styles.typeTag, { color: item.type === 'message' ? '#A78BFA' : item.type === 'reply' ? '#60A5FA' : '#34D399' }]}>
                {item.type === 'reply' ? 'Reply' : item.type === 'message' ? 'Message' : 'Comment'}
              </Text>
              {'  ·  '}
              <Text style={styles.timestamp}>{timeAgo(item.createdAt)}</Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {item.isLiked && (
              <View style={styles.iconBadge}>
                <ThumbsUp size={10} color="#F59E0B" />
              </View>
            )}
            {item.isReplied && (
              <View style={styles.iconBadge}>
                <Edit3 size={10} color="#10B981" />
              </View>
            )}
          </View>
        </View>

        {/* Client message */}
        <View style={styles.clientBubble}>
          {item.type === 'reply' && (
            <CornerDownRight size={11} color="#60A5FA" style={{ marginBottom: 3 }} />
          )}
          <Text style={styles.clientText}>{item.content}</Text>
        </View>

        {/* AdRoom reply */}
        {item.adroomReply ? (
          <View style={styles.adroomBubble}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <View style={styles.adroomDot} />
              <Text style={styles.adroomLabel}>AdRoom AI replied</Text>
            </View>
            <Text style={styles.adroomText}>{item.adroomReply}</Text>
          </View>
        ) : (
          <View style={styles.pendingRow}>
            <ActivityIndicator size={8} color="#64748B" />
            <Text style={styles.pendingText}>Awaiting reply…</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
};

export default function InteractionsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<any>(null);

  const mapComment = (row: any): Interaction => ({
    id: row.id,
    type: row.parent_id ? 'reply' : 'comment',
    platform: row.platform || 'facebook',
    clientName: row.author_name || 'User',
    content: row.content || '',
    adroomReply: row.reply_content || undefined,
    isReplied: !!row.is_replied,
    isLiked: !!row.is_liked,
    parentId: row.parent_id || undefined,
    externalId: row.external_id || undefined,
    createdAt: row.created_at,
  });

  const mapMessage = (row: any): Interaction => ({
    id: row.id,
    type: 'message',
    platform: row.platform || 'facebook',
    clientName: row.sender_name || 'User',
    content: row.content || '',
    adroomReply: row.reply_content || (row.is_replied ? '(replied via AdRoom AI)' : undefined),
    isReplied: !!row.is_replied,
    isLiked: !!row.is_liked,
    createdAt: row.created_at,
  });

  const loadInteractions = useCallback(async () => {
    if (!isSupabaseConfigured || !user) return;

    try {
      const [commentsRes, messagesRes] = await Promise.all([
        supabase
          .from('comments')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('messages')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60),
      ]);

      const comments: Interaction[] = (commentsRes.data || []).map(mapComment);
      const messages: Interaction[] = (messagesRes.data || []).map(mapMessage);

      const all = [...comments, ...messages].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setInteractions(all);
    } catch (e) {
      console.error('[Interactions] Load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const subscribeRealtime = useCallback(() => {
    if (!isSupabaseConfigured || !user) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`interactions-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `user_id=eq.${user.id}` },
        () => { loadInteractions(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `user_id=eq.${user.id}` },
        () => { loadInteractions(); }
      )
      .subscribe((status: string) => {
        setConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;
  }, [user, loadInteractions]);

  useEffect(() => {
    loadInteractions();
    subscribeRealtime();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [loadInteractions, subscribeRealtime]);

  const onRefresh = () => {
    setRefreshing(true);
    loadInteractions();
  };

  const commentCount = interactions.filter(i => i.type === 'comment').length;
  const messageCount = interactions.filter(i => i.type === 'message').length;
  const replyCount = interactions.filter(i => i.type === 'reply').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.menuBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Interactions</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.liveBadge, { borderColor: connected ? 'rgba(16,185,129,0.4)' : 'rgba(100,116,139,0.3)' }]}>
            {connected ? (
              <Wifi size={11} color="#10B981" />
            ) : (
              <WifiOff size={11} color="#64748B" />
            )}
            <Text style={[styles.liveText, { color: connected ? '#10B981' : '#64748B' }]}>
              {connected ? 'Live' : 'Offline'}
            </Text>
          </View>
          <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
            <RefreshCw size={15} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        {[
          { label: 'Comments', count: commentCount, color: '#34D399' },
          { label: 'Messages', count: messageCount, color: '#A78BFA' },
          { label: 'Replies', count: replyCount, color: '#60A5FA' },
        ].map((s) => (
          <View key={s.label} style={styles.statCard}>
            <Text style={[styles.statCount, { color: s.color }]}>{s.count}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <InteractionsSkeleton />
      ) : interactions.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <View style={styles.emptyIcon}>
            <MessageSquare size={32} color="#1E293B" />
          </View>
          <Text style={styles.emptyTitle}>No interactions yet</Text>
          <Text style={styles.emptySubtitle}>
            Comments, messages, and replies from all connected platforms will appear here in real time.
          </Text>
        </View>
      ) : (
        <FlatList
          data={interactions}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <InteractionCard item={item} index={index} />}
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#00F0FF"
              colors={['#00F0FF']}
            />
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
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
    backgroundColor: '#0B0F19',
  },
  menuBtn: { marginRight: 14, padding: 4 },
  headerLabel: { color: '#64748B', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 1 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4,
  },
  liveText: { fontSize: 10, fontWeight: '700' },
  refreshBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 8,
  },
  statCard: {
    flex: 1, backgroundColor: '#151B2B', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B',
    paddingVertical: 10, alignItems: 'center',
  },
  statCount: { fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#475569', fontSize: 10, fontWeight: '600', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B',
    padding: 14, marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  platformBadge: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  platformLetter: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  clientName: { color: '#E2E8F0', fontWeight: '700', fontSize: 14 },
  metaRow: { marginTop: 2, fontSize: 11 },
  typeTag: { fontWeight: '700', fontSize: 11 },
  timestamp: { color: '#475569', fontSize: 11 },
  iconBadge: {
    width: 22, height: 22, borderRadius: 6,
    backgroundColor: 'rgba(30,41,59,0.8)',
    borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  clientBubble: {
    backgroundColor: '#0B0F19', borderRadius: 10,
    borderWidth: 1, borderColor: '#1E293B',
    padding: 10, marginBottom: 8,
  },
  clientText: { color: '#94A3B8', fontSize: 13, lineHeight: 19 },
  adroomBubble: {
    backgroundColor: 'rgba(0,240,255,0.05)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.12)',
    padding: 10,
  },
  adroomDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#00F0FF',
  },
  adroomLabel: { color: '#00F0FF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  adroomText: { color: '#E2E8F0', fontSize: 13, lineHeight: 19, marginTop: 2 },
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4, marginTop: 2,
  },
  pendingText: { color: '#475569', fontSize: 11 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: '#E2E8F0', fontWeight: '700', fontSize: 18, marginBottom: 8 },
  emptySubtitle: { color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
