import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAuthStore } from '../store/authStore';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, RefreshCw, Zap, MessageSquare, FileText, Users, Radio } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra?.apiUrl as string) || '';

type Props = NativeStackScreenProps<RootStackParamList, 'APMADashboard'>;

interface DashboardData {
  client: { name: string; goal: string; status: string };
  campaign: {
    id: string; name: string; status: string; start_date: string;
    narrative_score_current: number; narrative_score_target: number; score_delta: number;
    campaign_type?: string; campaign_subtype?: string; duration_months?: number;
  };
  sentiment_trend: Array<{ date: string; score: number }>;
  top_themes: Array<{ theme: string; sentiment: 'positive' | 'negative'; volume: number }>;
  actions_24h: { posts: number; comments: number; blog_articles: number; group_engagements: number; total: number };
  recommendations: Array<{ id: string; text: string; priority: string; status: string; created_at: string }>;
}

function ScoreArc({ score, target }: { score: number; target: number }) {
  const pct = Math.max(0, Math.min(1, (score + 1) / 2));
  const color = score >= 0.3 ? '#22C55E' : score >= 0 ? '#F59E0B' : '#EF4444';
  return (
    <View style={sa.arcContainer}>
      <View style={sa.arcBg}>
        <View style={[sa.arcFill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[sa.scoreVal, { color }]}>{score >= 0 ? '+' : ''}{(score * 100).toFixed(1)}</Text>
      <Text style={sa.scoreLabel}>Narrative Score</Text>
      <Text style={sa.scoreTarget}>Target: {target >= 0 ? '+' : ''}{(target * 100).toFixed(1)}</Text>
    </View>
  );
}

export default function APMADashboardScreen({ navigation, route }: Props) {
  const { clientId, clientName } = route.params;
  const { session } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sseStatus, setSseStatus] = useState<string>('');
  const [cycleLog, setCycleLog] = useState<string[]>([]);
  const [showLiveFeed, setShowLiveFeed] = useState(false);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const token = session?.access_token;
      const resp = await fetch(`${BACKEND_URL}/api/apma/mobile/dashboard/${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to load');
      const d = await resp.json();
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clientId, session]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  useEffect(() => {
    if (!showLiveFeed) return;
    const token = session?.access_token;
    const url = `${BACKEND_URL}/admin/api/apma/cycle-monitor`;
    let es: EventSource;
    try {
      es = new (require('react-native/Libraries/Network/EventSource').default ?? EventSource)(url);
      es.onopen = () => setSseStatus('Connected');
      es.addEventListener('apma_cycle', (e: any) => {
        try {
          const d = JSON.parse(e.data);
          const msg = `[${d.step}] ${d.client || d.campaign || ''} ${d.message || ''} ${d.executed !== undefined ? `✓${d.executed} ✗${d.failed}` : ''}`.trim();
          setCycleLog(prev => [msg, ...prev].slice(0, 50));
        } catch {}
      });
      es.onerror = () => setSseStatus('Disconnected');
    } catch {
      setSseStatus('SSE not supported in this environment');
    }
    return () => { try { es?.close(); } catch {} };
  }, [showLiveFeed, session]);

  const onRefresh = () => { setRefreshing(true); fetchDashboard(true); };

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.loadingCenter}>
          <ActivityIndicator size="large" color="#00F0FF" />
          <Text style={s.loadingText}>Loading campaign...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const priorityColor = (p: string) =>
    p === 'critical' ? '#EF4444' : p === 'high' ? '#F59E0B' : p === 'medium' ? '#818CF8' : '#64748B';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{clientName}</Text>
          <Text style={s.headerSub}>APMA Campaign Dashboard</Text>
        </View>
        <TouchableOpacity style={s.refreshBtn} onPress={onRefresh}>
          <RefreshCw size={16} color="#00F0FF" />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => fetchDashboard()}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />}
      >
        {data && (
          <>
            {/* Campaign Info */}
            <View style={s.campBadge}>
              <Text style={s.campBadgeType}>{(data.campaign.campaign_type || 'campaign').replace(/_/g, ' ').toUpperCase()}</Text>
              <Text style={s.campBadgeSep}>·</Text>
              <Text style={s.campBadgeSub}>{data.campaign.campaign_subtype || ''}</Text>
              <View style={[s.statusDot, { backgroundColor: data.campaign.status === 'active' ? '#22C55E' : '#F59E0B' }]} />
              <Text style={[s.campStatus, { color: data.campaign.status === 'active' ? '#22C55E' : '#F59E0B' }]}>
                {data.campaign.status.toUpperCase()}
              </Text>
            </View>

            {/* Narrative Score */}
            <ScoreArc score={data.campaign.narrative_score_current} target={data.campaign.narrative_score_target} />

            {/* Delta */}
            <View style={s.deltaRow}>
              {data.campaign.score_delta > 0
                ? <TrendingUp size={16} color="#22C55E" />
                : data.campaign.score_delta < 0
                ? <TrendingDown size={16} color="#EF4444" />
                : <Minus size={16} color="#64748B" />}
              <Text style={[s.deltaText, { color: data.campaign.score_delta >= 0 ? '#22C55E' : '#EF4444' }]}>
                {data.campaign.score_delta >= 0 ? '+' : ''}{(data.campaign.score_delta * 100).toFixed(1)} pts since start
              </Text>
            </View>

            {/* Actions 24h */}
            <Text style={s.sectionTitle}>Actions — Last 24 Hours</Text>
            <View style={s.statsGrid}>
              {[
                { label: 'Posts', value: data.actions_24h.posts, color: '#00F0FF', Icon: Zap },
                { label: 'Comments', value: data.actions_24h.comments, color: '#818CF8', Icon: MessageSquare },
                { label: 'Blog Articles', value: data.actions_24h.blog_articles, color: '#22C55E', Icon: FileText },
                { label: 'Group Posts', value: data.actions_24h.group_engagements, color: '#F59E0B', Icon: Users },
              ].map(({ label, value, color, Icon }) => (
                <View key={label} style={s.statCard}>
                  <Icon size={18} color={color} />
                  <Text style={[s.statValue, { color }]}>{value}</Text>
                  <Text style={s.statLabel}>{label}</Text>
                </View>
              ))}
            </View>

            {/* Sentiment Trend */}
            {data.sentiment_trend.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Sentiment Trend</Text>
                <View style={s.trendRow}>
                  {data.sentiment_trend.slice(-14).map((pt, i) => {
                    const h = Math.max(4, Math.abs(pt.score) * 60 + 4);
                    const c = pt.score >= 0.2 ? '#22C55E' : pt.score >= 0 ? '#F59E0B' : '#EF4444';
                    return <View key={i} style={[s.trendBar, { height: h, backgroundColor: c }]} />;
                  })}
                </View>
              </>
            )}

            {/* Top Themes */}
            {data.top_themes.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Top Themes</Text>
                {data.top_themes.slice(0, 6).map((th) => (
                  <View key={th.theme} style={s.themeRow}>
                    <View style={[s.themeDot, { backgroundColor: th.sentiment === 'positive' ? '#22C55E' : '#EF4444' }]} />
                    <Text style={s.themeLabel}>{th.theme.replace(/_/g, ' ')}</Text>
                    <Text style={s.themeVol}>{th.volume} mentions</Text>
                  </View>
                ))}
              </>
            )}

            {/* Recommendations */}
            {data.recommendations.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Recommendations</Text>
                {data.recommendations.slice(0, 5).map((rec) => (
                  <View key={rec.id} style={s.recCard}>
                    <View style={[s.recPriority, { backgroundColor: priorityColor(rec.priority) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.recText}>{rec.text}</Text>
                      <Text style={s.recStatus}>{rec.priority.toUpperCase()} · {rec.status}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Live Feed Toggle */}
            <TouchableOpacity style={s.liveToggle} onPress={() => setShowLiveFeed(v => !v)}>
              <Radio size={16} color={showLiveFeed ? '#00F0FF' : '#475569'} />
              <Text style={[s.liveToggleText, showLiveFeed && { color: '#00F0FF' }]}>
                Live Cycle Monitor {showLiveFeed ? `(${sseStatus})` : ''}
              </Text>
            </TouchableOpacity>

            {showLiveFeed && (
              <View style={s.logContainer}>
                {cycleLog.length === 0
                  ? <Text style={s.logEmpty}>Waiting for next APMA cycle...</Text>
                  : cycleLog.map((line, i) => (
                    <Text key={i} style={s.logLine}>{line}</Text>
                  ))
                }
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const sa = StyleSheet.create({
  arcContainer: { alignItems: 'center', paddingVertical: 20, marginBottom: 4 },
  arcBg: { width: '100%', height: 10, backgroundColor: '#1E293B', borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  arcFill: { height: '100%', borderRadius: 8 },
  scoreVal: { fontSize: 48, fontWeight: '900' },
  scoreLabel: { color: '#64748B', fontSize: 13, marginTop: 2 },
  scoreTarget: { color: '#475569', fontSize: 12, marginTop: 4 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#64748B', fontSize: 14, marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  headerTitle: { color: '#E2E8F0', fontWeight: '800', fontSize: 16 },
  headerSub: { color: '#475569', fontSize: 11 },
  refreshBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  errorBox: { margin: 16, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  errorText: { color: '#F87171', fontSize: 13, flex: 1 },
  retryText: { color: '#00F0FF', fontSize: 13, fontWeight: '700', marginLeft: 12 },
  campBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 4 },
  campBadgeType: { color: '#818CF8', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  campBadgeSep: { color: '#475569' },
  campBadgeSub: { color: '#475569', fontSize: 11, textTransform: 'capitalize' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginLeft: 4 },
  campStatus: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 24 },
  deltaText: { fontSize: 14, fontWeight: '700' },
  sectionTitle: { color: '#64748B', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 10, marginTop: 8 },
  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#151B2B', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', padding: 12, alignItems: 'center', gap: 6 },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#475569', fontSize: 11, textAlign: 'center' },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 70, marginBottom: 20 },
  trendBar: { flex: 1, borderRadius: 3, minHeight: 4 },
  themeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  themeDot: { width: 8, height: 8, borderRadius: 4 },
  themeLabel: { flex: 1, color: '#CBD5E1', fontSize: 13, textTransform: 'capitalize' },
  themeVol: { color: '#475569', fontSize: 12 },
  recCard: { flexDirection: 'row', gap: 12, backgroundColor: '#151B2B', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', padding: 14, marginBottom: 8 },
  recPriority: { width: 3, borderRadius: 2 },
  recText: { color: '#CBD5E1', fontSize: 13, lineHeight: 18 },
  recStatus: { color: '#475569', fontSize: 11, marginTop: 4, fontWeight: '600' },
  liveToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#151B2B', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B' },
  liveToggleText: { color: '#475569', fontSize: 14, fontWeight: '600' },
  logContainer: { backgroundColor: '#0D1117', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', padding: 12, marginBottom: 16, maxHeight: 240 },
  logEmpty: { color: '#475569', fontSize: 12, fontStyle: 'italic', textAlign: 'center', paddingVertical: 16 },
  logLine: { color: '#94A3B8', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, paddingVertical: 1 },
});
