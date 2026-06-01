import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import TrialPromoModal from '../components/TrialPromoModal';
import { Skeleton } from '../components/Skeleton';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { DrawerActions } from '@react-navigation/native';
import {
  Zap, AlertTriangle, TrendingUp, Plus, Activity,
  Target, Eye, MousePointer, Menu, RefreshCw, Crown, Bot, Wifi,
  Trophy, Star, CheckCircle, DollarSign, MapPin, Phone, Mail, Building2,
  Heart, MessageCircle, Share2, Users, BarChart2, Truck, Award, ShoppingBag,
} from 'lucide-react-native';
import { useEnergyStore, PLAN_DETAILS } from '../store/energyStore';

// ─── Performance Chart Component ─────────────────────────────────────────────
interface PerfRow {
  platform: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  fetched_at: string;
}
interface PerformanceChartProps { strategies: any[]; userId: string; }

function PerformanceChart({ strategies, userId }: PerformanceChartProps) {
  const [perf, setPerf] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!strategies.length || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows: PerfRow[] = [];
        for (const s of strategies.slice(0, 3)) {
          const sid = s.strategy_id || s.id;
          if (!sid) continue;
          const { data } = await supabase
            .from('agent_performance')
            .select('platform, reach, likes, comments, shares, fetched_at')
            .eq('strategy_id', sid)
            .eq('user_id', userId)
            .order('fetched_at', { ascending: false })
            .limit(20);
          if (data) rows.push(...(data as PerfRow[]));
        }
        if (!cancelled) setPerf(rows);
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [strategies.map(s => s.strategy_id || s.id).join(','), userId]);

  const PLATFORM_COLORS: Record<string, string> = {
    facebook: '#1877F2', instagram: '#E1306C', twitter: '#1DA1F2',
    linkedin: '#0A66C2', tiktok: '#69C9D0',
  };

  const grouped = perf.reduce((acc, row) => {
    const p = (row.platform || 'unknown').toLowerCase();
    if (!acc[p]) acc[p] = { reach: 0, likes: 0, comments: 0, shares: 0, count: 0 };
    acc[p].reach += row.reach || 0;
    acc[p].likes += row.likes || 0;
    acc[p].comments += row.comments || 0;
    acc[p].shares += row.shares || 0;
    acc[p].count++;
    return acc;
  }, {} as Record<string, { reach: number; likes: number; comments: number; shares: number; count: number }>);

  const platforms = Object.entries(grouped).sort((a, b) => b[1].reach - a[1].reach);
  const maxReach = Math.max(1, ...platforms.map(([, v]) => v.reach));
  const totalReach = platforms.reduce((s, [, v]) => s + v.reach, 0);
  const totalEngagement = platforms.reduce((s, [, v]) => s + v.likes + v.comments + v.shares, 0);

  if (loading) {
    return (
      <View style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 14 }}>
        <Skeleton width="100%" height={80} borderRadius={10} />
      </View>
    );
  }

  if (platforms.length === 0) {
    return (
      <View style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 20, alignItems: 'center' }}>
        <Activity size={24} color="#1E293B" />
        <Text style={{ color: '#334155', fontSize: 13, marginTop: 8 }}>No performance data yet — agents are working</Text>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(167,139,250,0.2)', overflow: 'hidden' }}>
      {/* Totals header */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1E293B' }}>
        {[
          { label: 'Total Reach', value: totalReach.toLocaleString(), color: '#A78BFA' },
          { label: 'Engagement', value: totalEngagement.toLocaleString(), color: '#00F0FF' },
          { label: 'Platforms', value: String(platforms.length), color: '#10B981' },
        ].map((stat, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRightWidth: i < 2 ? 1 : 0, borderRightColor: '#1E293B' }}>
            <Text style={{ color: stat.color, fontWeight: '800', fontSize: 16 }}>{stat.value}</Text>
            <Text style={{ color: '#64748B', fontSize: 10, marginTop: 2 }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Per-platform bars */}
      <View style={{ padding: 14, gap: 10 }}>
        {platforms.map(([platform, data]) => {
          const color = PLATFORM_COLORS[platform] || '#64748B';
          const barPct = data.reach / maxReach;
          const engagement = data.likes + data.comments + data.shares;
          return (
            <View key={platform}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                  <Text style={{ color: '#E2E8F0', fontWeight: '600', fontSize: 12, textTransform: 'capitalize' }}>{platform}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ color: color, fontWeight: '700', fontSize: 11 }}>{data.reach.toLocaleString()} reach</Text>
                  <Text style={{ color: '#64748B', fontSize: 11 }}>{engagement.toLocaleString()} eng</Text>
                </View>
              </View>
              {/* Reach bar */}
              <View style={{ height: 6, backgroundColor: '#1E293B', borderRadius: 3, overflow: 'hidden', marginBottom: 2 }}>
                <View style={{ width: `${barPct * 100}%` as any, height: '100%', backgroundColor: color, borderRadius: 3, opacity: 0.8 }} />
              </View>
              {/* Engagement breakdown mini bars */}
              {(data.likes > 0 || data.comments > 0 || data.shares > 0) && (
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 3 }}>
                  {[{ label: '♥', v: data.likes, c: '#EF4444' }, { label: '💬', v: data.comments, c: '#F59E0B' }, { label: '↗', v: data.shares, c: '#10B981' }].map(({ label, v, c }) => v > 0 ? (
                    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <Text style={{ color: c, fontSize: 9 }}>{label}</Text>
                      <Text style={{ color: '#64748B', fontSize: 9 }}>{v.toLocaleString()}</Text>
                    </View>
                  ) : null)}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface AgentTask {
  id: string;
  agent_type: string;
  platform: string;
  status: string;
  strategy_id?: string;
  started_at?: string;
  strategy_name?: string;
}

interface ClosedDeal {
  id: string;
  buyer_name: string;
  product_name: string;
  deal_value: number;
  currency: string;
  platform: string;
  status: string;
  delivery_address?: string;
  delivery_type?: string;
  contact_phone?: string;
  created_at: string;
}

interface GoalCompletion {
  id: string;
  agent_type: string;
  strategy_name: string;
  completed_at: string;
  goal: string;
}

interface AgentAchievement {
  id: string;
  agent_type: string;
  task_type: string;
  platform?: string;
  result?: any;
  executed_at: string;
}

interface PerfSummary {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  dms_sent: number;
  leads_captured: number;
  clicks: number;
  conversions: number;
}

interface GmapsLead {
  id: string;
  platform_username: string;
  platform: 'whatsapp' | 'email';
  intent_score: number;
  stage: string;
  created_at: string;
  intent_signals: Array<{
    source: string;
    place_id?: string;
    rating?: number;
    total_ratings?: number;
    outreach_reason?: string;
  }>;
}

export default function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { account, subscription, fetchEnergy } = useEnergyStore();

  const [activeStrategies, setActiveStrategies] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [activeAgentTasks, setActiveAgentTasks] = useState<AgentTask[]>([]);
  const [closedDeals, setClosedDeals] = useState<ClosedDeal[]>([]);
  const [goalCompletions, setGoalCompletions] = useState<GoalCompletion[]>([]);
  const [gmapsLeads, setGmapsLeads] = useState<GmapsLead[]>([]);
  const [agentAchievements, setAgentAchievements] = useState<AgentAchievement[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [revenueCurrency, setRevenueCurrency] = useState('USD');
  const [perfSummary, setPerfSummary] = useState<PerfSummary>({ reach: 0, likes: 0, comments: 0, shares: 0, dms_sent: 0, leads_captured: 0, clicks: 0, conversions: 0 });
  const [allLeadsCount, setAllLeadsCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const agentSubRef = useRef<any>(null);
  const dealsSubRef = useRef<any>(null);
  const gmapsSubRef = useRef<any>(null);

  const fetchData = async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [
        strategiesRes, logsRes, tasksRes, dealsRes, completedStratsRes,
        gmapsRes, achievementsRes, perfRes, leadsCountRes,
      ] = await Promise.all([
        supabase
          .from('strategy_memory')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        supabase
          .from('ipe_intelligence_log')
          .select('*')
          .gte('priority', 1)
          .order('timestamp', { ascending: false })
          .limit(5),
        supabase
          .from('agent_tasks')
          .select('id, agent_type, platform, status, strategy_id, started_at')
          .eq('user_id', session.user.id)
          .in('status', ['running', 'pending'])
          .order('started_at', { ascending: false })
          .limit(8),
        supabase
          .from('agent_deals')
          .select('id, buyer_name, product_name, deal_value, currency, platform, status, delivery_address, delivery_type, contact_phone, created_at')
          .eq('user_id', session.user.id)
          .in('status', ['closed_won', 'closing_attempted', 'pending_delivery'])
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('strategies')
          .select('id, agent_type, goal, current_execution_plan, updated_at')
          .eq('user_id', session.user.id)
          .eq('is_active', false)
          .not('agent_type', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase
          .from('agent_leads')
          .select('id, platform_username, platform, intent_score, stage, created_at, intent_signals')
          .eq('user_id', session.user.id)
          .in('platform', ['whatsapp', 'email'])
          .order('created_at', { ascending: false })
          .limit(8),
        // Campaign wins: completed agent tasks from all agents (last 30 days)
        supabase
          .from('agent_tasks')
          .select('id, agent_type, task_type, platform, result, executed_at')
          .eq('user_id', session.user.id)
          .eq('status', 'done')
          .in('task_type', ['POST', 'HASHTAG_CAMPAIGN', 'URGENCY_POST', 'TEASER', 'GMAPS_OUTREACH'])
          .gte('executed_at', thirtyDaysAgo)
          .order('executed_at', { ascending: false })
          .limit(20),
        // Aggregate performance metrics across all strategies
        supabase
          .from('agent_performance')
          .select('reach, likes, comments, shares, dms_sent, leads_captured, clicks, conversions')
          .eq('user_id', session.user.id),
        // Total leads count
        supabase
          .from('agent_leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id),
      ]);

      setActiveStrategies(strategiesRes.data || []);
      setAlerts(logsRes.data || []);
      setGmapsLeads((gmapsRes.data as GmapsLead[]) || []);

      // Deals + revenue total
      const deals = (dealsRes.data as ClosedDeal[]) || [];
      setClosedDeals(deals);
      const rev = deals
        .filter(d => d.status === 'closed_won')
        .reduce((sum, d) => sum + (Number(d.deal_value) || 0), 0);
      setTotalRevenue(rev);
      if (deals.length > 0 && deals[0].currency) setRevenueCurrency(deals[0].currency);

      const completions: GoalCompletion[] = (completedStratsRes.data || []).map((s: any) => ({
        id: s.id,
        agent_type: s.agent_type,
        strategy_name: s.current_execution_plan?.campaign_theme || 'Campaign',
        completed_at: s.updated_at,
        goal: s.goal,
      }));
      setGoalCompletions(completions);

      const tasks: AgentTask[] = (tasksRes.data || []).map((t: any) => ({
        ...t,
        strategy_name: strategiesRes.data?.find((s: any) => s.strategy_id === t.strategy_id)?.strategy_name ?? null,
      }));
      setActiveAgentTasks(tasks);

      // Agent campaign wins
      setAgentAchievements((achievementsRes.data as AgentAchievement[]) || []);

      // Aggregate performance
      const perfRows = perfRes.data || [];
      const agg: PerfSummary = { reach: 0, likes: 0, comments: 0, shares: 0, dms_sent: 0, leads_captured: 0, clicks: 0, conversions: 0 };
      for (const row of perfRows as any[]) {
        agg.reach           += row.reach           || 0;
        agg.likes           += row.likes           || 0;
        agg.comments        += row.comments        || 0;
        agg.shares          += row.shares          || 0;
        agg.dms_sent        += row.dms_sent        || 0;
        agg.leads_captured  += row.leads_captured  || 0;
        agg.clicks          += row.clicks          || 0;
        agg.conversions     += row.conversions     || 0;
      }
      setPerfSummary(agg);
      setAllLeadsCount(leadsCountRes.count ?? 0);
    } catch (e) {
      console.error('Dashboard error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Realtime agent task subscription
  useEffect(() => {
    if (!session?.user) return;
    const channel = supabase
      .channel('agent_tasks_live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_tasks',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => { fetchData(); },
      )
      .subscribe();
    agentSubRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id]);

  // Realtime subscription for closed deals
  useEffect(() => {
    if (!session?.user) return;
    const dealsChannel = supabase
      .channel('agent_deals_live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_deals',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => { fetchData(); },
      )
      .subscribe();
    dealsSubRef.current = dealsChannel;
    return () => { supabase.removeChannel(dealsChannel); };
  }, [session?.user?.id]);

  // Realtime subscription for Google Maps leads (new business contacts discovered)
  useEffect(() => {
    if (!session?.user) return;
    const gmapsChannel = supabase
      .channel('gmaps_leads_live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_leads',
          filter: `user_id=eq.${session.user.id}`,
        },
        () => { fetchData(); },
      )
      .subscribe();
    gmapsSubRef.current = gmapsChannel;
    return () => { supabase.removeChannel(gmapsChannel); };
  }, [session?.user?.id]);

  useEffect(() => { fetchData(); fetchEnergy(); }, [session]);
  const onRefresh = () => { setRefreshing(true); fetchData(); fetchEnergy(); };

  const totalImpressions = activeStrategies.reduce((a, s) => a + (s.total_impressions || 0), 0);
  const totalClicks = activeStrategies.reduce((a, s) => a + (s.total_clicks || 0), 0);
  const totalConversions = activeStrategies.reduce((a, s) => a + (s.total_conversions || 0), 0);

  const agentLabel = (type: string) => {
    const map: Record<string, string> = {
      sales: 'Sales Agent', content: 'Content Agent',
      engagement: 'Engagement Agent', analytics: 'Analytics Agent',
      optimization: 'Optimization Agent',
      SALESMAN: 'Salesman Agent', AWARENESS: 'Awareness Agent',
      PROMOTION: 'Promotion Agent', LAUNCH: 'Launch Agent',
    };
    return map[type] ?? map[type?.toLowerCase()] ?? `${type} Agent`;
  };

  const agentWinLabel = (task: AgentAchievement): string => {
    const p = task.platform ? ` on ${task.platform.charAt(0).toUpperCase() + task.platform.slice(1)}` : '';
    switch (task.task_type) {
      case 'POST': return `Published campaign post${p}`;
      case 'HASHTAG_CAMPAIGN': return `Launched hashtag campaign${p}`;
      case 'URGENCY_POST': return `Published urgency/FOMO post${p}`;
      case 'TEASER': return `Published product teaser${p}`;
      case 'GMAPS_OUTREACH': {
        const n = task.result?.gmaps_reached || task.result?.leads;
        return n ? `Contacted ${n} local businesses` : `Local business outreach`;
      }
      default: return `Completed ${task.task_type.toLowerCase().replace(/_/g, ' ')}${p}`;
    }
  };

  const agentColors: Record<string, string> = {
    SALESMAN: '#10B981', AWARENESS: '#00F0FF',
    PROMOTION: '#F59E0B', LAUNCH: '#A78BFA',
  };

  return (
    <>
    <TrialPromoModal onStartTrial={(planId) => navigation.navigate('Subscription', { autoStartTrial: planId })} />
    <SafeAreaView style={styles.safe} edges={['top']}>
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
      >
        {/* Skeleton loading overlay (first load only, not on pull-to-refresh) */}
        {loading && !refreshing && activeStrategies.length === 0 ? (
          <View style={{ paddingTop: 8 }}>
            <Skeleton width="100%" height={44} borderRadius={14} style={{ marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <Skeleton width="33%" height={80} borderRadius={14} />
              <Skeleton width="33%" height={80} borderRadius={14} />
              <Skeleton width="33%" height={80} borderRadius={14} />
            </View>
            <Skeleton width="100%" height={110} borderRadius={16} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={58} borderRadius={14} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={120} borderRadius={16} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={120} borderRadius={16} style={{ marginBottom: 12 }} />
          </View>
        ) : null}

        {!(loading && !refreshing && activeStrategies.length === 0) && <>
        {/* Status bar */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.statusBar}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>
            {loading ? 'Syncing AI Brain...' : 'System Operational'}
          </Text>
          <Text style={styles.statusCount}>{activeStrategies.length} active</Text>
        </Animated.View>

        {/* Real-time Agent Activity Panel */}
        {activeAgentTasks.length > 0 && (
          <Animated.View entering={FadeInDown.delay(110).springify()} style={styles.agentPanel}>
            <View style={styles.agentPanelHeader}>
              <Wifi size={13} color="#00F0FF" />
              <Text style={styles.agentPanelTitle}>AI Agents Working Now</Text>
              <View style={styles.agentLiveDot} />
              <Text style={styles.agentLiveText}>LIVE</Text>
            </View>
            {activeAgentTasks.map((task) => (
              <View key={task.id} style={styles.agentTaskRow}>
                <View style={styles.agentAvatarSmall}>
                  <Bot size={13} color="#00F0FF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.agentTaskLabel}>{agentLabel(task.agent_type)}</Text>
                  <Text style={styles.agentTaskSub}>
                    {task.platform ? `${task.platform}` : 'Running'}{task.strategy_name ? ` · ${task.strategy_name}` : ''}
                  </Text>
                </View>
                <View style={[styles.agentStatusBadge, task.status === 'running' ? styles.agentRunning : styles.agentPending]}>
                  <Text style={[styles.agentStatusText, task.status === 'running' ? { color: '#10B981' } : { color: '#F59E0B' }]}>
                    {task.status === 'running' ? '● Running' : '◌ Pending'}
                  </Text>
                </View>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Energy Widget */}
        {(() => {
          const balance = parseFloat(String(account?.balance_credits ?? '0'));
          const plan = subscription?.plan ?? 'none';
          const planInfo = PLAN_DETAILS[plan as keyof typeof PLAN_DETAILS];
          const maxCredits = planInfo?.credits || 100;
          const pct = Math.min(1, balance / Math.max(maxCredits, 1));
          const barColor = pct > 0.5 ? '#00F0FF' : pct > 0.2 ? '#F59E0B' : '#EF4444';
          const isLow = balance < 10;
          return (
            <Animated.View entering={FadeInDown.delay(120).springify()}>
              <TouchableOpacity
                onPress={() => navigation.navigate('Subscription')}
                activeOpacity={0.85}
                style={[styles.energyCard, isLow && { borderColor: '#F59E0B40' }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Zap size={14} color={barColor} />
                    <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 }}>AdRoom Energy</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Crown size={11} color={planInfo?.color ?? '#64748B'} />
                    <Text style={{ color: planInfo?.color ?? '#64748B', fontSize: 11, fontWeight: '700' }}>{planInfo?.name ?? 'No Plan'}</Text>
                    {isLow && <Text style={{ color: '#F59E0B', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>Low!</Text>}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 6 }}>
                  <Text style={{ color: barColor, fontSize: 28, fontWeight: '900', letterSpacing: -1 }}>{balance.toFixed(1)}</Text>
                  <Text style={{ color: '#64748B', fontSize: 13, marginBottom: 3 }}>credits</Text>
                </View>
                <View style={{ height: 5, backgroundColor: '#1E293B', borderRadius: 3, overflow: 'hidden' }}>
                  <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: barColor, borderRadius: 3 }} />
                </View>
                {balance <= 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: '#EF444415', borderRadius: 6, padding: 6 }}>
                    <AlertTriangle size={12} color="#EF4444" />
                    <Text style={{ color: '#EF4444', fontSize: 11 }}>AI features paused — tap to top up</Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          );
        })()}

        {/* ── Marketing Metrics Grid ── */}
        <Animated.View entering={FadeInDown.delay(150).springify()} style={styles.metricsSection}>
          <View style={styles.metricsHeader}>
            <BarChart2 size={16} color="#00F0FF" />
            <Text style={styles.metricsSectionTitle}>Campaign Metrics</Text>
          </View>
          {(() => {
            const totalEngagement = perfSummary.likes + perfSummary.comments + perfSummary.shares;
            const engRate = perfSummary.reach > 0 ? ((totalEngagement / perfSummary.reach) * 100).toFixed(1) : '0.0';
            const ctr = perfSummary.reach > 0 && perfSummary.clicks > 0
              ? ((perfSummary.clicks / perfSummary.reach) * 100).toFixed(2) : '0.00';
            const convRate = perfSummary.clicks > 0 && perfSummary.conversions > 0
              ? ((perfSummary.conversions / perfSummary.clicks) * 100).toFixed(1) : '0.0';
            const closedCount = closedDeals.filter(d => d.status === 'closed_won').length;
            const closeRate = allLeadsCount > 0 && closedCount > 0
              ? ((closedCount / allLeadsCount) * 100).toFixed(1) : '0.0';
            const avgDealValue = closedCount > 0
              ? Math.round(totalRevenue / closedCount) : 0;
            // Paid media equivalent: industry avg $3 CPM
            const paidEquiv = Math.round((perfSummary.reach / 1000) * 3);
            const revenueDisplay = totalRevenue >= 1000
              ? `${(totalRevenue / 1000).toFixed(1)}K`
              : totalRevenue.toLocaleString();
            const paidDisplay = paidEquiv >= 1000
              ? `$${(paidEquiv / 1000).toFixed(1)}K`
              : `$${paidEquiv}`;
            const metrics = [
              { label: 'Reach',        value: perfSummary.reach > 0 ? perfSummary.reach.toLocaleString() : totalImpressions.toLocaleString(), icon: Activity,     color: '#00F0FF', onPress: undefined },
              { label: 'Impressions',  value: totalImpressions.toLocaleString(),                                                               icon: Eye,           color: '#A78BFA', onPress: undefined },
              { label: 'Eng. Rate',    value: `${engRate}%`,                                                                                   icon: TrendingUp,    color: '#F59E0B', onPress: undefined },
              { label: 'CTR',          value: `${ctr}%`,                                                                                       icon: MousePointer,  color: '#38BDF8', onPress: undefined },
              { label: 'Likes',        value: perfSummary.likes.toLocaleString(),                                                              icon: Heart,         color: '#F87171', onPress: undefined },
              { label: 'Comments',     value: perfSummary.comments.toLocaleString(),                                                           icon: MessageCircle, color: '#60A5FA', onPress: undefined },
              { label: 'Shares',       value: perfSummary.shares.toLocaleString(),                                                             icon: Share2,        color: '#34D399', onPress: undefined },
              { label: 'DMs Sent',     value: perfSummary.dms_sent.toLocaleString(),                                                           icon: Users,         color: '#818CF8', onPress: undefined },
              { label: 'Leads',        value: allLeadsCount.toLocaleString(),                                                                  icon: Target,        color: '#10B981', onPress: () => navigation.navigate('Leads') },
              { label: 'Conv. Rate',   value: `${convRate}%`,                                                                                  icon: CheckCircle,   color: '#4ADE80', onPress: undefined },
              { label: 'Close Rate',   value: `${closeRate}%`,                                                                                 icon: Trophy,        color: '#FBBF24', onPress: undefined },
              { label: 'Avg Deal',     value: avgDealValue > 0 ? `${revenueCurrency} ${avgDealValue.toLocaleString()}` : '—',                  icon: DollarSign,    color: '#F59E0B', onPress: undefined },
              { label: 'Revenue',      value: revenueDisplay,                                                                                  icon: DollarSign,    color: '#FBBF24', onPress: undefined },
              { label: 'Media Value',  value: paidDisplay,                                                                                     icon: BarChart2,     color: '#C084FC', onPress: undefined },
              { label: 'Deals Won',    value: closedCount.toLocaleString(),                                                                    icon: Award,         color: '#10B981', onPress: undefined },
            ];
            return (
              <View style={styles.metricsGrid}>
                {metrics.map((m, i) => {
                  const Icon = m.icon;
                  const CellWrapper: any = m.onPress ? TouchableOpacity : View;
                  return (
                    <CellWrapper key={i} style={styles.metricCell} onPress={m.onPress} activeOpacity={0.75}>
                      <View style={[styles.metricIconWrap, { backgroundColor: `${m.color}15` }]}>
                        <Icon size={14} color={m.color} />
                      </View>
                      <Text style={styles.metricValue}>{m.value}</Text>
                      <Text style={styles.metricLabel}>{m.label}</Text>
                    </CellWrapper>
                  );
                })}
              </View>
            );
          })()}
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
                      { backgroundColor: strategy.strategy_version === 'paid' ? 'rgba(112,0,255,0.15)' : 'rgba(16,185,129,0.15)' },
                    ]}>
                      <View style={[
                        styles.strategyBadgeDot,
                        { backgroundColor: strategy.strategy_version === 'paid' ? '#7000FF' : '#10B981' },
                      ]} />
                      <Text style={[
                        styles.strategyBadgeText,
                        { color: strategy.strategy_version === 'paid' ? '#A78BFA' : '#34D399' },
                      ]}>
                        {strategy.strategy_version?.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {/* Per-strategy active agent indicator */}
                  {activeAgentTasks.filter(t => t.strategy_id === strategy.strategy_id).map(task => (
                    <View key={task.id} style={styles.strategyAgentRow}>
                      <Bot size={11} color="#00F0FF" />
                      <Text style={styles.strategyAgentText}>
                        {agentLabel(task.agent_type)} · {task.platform || 'Active'}
                      </Text>
                    </View>
                  ))}

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

        {/* ── Achievements Section (always visible) ── */}
        <Animated.View entering={FadeInDown.delay(310).springify()} style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Trophy size={18} color="#F59E0B" />
              <Text style={styles.sectionTitle}>Achievements</Text>
            </View>
            {(closedDeals.length + agentAchievements.length + goalCompletions.length) > 0 ? (
              <View style={styles.achCountBadge}>
                <Text style={styles.achCountText}>
                  {closedDeals.length + agentAchievements.length + goalCompletions.length}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Revenue summary banner */}
          <View style={styles.revenueBanner}>
            <View style={styles.revenueIconWrap}>
              <DollarSign size={16} color="#FBBF24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.revenueLabel}>Total Revenue Generated by AI</Text>
              <Text style={styles.revenueValue}>
                {revenueCurrency} {totalRevenue.toLocaleString()}
              </Text>
            </View>
            <ShoppingBag size={18} color="rgba(251,191,36,0.3)" />
          </View>

          {/* ── Deals Closed ── */}
          <View style={styles.achievementCard}>
            <View style={styles.achievementHeader}>
              <DollarSign size={13} color="#10B981" />
              <Text style={styles.achievementLabel}>DEALS CLOSED BY AI</Text>
              <View style={styles.achievementLiveDot} />
            </View>
            {closedDeals.length === 0 ? (
              <View style={styles.achEmpty}>
                <CheckCircle size={20} color="#1E293B" />
                <Text style={styles.achEmptyText}>No deals yet — Salesman AI is prospecting</Text>
              </View>
            ) : (
              closedDeals.map((deal, i) => {
                const timeAgo = (() => {
                  const diff = Date.now() - new Date(deal.created_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })();
                const statusColor = deal.status === 'closed_won' ? '#10B981' : deal.status === 'pending_delivery' ? '#FBBF24' : '#818CF8';
                const statusLabel = deal.status === 'closed_won' ? 'Won' : deal.status === 'pending_delivery' ? 'Delivery' : 'Closing';
                return (
                  <View
                    key={deal.id}
                    style={[styles.dealRow, i < closedDeals.length - 1 && styles.dealRowBorder]}
                  >
                    <View style={styles.dealIconWrap}>
                      <CheckCircle size={14} color="#10B981" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.dealBuyerName}>{deal.buyer_name}</Text>
                        <View style={[styles.dealStatusBadge, { backgroundColor: `${statusColor}20` }]}>
                          <Text style={[styles.dealStatusText, { color: statusColor }]}>{statusLabel}</Text>
                        </View>
                      </View>
                      <Text style={styles.dealMeta}>{deal.product_name} · {deal.platform}</Text>
                      {deal.delivery_address ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Truck size={10} color="#475569" />
                          <Text style={styles.dealDelivery} numberOfLines={1}>{deal.delivery_address}</Text>
                        </View>
                      ) : null}
                      {deal.contact_phone ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
                          <Phone size={10} color="#475569" />
                          <Text style={styles.dealDelivery}>{deal.contact_phone}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.dealValue}>
                        {deal.currency} {Number(deal.deal_value).toLocaleString()}
                      </Text>
                      <Text style={styles.dealTime}>{timeAgo}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* ── Campaign Wins (all agent task completions) ── */}
          <View style={[styles.achievementCard, { marginTop: 8 }]}>
            <View style={styles.achievementHeader}>
              <Award size={13} color="#00F0FF" />
              <Text style={[styles.achievementLabel, { color: '#00F0FF' }]}>CAMPAIGN WINS</Text>
            </View>
            {agentAchievements.length === 0 ? (
              <View style={styles.achEmpty}>
                <Zap size={20} color="#1E293B" />
                <Text style={styles.achEmptyText}>AI agents are working — wins appear here</Text>
              </View>
            ) : (
              agentAchievements.map((ach, i) => {
                const color = agentColors[ach.agent_type] || '#64748B';
                const timeAgo = (() => {
                  if (!ach.executed_at) return '';
                  const diff = Date.now() - new Date(ach.executed_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })();
                return (
                  <View
                    key={ach.id}
                    style={[styles.dealRow, i < agentAchievements.length - 1 && styles.dealRowBorder]}
                  >
                    <View style={[styles.dealIconWrap, { backgroundColor: `${color}18` }]}>
                      <Zap size={13} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dealBuyerName}>{agentWinLabel(ach)}</Text>
                      <Text style={styles.dealMeta}>{agentLabel(ach.agent_type)}</Text>
                    </View>
                    <Text style={styles.dealTime}>{timeAgo}</Text>
                  </View>
                );
              })
            )}
          </View>

          {/* ── Goals Reached ── */}
          {goalCompletions.length > 0 && (
            <View style={[styles.achievementCard, { marginTop: 8 }]}>
              <View style={styles.achievementHeader}>
                <Star size={13} color="#A78BFA" />
                <Text style={[styles.achievementLabel, { color: '#A78BFA' }]}>GOALS REACHED</Text>
              </View>
              {goalCompletions.map((comp, i) => {
                const color = agentColors[comp.agent_type] || '#64748B';
                return (
                  <View
                    key={comp.id}
                    style={[styles.dealRow, i < goalCompletions.length - 1 && styles.dealRowBorder]}
                  >
                    <View style={[styles.dealIconWrap, { backgroundColor: `${color}18` }]}>
                      <CheckCircle size={14} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dealBuyerName}>{comp.strategy_name}</Text>
                      <Text style={styles.dealMeta}>{comp.agent_type} Agent · {comp.goal}</Text>
                    </View>
                    <View style={[styles.dealStatusBadge, { backgroundColor: `${color}18` }]}>
                      <Text style={[styles.dealStatusText, { color }]}>Done</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* GMaps Leads Section */}
        {gmapsLeads.length > 0 && (
          <Animated.View entering={FadeInDown.delay(325).springify()} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MapPin size={18} color="#00D9A5" />
                <Text style={styles.sectionTitle}>Local Business Leads</Text>
              </View>
              <View style={styles.gmapsBadge}>
                <Text style={styles.gmapsBadgeText}>{gmapsLeads.length}</Text>
              </View>
            </View>

            <View style={styles.gmapsCard}>
              <View style={styles.gmapsHeader}>
                <Building2 size={12} color="#00D9A5" />
                <Text style={styles.gmapsHeaderLabel}>DISCOVERED VIA GOOGLE MAPS</Text>
                <View style={styles.gmapsLiveDot} />
                <Text style={styles.gmapsLiveText}>AUTO</Text>
              </View>

              {gmapsLeads.map((lead, i) => {
                const sig = (lead.intent_signals || []).find(s => s.source === 'google_maps_discovery') || {};
                const score = Math.round((lead.intent_score ?? 0) * 100);
                const scoreColor = score >= 75 ? '#10B981' : score >= 55 ? '#F59E0B' : '#64748B';
                const stageColors: Record<string, string> = {
                  identified: '#64748B', contacted: '#00F0FF',
                  warm: '#F59E0B', closed: '#10B981',
                };
                const stageColor = stageColors[lead.stage] || '#64748B';
                const timeAgo = (() => {
                  const diff = Date.now() - new Date(lead.created_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 60) return `${mins}m ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })();

                return (
                  <View
                    key={lead.id}
                    style={[styles.gmapsRow, i < gmapsLeads.length - 1 && styles.gmapsRowBorder]}
                  >
                    <View style={styles.gmapsIconWrap}>
                      {lead.platform === 'whatsapp'
                        ? <Phone size={13} color="#25D366" />
                        : <Mail size={13} color="#00F0FF" />
                      }
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.gmapsBizName} numberOfLines={1}>{lead.platform_username}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {sig.rating != null && (
                          <Text style={styles.gmapsMeta}>★ {sig.rating}</Text>
                        )}
                        {sig.total_ratings != null && (
                          <Text style={styles.gmapsMeta}>· {sig.total_ratings} reviews</Text>
                        )}
                      </View>
                      {sig.outreach_reason ? (
                        <Text style={styles.gmapsReason} numberOfLines={1}>{sig.outreach_reason}</Text>
                      ) : null}
                    </View>

                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {/* Score bar */}
                      <View style={styles.gmapsScoreWrap}>
                        <View style={[styles.gmapsScoreBar, { width: `${score}%` as any, backgroundColor: scoreColor }]} />
                        <Text style={[styles.gmapsScoreText, { color: scoreColor }]}>{score}%</Text>
                      </View>
                      {/* Stage badge */}
                      <View style={[styles.gmapsStageBadge, { backgroundColor: `${stageColor}18` }]}>
                        <Text style={[styles.gmapsStageText, { color: stageColor }]}>
                          {lead.stage?.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.gmapsTime}>{timeAgo}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Animated.View>
        )}

        {/* Campaign Performance Chart */}
        {activeStrategies.length > 0 && (
          <Animated.View entering={FadeInDown.delay(335).springify()} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TrendingUp size={18} color="#A78BFA" />
                <Text style={styles.sectionTitle}>Campaign Performance</Text>
              </View>
              <View style={[styles.sectionCount, { backgroundColor: 'rgba(167,139,250,0.12)' }]}>
                <Text style={{ color: '#A78BFA', fontWeight: '700', fontSize: 13 }}>LIVE</Text>
              </View>
            </View>

            <PerformanceChart strategies={activeStrategies} userId={session?.user?.id || ''} />
          </Animated.View>
        )}

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
        </>}
      </ScrollView>
    </SafeAreaView>
    </>
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
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginRight: 8 },
  statusText: { flex: 1, color: '#94A3B8', fontSize: 13, fontWeight: '500' },
  statusCount: { color: '#00F0FF', fontSize: 13, fontWeight: '700' },
  agentPanel: {
    backgroundColor: 'rgba(0,240,255,0.04)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)', marginBottom: 10, overflow: 'hidden',
  },
  agentPanelHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.1)',
  },
  agentPanelTitle: { flex: 1, color: '#00F0FF', fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8 },
  agentLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#EF4444' },
  agentLiveText: { color: '#EF4444', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  agentTaskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.06)',
  },
  agentAvatarSmall: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(0,240,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  agentTaskLabel: { color: '#E2E8F0', fontWeight: '700', fontSize: 13 },
  agentTaskSub: { color: '#64748B', fontSize: 11, marginTop: 1 },
  agentStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  agentRunning: { backgroundColor: 'rgba(16,185,129,0.1)' },
  agentPending: { backgroundColor: 'rgba(245,158,11,0.1)' },
  agentStatusText: { fontSize: 11, fontWeight: '700' },
  strategyAgentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 6,
    backgroundColor: 'rgba(0,240,255,0.04)',
    borderTopWidth: 1, borderTopColor: 'rgba(0,240,255,0.08)',
  },
  strategyAgentText: { color: '#00F0FF', fontSize: 11, fontWeight: '600' },
  energyCard: {
    backgroundColor: '#151B2B', borderRadius: 14, borderWidth: 1, borderColor: '#1E293B',
    padding: 14, marginBottom: 12,
  },
  // ─── Metrics Grid ─────────────────────────────────────────────────────────
  metricsSection: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', marginBottom: 16, overflow: 'hidden',
  },
  metricsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#1E2130',
  },
  metricsSectionTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  metricsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
  },
  metricCell: {
    width: '33.33%', alignItems: 'center', paddingVertical: 14,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#1E2130',
  },
  metricIconWrap: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  metricValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginBottom: 2 },
  metricLabel: { color: '#64748B', fontSize: 9, fontWeight: '500', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 },

  // ─── Achievements ──────────────────────────────────────────────────────────
  achCountBadge: {
    backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  achCountText: { color: '#F59E0B', fontWeight: '700', fontSize: 13 },
  revenueBanner: {
    backgroundColor: 'rgba(251,191,36,0.07)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)',
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, marginBottom: 10,
  },
  revenueIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(251,191,36,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  revenueLabel: { color: '#94A3B8', fontSize: 11, marginBottom: 2 },
  revenueValue: { color: '#FBBF24', fontSize: 20, fontWeight: '800' },
  dealRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dealRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1A2035' },
  dealStatusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  dealStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  dealDelivery: { color: '#475569', fontSize: 10 },
  achEmpty: { alignItems: 'center', paddingVertical: 18, gap: 6 },
  achEmptyText: { color: '#334155', fontSize: 12 },
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginLeft: 8 },
  sectionCount: {
    color: '#00F0FF', fontWeight: '700', fontSize: 13,
    backgroundColor: 'rgba(0,240,255,0.1)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  strategyCard: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', marginBottom: 10, overflow: 'hidden',
  },
  strategyCardTop: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, paddingBottom: 12 },
  strategyName: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  strategyMeta: { flexDirection: 'row', alignItems: 'center' },
  strategyMetaText: { color: '#64748B', fontSize: 12, textTransform: 'capitalize' },
  strategyMetaDot: { color: '#334155', marginHorizontal: 6, fontSize: 12 },
  strategyBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  strategyBadgeDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 5 },
  strategyBadgeText: { fontSize: 10, fontWeight: '700' },
  strategyStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#1E293B' },
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

  achievementCard: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  achievementHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(16,185,129,0.1)',
  },
  achievementLabel: {
    flex: 1, color: '#10B981', fontWeight: '700', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  achievementLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10B981' },
  achievementRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  achievementBorder: { borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  dealIconWrap: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: 'rgba(16,185,129,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  dealBuyerName: { color: '#E2E8F0', fontWeight: '700', fontSize: 13 },
  dealMeta: { color: '#64748B', fontSize: 11, marginTop: 1, textTransform: 'capitalize' },
  dealValue: { color: '#10B981', fontWeight: '800', fontSize: 13 },
  dealTime: { color: '#475569', fontSize: 10, marginTop: 1 },

  // ─── GMaps Leads ─────────────────────────────────────────────────────────────
  gmapsBadge: {
    backgroundColor: 'rgba(0,217,165,0.12)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  gmapsBadgeText: { color: '#00D9A5', fontWeight: '700', fontSize: 13 },
  gmapsCard: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(0,217,165,0.2)', overflow: 'hidden',
  },
  gmapsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,217,165,0.1)',
  },
  gmapsHeaderLabel: {
    flex: 1, color: '#00D9A5', fontWeight: '700', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  gmapsLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#00D9A5' },
  gmapsLiveText: { color: '#00D9A5', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  gmapsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  gmapsRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  gmapsIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: 'rgba(0,217,165,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  gmapsBizName: { color: '#E2E8F0', fontWeight: '700', fontSize: 13 },
  gmapsMeta: { color: '#64748B', fontSize: 11 },
  gmapsReason: { color: '#475569', fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  gmapsScoreWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    width: 72, height: 16,
    backgroundColor: '#1E293B', borderRadius: 4, overflow: 'hidden',
    position: 'relative',
  },
  gmapsScoreBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    borderRadius: 4, opacity: 0.35,
  },
  gmapsScoreText: { fontSize: 10, fontWeight: '700', width: '100%', textAlign: 'center', zIndex: 1 },
  gmapsStageBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  gmapsStageText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  gmapsTime: { color: '#334155', fontSize: 10 },
});
