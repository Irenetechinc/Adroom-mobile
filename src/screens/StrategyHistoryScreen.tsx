import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, RefreshControl, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Menu, Play, Clock, CheckCircle2, Image as ImageIcon, Video, History, Zap, Pause } from 'lucide-react-native';
import { DrawerActions } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Skeleton } from '../components/Skeleton';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;

function HistorySkeleton() {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} scrollEnabled={false}>
      {[...Array(4)].map((_, i) => (
        <View key={i} style={{ backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B', padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <Skeleton width={60} height={22} borderRadius={8} />
            <Skeleton width={54} height={22} borderRadius={8} />
          </View>
          <Skeleton width="80%" height={16} borderRadius={4} style={{ marginBottom: 8 }} />
          <Skeleton width="100%" height={13} borderRadius={4} style={{ marginBottom: 4 }} />
          <Skeleton width="70%" height={13} borderRadius={4} style={{ marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            {[...Array(3)].map((_, j) => <Skeleton key={j} width={72} height={72} borderRadius={10} />)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton width={100} height={13} borderRadius={4} />
            <Skeleton width={90} height={13} borderRadius={4} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

interface StrategyHistoryItem {
  id: string;
  title: string;
  description: string;
  status: string;
  is_active?: boolean;
  created_at: string;
  type: 'FREE' | 'PAID';
  assets: any[];
}

export default function StrategyHistoryScreen() {
  const navigation = useNavigation();
  const [history, setHistory] = useState<StrategyHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [pausingId, setPausingId] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setInitialLoad(false); return; }

    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) setHistory(data as any);
    setLoading(false);
    setInitialLoad(false);
  };

  useEffect(() => { fetchHistory(); }, []);

  const handlePause = async (item: StrategyHistoryItem) => {
    Alert.alert(
      'Pause Strategy?',
      `Pausing "${item.title}" will stop all scheduled AI tasks until you resume.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pause',
          style: 'destructive',
          onPress: async () => {
            try {
              setPausingId(item.id);
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token || !BACKEND_URL) throw new Error('Not authenticated.');
              const res = await fetch(`${BACKEND_URL}/api/strategy/${item.id}/pause`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error || 'Failed to pause strategy.');
              }
              setHistory(prev => prev.map(s => s.id === item.id ? { ...s, status: 'paused', is_active: false } : s));
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not pause strategy. Please try again.');
            } finally {
              setPausingId(null);
            }
          },
        },
      ],
    );
  };

  const handleResume = async (item: StrategyHistoryItem) => {
    try {
      setPausingId(item.id);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !BACKEND_URL) throw new Error('Not authenticated.');
      const res = await fetch(`${BACKEND_URL}/api/strategy/${item.id}/resume`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to resume strategy.');
      }
      setHistory(prev => prev.map(s => s.id === item.id ? { ...s, status: 'active', is_active: true } : s));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not resume strategy. Please try again.');
    } finally {
      setPausingId(null);
    }
  };

  const renderAssets = (assets: any[]) => {
    if (!assets || assets.length === 0) return null;
    return (
      <View style={styles.assetsRow}>
        {assets.slice(0, 4).map((asset, idx) => (
          <View key={idx} style={styles.assetThumb}>
            <Image source={{ uri: asset.url }} style={styles.assetImage} resizeMode="cover" />
            <View style={styles.assetBadge}>
              {asset.type === 'VIDEO'
                ? <Video size={8} color="white" />
                : <ImageIcon size={8} color="white" />}
            </View>
          </View>
        ))}
        {assets.length > 4 && (
          <View style={styles.moreAssets}>
            <Text style={styles.moreAssetsText}>+{assets.length - 4}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderItem = ({ item, index }: { item: StrategyHistoryItem; index: number }) => {
    const isActive = item.status === 'active' || item.is_active;
    const isPaused = item.status === 'paused';
    const isPaid = item.type === 'PAID';
    const isLoading = pausingId === item.id;

    const statusColor = isActive ? '#00F0FF' : isPaused ? '#F59E0B' : '#64748B';
    const statusBg = isActive
      ? 'rgba(0,240,255,0.08)'
      : isPaused
      ? 'rgba(245,158,11,0.08)'
      : 'rgba(100,116,139,0.08)';
    const statusBorder = isActive
      ? 'rgba(0,240,255,0.2)'
      : isPaused
      ? 'rgba(245,158,11,0.2)'
      : 'rgba(100,116,139,0.15)';

    return (
      <Animated.View entering={FadeInDown.delay(index * 70).springify()}>
        <View style={styles.card}>
          {/* Card Header */}
          <View style={styles.cardHeader}>
            <View style={[styles.typeTag, { backgroundColor: isPaid ? 'rgba(112,0,255,0.12)' : 'rgba(16,185,129,0.12)' }]}>
              <Text style={[styles.typeTagText, { color: isPaid ? '#A78BFA' : '#34D399' }]}>
                {item.type}
              </Text>
            </View>
            <View style={[styles.statusTag, { backgroundColor: statusBg, borderColor: statusBorder }]}>
              {isActive
                ? <Play size={10} color={statusColor} fill={statusColor} />
                : isPaused
                ? <Pause size={10} color={statusColor} />
                : <CheckCircle2 size={10} color={statusColor} />}
              <Text style={[styles.statusTagText, { color: statusColor }]}>
                {isActive ? 'Live' : isPaused ? 'Paused' : 'Ended'}
              </Text>
            </View>
          </View>

          {/* Title & Description */}
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>

          {/* Assets */}
          {renderAssets(item.assets)}

          {/* Footer */}
          <View style={styles.cardFooter}>
            <View style={styles.dateRow}>
              <Clock size={12} color="#475569" style={{ marginRight: 5 }} />
              <Text style={styles.dateText}>{new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            </View>

            {(isActive || isPaused) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {isActive && (
                  <View style={styles.aiMonitor}>
                    <View style={styles.aiMonitorDot} />
                    <Text style={styles.aiMonitorText}>AI Monitoring</Text>
                  </View>
                )}
                {isActive && (
                  <TouchableOpacity
                    onPress={() => handlePause(item)}
                    disabled={isLoading}
                    style={styles.pauseBtn}
                    activeOpacity={0.75}
                  >
                    {isLoading
                      ? <ActivityIndicator size="small" color="#F59E0B" />
                      : <>
                          <Pause size={11} color="#F59E0B" />
                          <Text style={styles.pauseBtnText}>Pause</Text>
                        </>}
                  </TouchableOpacity>
                )}
                {isPaused && (
                  <TouchableOpacity
                    onPress={() => handleResume(item)}
                    disabled={isLoading}
                    style={styles.resumeBtn}
                    activeOpacity={0.75}
                  >
                    {isLoading
                      ? <ActivityIndicator size="small" color="#10B981" />
                      : <>
                          <Play size={11} color="#10B981" />
                          <Text style={styles.resumeBtnText}>Resume</Text>
                        </>}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.backBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Strategy History</Text>
        </View>
        <View style={styles.countBadge}>
          <History size={12} color="#00F0FF" />
          <Text style={styles.countText}>{history.length}</Text>
        </View>
      </View>

      {initialLoad ? (
        <HistorySkeleton />
      ) : (
        <FlatList
          data={history}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchHistory} tintColor="#00F0FF" />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <History size={32} color="#1E293B" />
              </View>
              <Text style={styles.emptyTitle}>No strategies yet</Text>
              <Text style={styles.emptySubtitle}>Your launched campaigns and strategies will appear here.</Text>
            </View>
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
  backBtn: { marginRight: 14, padding: 4 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  countBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, gap: 5,
  },
  countText: { color: '#00F0FF', fontWeight: '700', fontSize: 13 },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#151B2B', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E293B', padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeTagText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  statusTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  statusTagText: { fontSize: 11, fontWeight: '600' },
  cardTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 5 },
  cardDesc: { color: '#64748B', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  assetsRow: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  assetThumb: { position: 'relative', width: 60, height: 60, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)' },
  assetImage: { width: '100%', height: '100%' },
  assetBadge: {
    position: 'absolute', bottom: 3, right: 3,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: 2,
  },
  moreAssets: {
    width: 60, height: 60, borderRadius: 10,
    backgroundColor: '#0B0F19', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  moreAssetsText: { color: '#94A3B8', fontWeight: '700', fontSize: 13 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1E293B',
  },
  dateRow: { flexDirection: 'row', alignItems: 'center' },
  dateText: { color: '#475569', fontSize: 12 },
  aiMonitor: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiMonitorDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00F0FF' },
  aiMonitorText: { color: '#00F0FF', fontSize: 11, fontWeight: '600' },
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  pauseBtnText: { color: '#F59E0B', fontSize: 11, fontWeight: '700' },
  resumeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)',
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  resumeBtnText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 24,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 17, marginBottom: 8 },
  emptySubtitle: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
