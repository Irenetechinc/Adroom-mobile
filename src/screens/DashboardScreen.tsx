import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

import { DrawerActions } from '@react-navigation/native';
import {
  Zap, AlertTriangle, TrendingUp, Plus, Activity,
  Target, Eye, MousePointer, Menu, RefreshCw,
} from 'lucide-react-native';


export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuthStore();

  const [activeStrategies, setActiveStrategies] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [stats, setStats] = useState({
    reach: 0,
    engagements: 0,
    conversations: 0,
    activeCount: 0
  });

  const fetchData = async () => {
    if (!session?.user) return;
    setLoading(true);
    try {

      const { data: strategies } = await supabase
        .from('strategy_memory')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      setActiveStrategies(strategies || []);

      const { data: ipeLogs } = await supabase
        .from('ipe_intelligence_log')
        .select('*')
        .gte('priority', 1)
        .order('timestamp', { ascending: false })
        .limit(5);
      setAlerts(ipeLogs || []);
    } catch (e) {
      console.error('Dashboard error:', e);

    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [session]);
  const onRefresh = () => { setRefreshing(true); fetchData(); };


  const totalImpressions = activeStrategies.reduce((a, s) => a + (s.total_impressions || 0), 0);
  const totalClicks = activeStrategies.reduce((a, s) => a + (s.total_clicks || 0), 0);
  const totalConversions = activeStrategies.reduce((a, s) => a + (s.total_conversions || 0), 0);


  const InterventionCard = ({ item }: { item: any }) => (
    <View className="bg-adroom-card p-4 rounded-xl border border-adroom-neon/10 mb-3">
      <View className="flex-row items-center mb-2">
        <Activity size={14} color="#00F0FF" />
        <Text className="text-adroom-neon text-[10px] font-bold uppercase ml-2">Agent Intervention</Text>
      </View>
      <Text className="text-white font-bold text-sm mb-1">{item.action_taken}</Text>
      <Text className="text-adroom-text-muted text-xs leading-4">{item.problem_detected}</Text>
      <Text className="text-adroom-text-muted/40 text-[10px] mt-2 italic">Strategy: {item.strategies?.title}</Text>
    </View>
  );

  return (

    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.menuBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Dashboard</Text>

        </View>
        <TouchableOpacity onPress={fetchData} style={styles.refreshBtn}>
          <RefreshCw size={18} color={loading ? '#00F0FF' : '#64748B'} />
        </TouchableOpacity>
      </View>


      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Status bar */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.statusBar}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>
            {loading ? 'Syncing AI Brain...' : 'System Operational'}
          </Text>
          <Text style={styles.statusCount}>{activeStrategies.length} active</Text>
        </Animated.View>

        {/* Stats Row */}
        <Animated.View entering={FadeInDown.delay(150).springify()} style={styles.statsRow}>
          {[
            { label: 'Impressions', value: totalImpressions.toLocaleString(), icon: Eye, color: '#00F0FF' },
            { label: 'Clicks', value: totalClicks.toLocaleString(), icon: MousePointer, color: '#7000FF' },
            { label: 'Conversions', value: totalConversions.toLocaleString(), icon: Target, color: '#10B981' },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <View key={i} style={styles.statCard}>
                <View style={[styles.statIcon, { backgroundColor: `${stat.color}15` }]}>
                  <Icon size={16} color={stat.color} />
                </View>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            );
          })}
        </Animated.View>

        {/* New Strategy CTA */}
        <Animated.View entering={FadeInDown.delay(200).springify()}>
          <TouchableOpacity
            onPress={() => navigation.navigate({ name: 'AgentChat', params: { fromStrategyApproval: false } })}
            style={styles.ctaBtn}
            activeOpacity={0.85}
          >
            <View style={styles.ctaIconWrap}>
              <Plus size={20} color="#0B0F19" strokeWidth={2.5} />
            </View>
            <Text style={styles.ctaText}>Create New Strategy</Text>
            <Zap size={18} color="rgba(0,0,0,0.3)" />
          </TouchableOpacity>
        </Animated.View>

        {/* Active Strategies */}
        <Animated.View entering={FadeInDown.delay(260).springify()} style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Zap size={18} color="#00F0FF" />
              <Text style={styles.sectionTitle}>Active Strategies</Text>
            </View>
            <Text style={styles.sectionCount}>{activeStrategies.length}</Text>

          </View>

          {activeStrategies.length > 0 ? (
            activeStrategies.map((strategy, index) => (
              <Animated.View key={strategy.strategy_id} entering={FadeInRight.delay(300 + index * 60).springify()}>
                <View style={styles.strategyCard}>
                  <View style={styles.strategyCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.strategyName} numberOfLines={1}>{strategy.strategy_name}</Text>
                      <View style={styles.strategyMeta}>
                        <Text style={styles.strategyMetaText}>{strategy.goal}</Text>
                        <Text style={styles.strategyMetaDot}>•</Text>
                        <Text style={styles.strategyMetaText}>{strategy.strategy_version}</Text>
                      </View>
                    </View>
                    <View style={[
                      styles.strategyBadge,
                      { backgroundColor: strategy.strategy_version === 'paid' ? 'rgba(112,0,255,0.15)' : 'rgba(16,185,129,0.15)' }
                    ]}>
                      <View style={[
                        styles.strategyBadgeDot,
                        { backgroundColor: strategy.strategy_version === 'paid' ? '#7000FF' : '#10B981' }
                      ]} />
                      <Text style={[
                        styles.strategyBadgeText,
                        { color: strategy.strategy_version === 'paid' ? '#A78BFA' : '#34D399' }
                      ]}>
                        {strategy.strategy_version?.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.strategyStats}>
                    {[
                      { label: 'Impressions', value: strategy.total_impressions || 0 },
                      { label: 'Clicks', value: strategy.total_clicks || 0 },
                      { label: 'Conversions', value: strategy.total_conversions || 0 },
                    ].map((s, i) => (
                      <View key={i} style={[styles.strategyStatItem, i < 2 && styles.strategyStatBorder]}>
                        <Text style={styles.strategyStatValue}>{s.value.toLocaleString()}</Text>
                        <Text style={styles.strategyStatLabel}>{s.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Live indicator */}
                  <View style={styles.liveIndicator}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>AI Monitor Active</Text>
                  </View>
                </View>
              </Animated.View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Zap size={32} color="#1E293B" />
              <Text style={styles.emptyTitle}>No active strategies</Text>
              <Text style={styles.emptySubtitle}>Tap "Create New Strategy" to get started</Text>

            </View>
          )}
        </Animated.View>


        {/* Intelligence Feed */}
        <Animated.View entering={FadeInDown.delay(340).springify()} style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TrendingUp size={18} color="#F59E0B" />
              <Text style={styles.sectionTitle}>Platform Intelligence</Text>
            </View>
          </View>

          <View style={styles.alertsCard}>

            {alerts.length > 0 ? (
              alerts.map((alert, i) => (
                <View key={alert.id} style={[styles.alertItem, i < alerts.length - 1 && styles.alertBorder]}>
                  <View style={styles.alertIcon}>
                    <AlertTriangle size={14} color="#F59E0B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertSummary} numberOfLines={2}>{alert.summary}</Text>
                    <Text style={styles.alertMeta}>
                      {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {alert.platform ? ` • ${alert.platform}` : ''}
                    </Text>
                  </View>
                </View>
              ))
            ) : (

              <View style={styles.noAlerts}>
                <Activity size={20} color="#1E293B" />
                <Text style={styles.noAlertsText}>No intelligence alerts detected</Text>
              </View>

            )}
          </View>
        </Animated.View>
      </ScrollView>
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
  menuBtn: { marginRight: 14, padding: 2 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1E293B',
  },
  scrollContent: { padding: 16, paddingBottom: 40 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#151B2B', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginRight: 8 },
  statusText: { flex: 1, color: '#94A3B8', fontSize: 13, fontWeight: '500' },
  statusCount: { color: '#00F0FF', fontSize: 13, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row', gap: 8, marginBottom: 16,
  },
  statCard: {
    flex: 1, backgroundColor: '#151B2B', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E293B', padding: 14, alignItems: 'center',
  },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginBottom: 2 },
  statLabel: { color: '#64748B', fontSize: 10, fontWeight: '500', textAlign: 'center' },
  ctaBtn: {
    backgroundColor: '#00F0FF', borderRadius: 14, height: 52,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 20,
  },
  ctaIconWrap: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  ctaText: { flex: 1, color: '#0B0F19', fontWeight: '800', fontSize: 16 },
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  sectionTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginLeft: 8 },
  sectionCount: {
    color: '#00F0FF', fontWeight: '700', fontSize: 13,
    backgroundColor: 'rgba(0,240,255,0.1)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  strategyCard: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', marginBottom: 10, overflow: 'hidden',
  },
  strategyCardTop: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 16, paddingBottom: 12,
  },
  strategyName: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  strategyMeta: { flexDirection: 'row', alignItems: 'center' },
  strategyMetaText: { color: '#64748B', fontSize: 12, textTransform: 'capitalize' },
  strategyMetaDot: { color: '#334155', marginHorizontal: 6, fontSize: 12 },
  strategyBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  strategyBadgeDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 5 },
  strategyBadgeText: { fontSize: 10, fontWeight: '700' },
  strategyStats: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1E293B',
  },
  strategyStatItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  strategyStatBorder: { borderRightWidth: 1, borderRightColor: '#1E293B' },
  strategyStatValue: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 2 },
  strategyStatLabel: { color: '#64748B', fontSize: 10 },
  liveIndicator: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: 'rgba(0,240,255,0.04)', borderTopWidth: 1, borderTopColor: '#1E293B',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00F0FF', marginRight: 8 },
  liveText: { color: '#00F0FF', fontSize: 11, fontWeight: '600' },
  emptyCard: {
    backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', paddingVertical: 40,
  },
  emptyTitle: { color: '#475569', fontWeight: '600', fontSize: 15, marginTop: 12 },
  emptySubtitle: { color: '#334155', fontSize: 12, marginTop: 4 },
  alertsCard: {
    backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  alertItem: { flexDirection: 'row', alignItems: 'flex-start', padding: 14 },
  alertBorder: { borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  alertIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  alertSummary: { color: '#E2E8F0', fontSize: 13, fontWeight: '500', lineHeight: 18, marginBottom: 4 },
  alertMeta: { color: '#64748B', fontSize: 11 },
  noAlerts: { alignItems: 'center', paddingVertical: 32 },
  noAlertsText: { color: '#334155', fontSize: 13, marginTop: 8 },
});
