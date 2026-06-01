import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, RefreshControl,
  ScrollView, StyleSheet, Text, TouchableOpacity, Alert, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Menu, Play, Clock, CheckCircle2, Image as ImageIcon, Video, History,
  Pause, ChevronDown, ChevronUp, Users, TrendingUp, Target, Globe,
  Zap, BarChart2, AlertCircle, RefreshCw, ArrowRight,
  Eye, Activity, Heart, MessageCircle, Share2, DollarSign,
} from 'lucide-react-native';
import { DrawerActions } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Skeleton } from '../components/Skeleton';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface DemoSegment {
  name: string;
  ageRange: string;
  gender: string;
  location: string;
  income: string;
  interests: string[];
  painPoints: string[];
  buyingBehavior: string;
  confidenceLevel: 'high' | 'medium' | 'low';
}

interface DemographicIntel {
  primaryAudience: string;
  segments: DemoSegment[];
  marketSize: string;
  marketGrowth: string;
  geographicFocus: string;
  languagesTone: string[];
  culturalConsiderations: string[];
  bestChannels: string[];
  worstChannels: string[];
  priceSensitivity: string;
  purchaseDrivers: string[];
  improvementSuggestions: string[];
  dataConfidence: 'real_data' | 'proxy_data' | 'general_knowledge';
  dataSource: string;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

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

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    real_data:        { label: 'Real Data',        color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
    proxy_data:       { label: 'Estimated',        color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    general_knowledge:{ label: 'AI Projected',     color: '#818CF8', bg: 'rgba(129,140,248,0.1)' },
  };
  const b = map[level] || map.general_knowledge;
  return (
    <View style={[styles.badge, { backgroundColor: b.bg }]}>
      <Text style={[styles.badgeText, { color: b.color }]}>{b.label}</Text>
    </View>
  );
}

// ─── Segment card ─────────────────────────────────────────────────────────────

function SegmentCard({ seg }: { seg: DemoSegment }) {
  const confColor = seg.confidenceLevel === 'high' ? '#10B981' : seg.confidenceLevel === 'medium' ? '#F59E0B' : '#818CF8';
  return (
    <View style={styles.segCard}>
      <View style={styles.segHeader}>
        <Text style={styles.segName}>{seg.name}</Text>
        <View style={[styles.confDot, { backgroundColor: confColor }]} />
      </View>
      <View style={styles.segMeta}>
        <Text style={styles.segMetaItem}>🎂 {seg.ageRange}</Text>
        <Text style={styles.segMetaItem}>👤 {seg.gender}</Text>
        <Text style={styles.segMetaItem}>📍 {seg.location}</Text>
        <Text style={styles.segMetaItem}>💰 {seg.income}</Text>
      </View>
      <Text style={styles.segBehavior}>{seg.buyingBehavior}</Text>
      {seg.painPoints?.length > 0 && (
        <View style={styles.chipRow}>
          {seg.painPoints.slice(0, 3).map((p, i) => (
            <View key={i} style={styles.chipPain}>
              <Text style={styles.chipPainText}>⚡ {p}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Performance Panel ────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: '📘', instagram: '📸', twitter: '🐦', linkedin: '💼',
  tiktok: '🎵', youtube: '▶️', whatsapp: '💬', unknown: '🌐',
};

interface PerfTotals {
  impressions: number; reach: number; likes: number;
  comments: number; shares: number; paid_equivalent_usd: number;
}

function PerformancePanel({ strategyId }: { strategyId: string }) {
  const [totals, setTotals] = useState<PerfTotals | null>(null);
  const [byPlatform, setByPlatform] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPerf = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !BACKEND_URL) return;
      const res = await globalThis.fetch(`${BACKEND_URL}/api/agents/performance/${strategyId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setTotals(data.totals ?? null);
      const grouped: Record<string, any> = {};
      for (const row of (data.performance ?? [])) {
        const p = row.platform ?? 'unknown';
        if (!grouped[p]) grouped[p] = { impressions: 0, likes: 0, comments: 0, shares: 0 };
        grouped[p].impressions += row.impressions ?? 0;
        grouped[p].likes       += row.likes       ?? 0;
        grouped[p].comments    += row.comments    ?? 0;
        grouped[p].shares      += row.shares      ?? 0;
      }
      setByPlatform(grouped);
    } catch {
      setError('Could not load performance data.');
    } finally {
      setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => { loadPerf(); }, [loadPerf]);

  if (loading) {
    return (
      <View style={styles.perfLoading}>
        <ActivityIndicator size="small" color="#10B981" />
        <Text style={styles.intelLoadingText}>Loading performance metrics…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.intelError}>
        <AlertCircle size={16} color="#F87171" />
        <Text style={styles.intelErrorText}>{error}</Text>
        <TouchableOpacity onPress={loadPerf} style={styles.retryBtn}>
          <RefreshCw size={12} color="#00F0FF" />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasData = totals && (
    (totals.impressions || 0) + (totals.likes || 0) +
    (totals.comments || 0) + (totals.shares || 0) > 0
  );

  if (!hasData) {
    return (
      <View style={styles.perfLoading}>
        <Activity size={14} color="#334155" />
        <Text style={[styles.intelLoadingText, { color: '#334155' }]}>
          No performance data yet — metrics appear after agents post content.
        </Text>
      </View>
    );
  }

  const kpis = [
    { icon: <Eye size={14} color="#00F0FF" />,         label: 'Impressions', value: fmt(totals!.impressions || 0), sub: `${fmt(totals!.reach || 0)} reach`, color: '#00F0FF' },
    { icon: <Heart size={14} color="#F472B6" />,        label: 'Likes',       value: fmt(totals!.likes    || 0), sub: 'clicks',  color: '#F472B6' },
    { icon: <MessageCircle size={14} color="#A78BFA" />,label: 'Replies',     value: fmt(totals!.comments || 0), sub: 'comments', color: '#A78BFA' },
    { icon: <Share2 size={14} color="#34D399" />,       label: 'Shares',      value: fmt(totals!.shares   || 0), sub: 'reposts', color: '#34D399' },
  ];

  return (
    <View style={styles.perfPanel}>
      {/* Header */}
      <View style={styles.intelPanelHeader}>
        <Activity size={14} color="#10B981" />
        <Text style={[styles.intelPanelTitle, { color: '#10B981' }]}>Live Performance</Text>
        {totals!.paid_equivalent_usd > 0 && (
          <View style={styles.mediaValueBadge}>
            <DollarSign size={10} color="#FBBF24" />
            <Text style={styles.mediaValueText}>
              ${totals!.paid_equivalent_usd.toFixed(0)} media value
            </Text>
          </View>
        )}
      </View>

      {/* KPI grid */}
      <View style={styles.kpiGrid}>
        {kpis.map((k, i) => (
          <View key={i} style={styles.kpiTile}>
            {k.icon}
            <Text style={[styles.kpiValue, { color: k.color }]}>{k.value}</Text>
            <Text style={styles.kpiLabel}>{k.label}</Text>
            <Text style={styles.kpiSub}>{k.sub}</Text>
          </View>
        ))}
      </View>

      {/* Per-platform breakdown */}
      {Object.keys(byPlatform).length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>BY PLATFORM</Text>
          <View style={styles.platformList}>
            {Object.entries(byPlatform).map(([plat, m]: [string, any]) => (
              <View key={plat} style={styles.platformRow}>
                <Text style={styles.platformName}>
                  {PLATFORM_EMOJI[plat] ?? '🌐'} {plat}
                </Text>
                <View style={styles.platformStats}>
                  <Text style={styles.platformStat}>{fmt(m.impressions)} imp</Text>
                  <Text style={styles.platformStatDot}>·</Text>
                  <Text style={styles.platformStat}>{fmt(m.likes)} likes</Text>
                  <Text style={styles.platformStatDot}>·</Text>
                  <Text style={styles.platformStat}>{fmt(m.comments)} replies</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Chip row helper ──────────────────────────────────────────────────────────

function ChipRow({ items, color = '#00F0FF', bg = 'rgba(0,240,255,0.08)' }: { items: string[]; color?: string; bg?: string }) {
  if (!items?.length) return null;
  return (
    <View style={styles.chipRow}>
      {items.map((item, i) => (
        <View key={i} style={[styles.chip, { backgroundColor: bg }]}>
          <Text style={[styles.chipText, { color }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Demographic Intelligence Panel ───────────────────────────────────────────

function DemographicPanel({ strategyId }: { strategyId: string }) {
  const [intel, setIntel] = useState<DemographicIntel | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSegIdx, setActiveSegIdx] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !BACKEND_URL) return;
      const res = await fetch(`${BACKEND_URL}/api/strategy/${strategyId}/intelligence/demographics`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 202) {
        setGenerating(true);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => fetch(true), 8000);
        }
        return;
      }
      const data = await res.json();
      if (data.intel) {
        setIntel(data.intel);
        setGenerating(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } catch {
      setError('Could not load audience intelligence.');
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => {
    fetch();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetch]);

  if (loading) {
    return (
      <View style={styles.intelLoading}>
        <ActivityIndicator size="small" color="#00F0FF" />
        <Text style={styles.intelLoadingText}>Loading audience intelligence…</Text>
      </View>
    );
  }

  if (generating) {
    return (
      <View style={styles.intelLoading}>
        <ActivityIndicator size="small" color="#818CF8" />
        <Text style={styles.intelLoadingText}>AI Brain is analysing your audience… this takes ~30s</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.intelError}>
        <AlertCircle size={16} color="#F87171" />
        <Text style={styles.intelErrorText}>{error}</Text>
        <TouchableOpacity onPress={() => { setError(null); fetch(); }} style={styles.retryBtn}>
          <RefreshCw size={12} color="#00F0FF" />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!intel) return null;

  return (
    <View style={styles.intelPanel}>
      {/* Header */}
      <View style={styles.intelPanelHeader}>
        <Users size={14} color="#00F0FF" />
        <Text style={styles.intelPanelTitle}>Audience Intelligence</Text>
        <ConfidenceBadge level={intel.dataConfidence} />
      </View>

      {/* Primary Audience */}
      <View style={styles.intelSection}>
        <Text style={styles.intelSectionLabel}>PRIMARY AUDIENCE</Text>
        <Text style={styles.intelPrimaryText}>{intel.primaryAudience}</Text>
      </View>

      {/* Market stats row */}
      <View style={styles.intelStatsRow}>
        <View style={styles.intelStat}>
          <Globe size={12} color="#A78BFA" />
          <Text style={styles.intelStatLabel}>Market</Text>
          <Text style={styles.intelStatValue}>{intel.marketSize || '—'}</Text>
        </View>
        <View style={styles.intelStatDivider} />
        <View style={styles.intelStat}>
          <TrendingUp size={12} color="#34D399" />
          <Text style={styles.intelStatLabel}>Growth</Text>
          <Text style={styles.intelStatValue}>{intel.marketGrowth || '—'}</Text>
        </View>
        <View style={styles.intelStatDivider} />
        <View style={styles.intelStat}>
          <Target size={12} color="#F59E0B" />
          <Text style={styles.intelStatLabel}>Geography</Text>
          <Text style={styles.intelStatValue} numberOfLines={1}>{intel.geographicFocus || '—'}</Text>
        </View>
      </View>

      {/* Audience Segments */}
      {intel.segments?.length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>AUDIENCE SEGMENTS</Text>
          {/* Segment tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {intel.segments.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => setActiveSegIdx(i)}
                  style={[styles.segTab, activeSegIdx === i && styles.segTabActive]}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.segTabText, activeSegIdx === i && styles.segTabTextActive]}>
                    {s.name.split(' ').slice(0, 2).join(' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <SegmentCard seg={intel.segments[activeSegIdx]} />
        </View>
      )}

      {/* Best channels */}
      {intel.bestChannels?.length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>BEST CHANNELS</Text>
          <ChipRow items={intel.bestChannels} color="#10B981" bg="rgba(16,185,129,0.08)" />
        </View>
      )}

      {/* Channels to avoid */}
      {intel.worstChannels?.length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>CHANNELS TO AVOID</Text>
          <ChipRow items={intel.worstChannels} color="#F87171" bg="rgba(248,113,113,0.08)" />
        </View>
      )}

      {/* Price sensitivity */}
      {intel.priceSensitivity && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>PRICE SENSITIVITY</Text>
          <Text style={styles.intelBodyText}>{intel.priceSensitivity}</Text>
        </View>
      )}

      {/* Purchase drivers */}
      {intel.purchaseDrivers?.length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>WHAT DRIVES PURCHASES</Text>
          <ChipRow items={intel.purchaseDrivers} color="#FBBF24" bg="rgba(251,191,36,0.08)" />
        </View>
      )}

      {/* Communication tone */}
      {intel.languagesTone?.length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>COMMUNICATION TONE</Text>
          <ChipRow items={intel.languagesTone} color="#A78BFA" bg="rgba(167,139,250,0.08)" />
        </View>
      )}

      {/* Cultural considerations */}
      {intel.culturalConsiderations?.length > 0 && (
        <View style={styles.intelSection}>
          <Text style={styles.intelSectionLabel}>CULTURAL NOTES</Text>
          {intel.culturalConsiderations.map((c, i) => (
            <Text key={i} style={styles.intelBullet}>• {c}</Text>
          ))}
        </View>
      )}

      {/* AI suggestions */}
      {intel.improvementSuggestions?.length > 0 && (
        <View style={[styles.intelSection, styles.suggestionsBox]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Zap size={13} color="#FBBF24" />
            <Text style={[styles.intelSectionLabel, { color: '#FBBF24', marginBottom: 0 }]}>AI RECOMMENDATIONS</Text>
          </View>
          {intel.improvementSuggestions.map((s, i) => (
            <Text key={i} style={styles.suggestionItem}>→ {s}</Text>
          ))}
        </View>
      )}

      {/* Data source note */}
      <Text style={styles.intelDataSource}>Source: {intel.dataSource}</Text>
    </View>
  );
}

// ─── Conversion Tracker Panel ─────────────────────────────────────────────────

/**
 * Maps the raw `stage` values in agent_leads to the three user-facing funnel
 * buckets shown in the Conversion Tracker.
 */
const FUNNEL_MAP: Record<string, 'contacted' | 'replied' | 'converted'> = {
  identified:  'contacted',
  new:         'contacted',
  engaged:     'contacted',
  nurturing:   'replied',
  warm:        'replied',
  converted:   'converted',
  closed:      'converted',
  closed_won:  'converted',
};

const PLATFORM_COLORS_CT: Record<string, string> = {
  facebook:  '#1877F2',
  instagram: '#E1306C',
  tiktok:    '#FE2C55',
  twitter:   '#1DA1F2',
  linkedin:  '#0A66C2',
  whatsapp:  '#25D366',
  email:     '#10B981',
  unknown:   '#64748B',
};

type FunnelCounts = { contacted: number; replied: number; converted: number };

function ConversionTrackerPanel({
  strategyId,
  strategyTitle,
  onCountChange,
}: {
  strategyId: string;
  strategyTitle: string;
  onCountChange?: (total: number) => void;
}) {
  const navigation = useNavigation<any>();
  const [byPlatform, setByPlatform] = useState<Record<string, FunnelCounts>>({});
  const [totalLeads, setTotalLeads] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processLeads = useCallback((rows: { platform: string; stage: string }[]) => {
    const result: Record<string, FunnelCounts> = {};
    let total = 0;
    for (const row of rows) {
      const plat = (row.platform ?? 'unknown').toLowerCase();
      if (!result[plat]) result[plat] = { contacted: 0, replied: 0, converted: 0 };
      const bucket = FUNNEL_MAP[(row.stage ?? '').toLowerCase()];
      if (bucket) { result[plat][bucket]++; total++; }
    }
    setByPlatform(result);
    setTotalLeads(total);
    onCountChange?.(total);
  }, [onCountChange]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error: qErr } = await supabase
        .from('agent_leads')
        .select('platform, stage')
        .eq('strategy_id', strategyId)
        .eq('user_id', user.id);
      if (qErr) throw qErr;
      processLeads(data ?? []);
    } catch {
      setError('Could not load lead data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [strategyId, processLeads]);

  useEffect(() => {
    loadLeads();
    // Subscribe to real-time changes on agent_leads for this strategy so the
    // counts update the moment the SALESMAN / outreach agent moves a lead
    // forward — no manual refresh needed.
    const channel = supabase
      .channel(`conv-tracker-${strategyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_leads', filter: `strategy_id=eq.${strategyId}` },
        () => { loadLeads(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadLeads, strategyId]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.convLoading}>
        <ActivityIndicator size="small" color="#F59E0B" />
        <Text style={styles.convLoadingText}>Loading lead data…</Text>
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={styles.intelError}>
        <AlertCircle size={16} color="#F87171" />
        <Text style={styles.intelErrorText}>{error}</Text>
        <TouchableOpacity onPress={loadLeads} style={styles.retryBtn}>
          <RefreshCw size={12} color="#00F0FF" />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const platforms = Object.keys(byPlatform);

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (platforms.length === 0) {
    return (
      <View style={styles.convEmpty}>
        <Users size={20} color="#334155" />
        <Text style={styles.convEmptyTitle}>No leads tracked yet</Text>
        <Text style={styles.convEmptyBody}>
          Leads appear here as agents identify and engage prospects for this strategy.
        </Text>
      </View>
    );
  }

  // ── Total summary ─────────────────────────────────────────────────────────────
  const totals = Object.values(byPlatform).reduce(
    (acc, c) => ({ contacted: acc.contacted + c.contacted, replied: acc.replied + c.replied, converted: acc.converted + c.converted }),
    { contacted: 0, replied: 0, converted: 0 },
  );

  return (
    <View style={styles.convPanel}>
      {/* Header */}
      <View style={styles.intelPanelHeader}>
        <TrendingUp size={14} color="#F59E0B" />
        <Text style={[styles.intelPanelTitle, { color: '#F59E0B' }]}>Conversion Tracker</Text>
        <View style={styles.convLiveDot}>
          <View style={styles.convLiveDotInner} />
          <Text style={styles.convLiveText}>Live</Text>
        </View>
      </View>

      {/* Funnel legend */}
      <View style={styles.funnelLegend}>
        {(['contacted', 'replied', 'converted'] as const).map((step, idx) => {
          const colors = { contacted: '#00F0FF', replied: '#F59E0B', converted: '#10B981' };
          const counts = { contacted: totals.contacted, replied: totals.replied, converted: totals.converted };
          return (
            <React.Fragment key={step}>
              {idx > 0 && <ArrowRight size={12} color="#334155" />}
              <View style={[styles.funnelStep, { borderColor: colors[step] + '40', backgroundColor: colors[step] + '10' }]}>
                <Text style={[styles.funnelStepCount, { color: colors[step] }]}>{counts[step]}</Text>
                <Text style={styles.funnelStepLabel}>{step.charAt(0).toUpperCase() + step.slice(1)}</Text>
              </View>
            </React.Fragment>
          );
        })}
        <View style={styles.funnelTotal}>
          <Text style={styles.funnelTotalCount}>{totalLeads}</Text>
          <Text style={styles.funnelTotalLabel}>Total</Text>
        </View>
      </View>

      {/* Per-platform breakdown */}
      <Text style={[styles.intelSectionLabel, { marginBottom: 6 }]}>BY PLATFORM</Text>
      <View style={{ gap: 6 }}>
        {platforms.map((plat) => {
          const counts = byPlatform[plat];
          const platColor = PLATFORM_COLORS_CT[plat] ?? '#64748B';
          const emoji = PLATFORM_EMOJI[plat] ?? '🌐';
          const total = counts.contacted + counts.replied + counts.converted;
          const convertedPct = total > 0
            ? Math.round((counts.converted / total) * 100)
            : 0;
          return (
            <TouchableOpacity
              key={plat}
              style={styles.convPlatRow}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('Leads', { strategyId, platform: plat })}
            >
              <View style={styles.convPlatHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <View style={[styles.convPlatDot, { backgroundColor: platColor }]} />
                  <Text style={styles.convPlatName}>{emoji} {plat.charAt(0).toUpperCase() + plat.slice(1)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {convertedPct > 0 && (
                    <Text style={styles.convPlatRate}>{convertedPct}% converted</Text>
                  )}
                  <ArrowRight size={12} color="#334155" />
                </View>
              </View>
              {/* Mini funnel bar */}
              <View style={styles.convFunnelRow}>
                {/* Contacted */}
                <View style={styles.convFunnelCell}>
                  <Text style={[styles.convFunnelNum, { color: '#00F0FF' }]}>{counts.contacted}</Text>
                  <Text style={styles.convFunnelSub}>Contacted</Text>
                </View>
                <ArrowRight size={10} color="#334155" />
                {/* Replied */}
                <View style={styles.convFunnelCell}>
                  <Text style={[styles.convFunnelNum, { color: '#F59E0B' }]}>{counts.replied}</Text>
                  <Text style={styles.convFunnelSub}>Replied</Text>
                </View>
                <ArrowRight size={10} color="#334155" />
                {/* Converted */}
                <View style={styles.convFunnelCell}>
                  <Text style={[styles.convFunnelNum, { color: '#10B981' }]}>{counts.converted}</Text>
                  <Text style={styles.convFunnelSub}>Converted</Text>
                </View>
                {/* Progress bar */}
                <View style={styles.convProgressBar}>
                  {(() => {
                    if (total === 0) return <View style={[styles.convProgressFill, { width: '0%', backgroundColor: '#1E293B' }]} />;
                    return (
                      <>
                        <View style={[styles.convProgressFill, { flex: counts.contacted / total, backgroundColor: '#00F0FF33' }]} />
                        <View style={[styles.convProgressFill, { flex: counts.replied / total, backgroundColor: '#F59E0B33' }]} />
                        <View style={[styles.convProgressFill, { flex: counts.converted / total, backgroundColor: '#10B98133' }]} />
                      </>
                    );
                  })()}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function StrategyHistoryScreen() {
  const navigation = useNavigation();
  const [history, setHistory] = useState<StrategyHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPerfId, setExpandedPerfId] = useState<string | null>(null);
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});

  const fetchLeadCounts = useCallback(async (strategyIds: string[]) => {
    if (!strategyIds.length) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('agent_leads')
      .select('strategy_id, stage')
      .eq('user_id', user.id)
      .in('strategy_id', strategyIds);
    if (!data) return;
    // Only count funnel-tracked stages (same FUNNEL_MAP as the panel uses)
    const counts: Record<string, number> = {};
    for (const row of data) {
      const sid = row.strategy_id;
      if (!sid) continue;
      if (FUNNEL_MAP[(row.stage ?? '').toLowerCase()]) {
        counts[sid] = (counts[sid] ?? 0) + 1;
      }
    }
    setLeadCounts(counts);
  }, []);

  const fetchHistory = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setInitialLoad(false); return; }

    const { data, error } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setHistory(data as any);
      fetchLeadCounts((data as any[]).map((s) => s.id));
    }
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
              if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to pause.'); }
              setHistory(prev => prev.map(s => s.id === item.id ? { ...s, status: 'paused', is_active: false } : s));
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not pause strategy. Please try again.');
            } finally { setPausingId(null); }
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
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to resume.'); }
      setHistory(prev => prev.map(s => s.id === item.id ? { ...s, status: 'active', is_active: true } : s));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not resume strategy. Please try again.');
    } finally { setPausingId(null); }
  };

  const renderAssets = (assets: any[]) => {
    if (!assets || assets.length === 0) return null;
    return (
      <View style={styles.assetsRow}>
        {assets.slice(0, 4).map((asset, idx) => (
          <View key={idx} style={styles.assetThumb}>
            <Image source={{ uri: asset.url }} style={styles.assetImage} resizeMode="cover" />
            <View style={styles.assetBadge}>
              {asset.type === 'VIDEO' ? <Video size={8} color="white" /> : <ImageIcon size={8} color="white" />}
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
    const isLoadingAction = pausingId === item.id;
    const isExpanded = expandedId === item.id;
    const isPerfExpanded = expandedPerfId === item.id;
    const isConvExpanded = expandedConvId === item.id;

    const statusColor = isActive ? '#00F0FF' : isPaused ? '#F59E0B' : '#64748B';
    const statusBg    = isActive ? 'rgba(0,240,255,0.08)' : isPaused ? 'rgba(245,158,11,0.08)' : 'rgba(100,116,139,0.08)';
    const statusBorder = isActive ? 'rgba(0,240,255,0.2)' : isPaused ? 'rgba(245,158,11,0.2)' : 'rgba(100,116,139,0.15)';

    return (
      <Animated.View entering={FadeInDown.delay(index * 70).springify()}>
        <View style={styles.card}>
          {/* Card Header */}
          <View style={styles.cardHeader}>
            <View style={[styles.typeTag, { backgroundColor: isPaid ? 'rgba(112,0,255,0.12)' : 'rgba(16,185,129,0.12)' }]}>
              <Text style={[styles.typeTagText, { color: isPaid ? '#A78BFA' : '#34D399' }]}>{item.type}</Text>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {isActive && (
                <View style={styles.aiMonitor}>
                  <View style={styles.aiMonitorDot} />
                  <Text style={styles.aiMonitorText}>AI Monitoring</Text>
                </View>
              )}
              {isActive && (
                <TouchableOpacity onPress={() => handlePause(item)} disabled={isLoadingAction} style={styles.pauseBtn} activeOpacity={0.75}>
                  {isLoadingAction
                    ? <ActivityIndicator size="small" color="#F59E0B" />
                    : <><Pause size={11} color="#F59E0B" /><Text style={styles.pauseBtnText}>Pause</Text></>}
                </TouchableOpacity>
              )}
              {isPaused && (
                <TouchableOpacity onPress={() => handleResume(item)} disabled={isLoadingAction} style={styles.resumeBtn} activeOpacity={0.75}>
                  {isLoadingAction
                    ? <ActivityIndicator size="small" color="#10B981" />
                    : <><Play size={11} color="#10B981" /><Text style={styles.resumeBtnText}>Resume</Text></>}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Live Performance Toggle */}
          <TouchableOpacity
            onPress={() => setExpandedPerfId(isPerfExpanded ? null : item.id)}
            style={styles.perfToggle}
            activeOpacity={0.75}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Activity size={13} color="#10B981" />
              <Text style={styles.perfToggleText}>Live Performance</Text>
            </View>
            {isPerfExpanded
              ? <ChevronUp size={14} color="#10B981" />
              : <ChevronDown size={14} color="#10B981" />}
          </TouchableOpacity>

          {/* Performance Panel (lazy-loaded on expand) */}
          {isPerfExpanded && <PerformancePanel strategyId={item.id} />}

          {/* Conversion Tracker Toggle */}
          <TouchableOpacity
            onPress={() => setExpandedConvId(isConvExpanded ? null : item.id)}
            style={styles.convToggle}
            activeOpacity={0.75}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <TrendingUp size={13} color="#F59E0B" />
              <Text style={styles.convToggleText}>Conversion Tracker</Text>
              {(leadCounts[item.id] ?? 0) > 0 && (
                <View style={styles.convCountBadge}>
                  <Text style={styles.convCountBadgeText}>{leadCounts[item.id]}</Text>
                </View>
              )}
            </View>
            {isConvExpanded
              ? <ChevronUp size={14} color="#F59E0B" />
              : <ChevronDown size={14} color="#F59E0B" />}
          </TouchableOpacity>

          {/* Conversion Tracker Panel (lazy-loaded on expand) */}
          {isConvExpanded && (
            <ConversionTrackerPanel
              strategyId={item.id}
              strategyTitle={item.title}
              onCountChange={(n) =>
                setLeadCounts((prev) => ({ ...prev, [item.id]: n }))
              }
            />
          )}

          {/* Audience Intelligence Toggle */}
          <TouchableOpacity
            onPress={() => setExpandedId(isExpanded ? null : item.id)}
            style={styles.intelToggle}
            activeOpacity={0.75}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <BarChart2 size={13} color="#818CF8" />
              <Text style={styles.intelToggleText}>Audience Intelligence</Text>
            </View>
            {isExpanded
              ? <ChevronUp size={14} color="#818CF8" />
              : <ChevronDown size={14} color="#818CF8" />}
          </TouchableOpacity>

          {/* Demographic Intelligence Panel (lazy-loaded on expand) */}
          {isExpanded && <DemographicPanel strategyId={item.id} />}
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
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchHistory} tintColor="#00F0FF" />}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  // ── Strategy card ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#151B2B', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E293B',
    marginBottom: 12, overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 0, gap: 8 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeTagText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  statusTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  statusTagText: { fontSize: 11, fontWeight: '600' },
  cardTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginTop: 10, paddingHorizontal: 16 },
  cardDesc: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 12, paddingHorizontal: 16 },
  assetsRow: { flexDirection: 'row', marginBottom: 12, paddingHorizontal: 16, gap: 8 },
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
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#1E293B',
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

  // ── Performance toggle ─────────────────────────────────────────────────────
  perfToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: 'rgba(16,185,129,0.12)',
    backgroundColor: 'rgba(16,185,129,0.04)',
  },
  perfToggleText: { color: '#10B981', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  // ── Performance panel ──────────────────────────────────────────────────────
  perfPanel: {
    padding: 16,
    borderTopWidth: 1, borderTopColor: 'rgba(16,185,129,0.1)',
  },
  perfLoading: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(16,185,129,0.1)',
  },

  // ── KPI grid ───────────────────────────────────────────────────────────────
  kpiGrid: {
    flexDirection: 'row', gap: 8, marginBottom: 14,
  },
  kpiTile: {
    flex: 1, alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B', padding: 10,
  },
  kpiValue: { fontSize: 16, fontWeight: '800' },
  kpiLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  kpiSub:   { color: '#475569', fontSize: 9 },

  // ── Media value badge ──────────────────────────────────────────────────────
  mediaValueBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  mediaValueText: { color: '#FBBF24', fontSize: 10, fontWeight: '700' },

  // ── Platform breakdown ─────────────────────────────────────────────────────
  platformList: { gap: 6 },
  platformRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10,
    borderWidth: 1, borderColor: '#1E293B', paddingHorizontal: 12, paddingVertical: 8,
  },
  platformName: { color: '#E2E8F0', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  platformStats: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  platformStat: { color: '#64748B', fontSize: 11 },
  platformStatDot: { color: '#334155', fontSize: 11 },

  // ── Intelligence toggle ────────────────────────────────────────────────────
  intelToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: 'rgba(129,140,248,0.12)',
    backgroundColor: 'rgba(129,140,248,0.04)',
  },
  intelToggleText: { color: '#818CF8', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  // ── Intel panel ────────────────────────────────────────────────────────────
  intelPanel: {
    padding: 16,
    borderTopWidth: 1, borderTopColor: 'rgba(129,140,248,0.1)',
  },
  intelPanelHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14,
  },
  intelPanelTitle: { color: '#E2E8F0', fontSize: 13, fontWeight: '700', flex: 1 },
  intelLoading: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(129,140,248,0.1)',
  },
  intelLoadingText: { color: '#64748B', fontSize: 12 },
  intelError: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(248,113,113,0.1)',
  },
  intelErrorText: { color: '#F87171', fontSize: 12, flex: 1 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  retryText: { color: '#00F0FF', fontSize: 12, fontWeight: '600' },
  intelSection: { marginBottom: 14 },
  intelSectionLabel: {
    color: '#475569', fontSize: 9, fontWeight: '800', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 6,
  },
  intelPrimaryText: { color: '#E2E8F0', fontSize: 13, lineHeight: 19 },
  intelBodyText: { color: '#94A3B8', fontSize: 12, lineHeight: 18 },
  intelBullet: { color: '#94A3B8', fontSize: 12, lineHeight: 18, marginBottom: 2 },
  intelDataSource: { color: '#334155', fontSize: 10, marginTop: 4, fontStyle: 'italic' },

  // ── Market stats row ───────────────────────────────────────────────────────
  intelStatsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B',
    marginBottom: 14, padding: 12,
  },
  intelStat: { flex: 1, alignItems: 'center', gap: 4 },
  intelStatLabel: { color: '#475569', fontSize: 10, fontWeight: '600' },
  intelStatValue: { color: '#E2E8F0', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  intelStatDivider: { width: 1, height: 28, backgroundColor: '#1E293B' },

  // ── Segment ────────────────────────────────────────────────────────────────
  segTab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: '#1E293B',
  },
  segTabActive: { backgroundColor: 'rgba(0,240,255,0.1)', borderColor: 'rgba(0,240,255,0.3)' },
  segTabText: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  segTabTextActive: { color: '#00F0FF' },
  segCard: {
    backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B', padding: 12,
  },
  segHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  segName: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', flex: 1 },
  confDot: { width: 7, height: 7, borderRadius: 4 },
  segMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  segMetaItem: { color: '#94A3B8', fontSize: 11 },
  segBehavior: { color: '#64748B', fontSize: 11, lineHeight: 16, marginBottom: 8 },

  // ── Chips ──────────────────────────────────────────────────────────────────
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  chipText: { fontSize: 11, fontWeight: '600' },
  chipPain: { backgroundColor: 'rgba(248,113,113,0.08)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  chipPainText: { color: '#F87171', fontSize: 11, fontWeight: '600' },

  // ── Confidence badge ───────────────────────────────────────────────────────
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },

  // ── Suggestions box ────────────────────────────────────────────────────────
  suggestionsBox: {
    backgroundColor: 'rgba(251,191,36,0.04)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.15)', padding: 12,
  },
  suggestionItem: { color: '#FBBF24', fontSize: 12, lineHeight: 19, marginBottom: 4 },

  // ── Conversion tracker toggle ───────────────────────────────────────────────
  convToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: 'rgba(245,158,11,0.12)',
    backgroundColor: 'rgba(245,158,11,0.04)',
  },
  convToggleText: { color: '#F59E0B', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  convCountBadge: {
    backgroundColor: 'rgba(245,158,11,0.18)',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
    minWidth: 22, alignItems: 'center',
  },
  convCountBadgeText: { color: '#F59E0B', fontSize: 10, fontWeight: '800' },

  // ── Conversion tracker panel ────────────────────────────────────────────────
  convPanel: {
    padding: 16,
    borderTopWidth: 1, borderTopColor: 'rgba(245,158,11,0.1)',
  },
  convLoading: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(245,158,11,0.1)',
  },
  convLoadingText: { color: '#64748B', fontSize: 12 },
  convEmpty: {
    alignItems: 'center', gap: 8,
    padding: 20, borderTopWidth: 1, borderTopColor: 'rgba(245,158,11,0.1)',
  },
  convEmptyTitle: { color: '#475569', fontSize: 13, fontWeight: '600' },
  convEmptyBody: { color: '#334155', fontSize: 11, textAlign: 'center', lineHeight: 16 },

  // ── Live badge ──────────────────────────────────────────────────────────────
  convLiveDot: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2,
  },
  convLiveDotInner: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#F59E0B' },
  convLiveText: { color: '#F59E0B', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },

  // ── Funnel summary row ──────────────────────────────────────────────────────
  funnelLegend: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 16, flexWrap: 'wrap',
  },
  funnelStep: {
    alignItems: 'center', borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 60,
  },
  funnelStepCount: { fontSize: 18, fontWeight: '800' },
  funnelStepLabel: { color: '#94A3B8', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },
  funnelTotal: {
    marginLeft: 6, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 10,
    borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 48,
  },
  funnelTotalCount: { color: '#E2E8F0', fontSize: 18, fontWeight: '800' },
  funnelTotalLabel: { color: '#475569', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 1 },

  // ── Per-platform rows ───────────────────────────────────────────────────────
  convPlatRow: {
    backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
  },
  convPlatHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  convPlatDot: { width: 7, height: 7, borderRadius: 4 },
  convPlatName: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
  convPlatRate: { color: '#10B981', fontSize: 10, fontWeight: '700' },
  convFunnelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  convFunnelCell: { alignItems: 'center', minWidth: 44 },
  convFunnelNum: { fontSize: 15, fontWeight: '800' },
  convFunnelSub: { color: '#475569', fontSize: 9, fontWeight: '600', marginTop: 1 },
  convProgressBar: {
    flex: 1, height: 5, borderRadius: 3,
    flexDirection: 'row', overflow: 'hidden',
    backgroundColor: '#0B0F19', marginLeft: 4,
  },
  convProgressFill: { height: '100%' },
});
