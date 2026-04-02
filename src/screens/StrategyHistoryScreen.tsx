import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Play, Clock, CheckCircle2, Image as ImageIcon, Video, History, Zap } from 'lucide-react-native';
import { supabase } from '../services/supabase';
import Animated, { FadeInDown } from 'react-native-reanimated';

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
  const [loading, setLoading] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) setHistory(data as any);
    setLoading(false);
  };

  useEffect(() => { fetchHistory(); }, []);

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
    const isPaid = item.type === 'PAID';

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
            <View style={[styles.statusTag, isActive
              ? { backgroundColor: 'rgba(0,240,255,0.08)', borderColor: 'rgba(0,240,255,0.2)' }
              : { backgroundColor: 'rgba(100,116,139,0.08)', borderColor: 'rgba(100,116,139,0.15)' }
            ]}>
              {isActive
                ? <Play size={10} color="#00F0FF" fill="#00F0FF" />
                : <CheckCircle2 size={10} color="#64748B" />}
              <Text style={[styles.statusTagText, { color: isActive ? '#00F0FF' : '#64748B' }]}>
                {isActive ? 'Live' : 'Ended'}
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

            {isActive && (
              <View style={styles.aiMonitor}>
                <View style={styles.aiMonitorDot} />
                <Text style={styles.aiMonitorText}>AI Monitoring</Text>
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#E2E8F0" size={22} />
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
          !loading ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <History size={32} color="#1E293B" />
              </View>
              <Text style={styles.emptyTitle}>No strategies yet</Text>
              <Text style={styles.emptySubtitle}>Your launched campaigns and strategies will appear here.</Text>
            </View>
          ) : null
        }
      />
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
  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 24,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 17, marginBottom: 8 },
  emptySubtitle: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
