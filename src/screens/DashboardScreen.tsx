import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
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
  Trophy, Star, CheckCircle, DollarSign,
} from 'lucide-react-native';
import { useEnergyStore, PLAN_DETAILS } from '../store/energyStore';

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
  created_at: string;
}

interface GoalCompletion {
  id: string;
  agent_type: string;
  strategy_name: string;
  completed_at: string;
  goal: string;
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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const agentSubRef = useRef<any>(null);
  const dealsSubRef = useRef<any>(null);

  const fetchData = async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const [strategiesRes, logsRes, tasksRes, dealsRes, completedStratsRes] = await Promise.all([
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
          .select('id, buyer_name, product_name, deal_value, currency, platform, created_at')
          .eq('user_id', session.user.id)
          .eq('status', 'closed_won')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('strategies')
          .select('id, agent_type, goal, current_execution_plan, updated_at')
          .eq('user_id', session.user.id)
          .eq('is_active', false)
          .not('agent_type', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(5),
      ]);

      setActiveStrategies(strategiesRes.data || []);
      setAlerts(logsRes.data || []);
      setClosedDeals((dealsRes.data as ClosedDeal[]) || []);

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
    };
    return map[type?.toLowerCase()] ?? `${type} Agent`;
  };

  return (
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

        {/* Achievement Section */}
        {(closedDeals.length > 0 || goalCompletions.length > 0) && (
          <Animated.View entering={FadeInDown.delay(310).springify()} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Trophy size={18} color="#F59E0B" />
                <Text style={styles.sectionTitle}>Achievements</Text>
              </View>
              <View style={[styles.sectionCount, { backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 }]}>
                <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 13 }}>
                  {closedDeals.length + goalCompletions.length}
                </Text>
              </View>
            </View>

            {/* Closed Deals */}
            {closedDeals.length > 0 && (
              <View style={styles.achievementCard}>
                <View style={styles.achievementHeader}>
                  <DollarSign size={13} color="#10B981" />
                  <Text style={styles.achievementLabel}>DEALS CLOSED BY AI</Text>
                  <View style={styles.achievementLiveDot} />
                </View>
                {closedDeals.map((deal, i) => {
                  const timeAgo = (() => {
                    const diff = Date.now() - new Date(deal.created_at).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    return `${Math.floor(hrs / 24)}d ago`;
                  })();
                  return (
                    <View
                      key={deal.id}
                      style={[styles.achievementRow, i < closedDeals.length - 1 && styles.achievementBorder]}
                    >
                      <View style={styles.dealIconWrap}>
                        <CheckCircle size={14} color="#10B981" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dealBuyerName}>{deal.buyer_name}</Text>
                        <Text style={styles.dealMeta}>
                          {deal.product_name} · {deal.platform}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.dealValue}>
                          {deal.currency} {Number(deal.deal_value).toLocaleString()}
                        </Text>
                        <Text style={styles.dealTime}>{timeAgo}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Goal Completions */}
            {goalCompletions.length > 0 && (
              <View style={[styles.achievementCard, { marginTop: 8 }]}>
                <View style={styles.achievementHeader}>
                  <Star size={13} color="#A78BFA" />
                  <Text style={[styles.achievementLabel, { color: '#A78BFA' }]}>GOALS COMPLETED</Text>
                </View>
                {goalCompletions.map((comp, i) => {
                  const agentColors: Record<string, string> = {
                    SALESMAN: '#10B981', AWARENESS: '#00F0FF',
                    PROMOTION: '#F59E0B', LAUNCH: '#A78BFA',
                  };
                  const color = agentColors[comp.agent_type] || '#64748B';
                  return (
                    <View
                      key={comp.id}
                      style={[styles.achievementRow, i < goalCompletions.length - 1 && styles.achievementBorder]}
                    >
                      <View style={[styles.dealIconWrap, { backgroundColor: `${color}18` }]}>
                        <CheckCircle size={14} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dealBuyerName}>{comp.strategy_name}</Text>
                        <Text style={styles.dealMeta}>
                          {comp.agent_type} Agent · {comp.goal}
                        </Text>
                      </View>
                      <View style={[styles.agentStatusBadge, { backgroundColor: `${color}18` }]}>
                        <Text style={{ color, fontSize: 10, fontWeight: '700' }}>Done</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
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
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
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
});
