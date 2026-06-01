import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  RefreshControl, StyleSheet, Animated as RNAnimated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import {
  ArrowLeft, RefreshCw, Search, Target, Users, Zap,
  ChevronDown, ChevronUp, MessageCircle, Clock,
  TrendingUp, Circle, CheckCircle2, Star, AlertCircle, X,
} from 'lucide-react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  platform: string;
  platform_user_id: string;
  platform_username: string;
  first_interaction: string;
  intent_score: number;
  intent_signals: IntentSignal[];
  stage: string;
  dm_sequence_step: number;
  last_contacted_at?: string;
  next_followup_at?: string;
  created_at: string;
}

interface IntentSignal {
  source: string;
  text?: string;
  display_name?: string;
  score: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PLATFORM_COLORS: Record<string, string> = {
  facebook:  '#1877F2',
  instagram: '#E1306C',
  tiktok:    '#FE2C55',
  twitter:   '#1DA1F2',
  linkedin:  '#0A66C2',
  whatsapp:  '#25D366',
  email:     '#10B981',
};

const STAGE_META: Record<string, { label: string; color: string; filter: string }> = {
  identified:  { label: 'New',          color: '#00F0FF', filter: 'new' },
  engaged:     { label: 'Following Up', color: '#A78BFA', filter: 'active' },
  nurturing:   { label: 'Nurturing',    color: '#F59E0B', filter: 'active' },
  closed:      { label: 'Won',          color: '#10B981', filter: 'won' },
  closed_won:  { label: 'Won',          color: '#10B981', filter: 'won' },
  lost:        { label: 'Lost',         color: '#EF4444', filter: 'won' },
};

function intentColor(score: number): string {
  if (score >= 0.8) return '#10B981';
  if (score >= 0.6) return '#F59E0B';
  return '#64748B';
}

function intentLabel(score: number): string {
  if (score >= 0.8) return 'HOT';
  if (score >= 0.6) return 'WARM';
  return 'COOL';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function platformInitial(platform: string): string {
  return platform.charAt(0).toUpperCase();
}

// ─── Lead Card ────────────────────────────────────────────────────────────────
function LeadCard({ lead, index, onPress }: { lead: Lead; index: number; onPress: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const stageMeta = STAGE_META[lead.stage] || { label: lead.stage, color: '#64748B', filter: 'new' };
  const platformColor = PLATFORM_COLORS[lead.platform] || '#64748B';
  const scoreColor = intentColor(lead.intent_score);
  const scoreLabel = intentLabel(lead.intent_score);
  const scorePercent = Math.round(lead.intent_score * 100);
  const signals: IntentSignal[] = Array.isArray(lead.intent_signals) ? lead.intent_signals : [];
  const dmStep = lead.dm_sequence_step || 0;

  const isFollowUpDue = lead.next_followup_at
    ? new Date(lead.next_followup_at).getTime() <= Date.now()
    : false;

  return (
    <Animated.View entering={FadeInRight.delay(index * 50).springify()}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onLongPress={() => setExpanded(e => !e)}
        activeOpacity={0.85}
      >
        {/* ── Top row ── */}
        <View style={styles.cardTop}>
          {/* Avatar */}
          <View style={[styles.avatar, { backgroundColor: `${platformColor}20`, borderColor: `${platformColor}40` }]}>
            <Text style={[styles.avatarText, { color: platformColor }]}>
              {platformInitial(lead.platform)}
            </Text>
          </View>

          {/* Name + platform */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.leadName} numberOfLines={1}>{lead.platform_username}</Text>
              <View style={[styles.stageBadge, { backgroundColor: `${stageMeta.color}18` }]}>
                <Text style={[styles.stageBadgeText, { color: stageMeta.color }]}>{stageMeta.label}</Text>
              </View>
              {isFollowUpDue && lead.stage !== 'closed' && lead.stage !== 'closed_won' && (
                <View style={styles.dueBadge}>
                  <AlertCircle size={9} color="#F59E0B" />
                  <Text style={styles.dueBadgeText}>Follow-up due</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <Text style={[styles.platformTag, { color: platformColor }]}>
                {lead.platform.charAt(0).toUpperCase() + lead.platform.slice(1)}
              </Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.timeText}>{timeAgo(lead.created_at)}</Text>
            </View>
          </View>

          {/* Intent badge + expand */}
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.intentBadge, { backgroundColor: `${scoreColor}18` }]}>
              <Text style={[styles.intentBadgeText, { color: scoreColor }]}>{scoreLabel}</Text>
            </View>
            {expanded
              ? <ChevronUp size={14} color="#475569" />
              : <ChevronDown size={14} color="#475569" />}
          </View>
        </View>

        {/* ── Intent bar ── */}
        <View style={styles.intentRow}>
          <Text style={styles.intentLabel}>Intent</Text>
          <View style={styles.intentBarTrack}>
            <View style={[styles.intentBarFill, { width: `${scorePercent}%`, backgroundColor: scoreColor }]} />
          </View>
          <Text style={[styles.intentScore, { color: scoreColor }]}>{scorePercent}%</Text>
        </View>

        {/* ── First interaction preview ── */}
        {lead.first_interaction ? (
          <Text style={styles.preview} numberOfLines={expanded ? undefined : 2}>
            "{lead.first_interaction}"
          </Text>
        ) : null}

        {/* ── Expanded detail ── */}
        {expanded && (
          <View style={styles.expandedSection}>
            <View style={styles.expandedDivider} />

            {/* DM sequence progress */}
            <View style={styles.detailRow}>
              <MessageCircle size={13} color="#64748B" />
              <Text style={styles.detailLabel}>DM Progress</Text>
              <View style={styles.dmStepRow}>
                {[0, 1, 2].map(step => (
                  <View
                    key={step}
                    style={[
                      styles.dmDot,
                      dmStep > step
                        ? { backgroundColor: '#10B981' }
                        : dmStep === step
                          ? { backgroundColor: '#F59E0B' }
                          : { backgroundColor: '#1E293B' },
                    ]}
                  />
                ))}
                <Text style={styles.dmStepText}>
                  {dmStep === 0 ? 'Not contacted yet' : `Step ${Math.min(dmStep, 3)} / 3`}
                </Text>
              </View>
            </View>

            {/* Last contacted */}
            {lead.last_contacted_at && (
              <View style={styles.detailRow}>
                <Clock size={13} color="#64748B" />
                <Text style={styles.detailLabel}>Last Contacted</Text>
                <Text style={styles.detailValue}>{timeAgo(lead.last_contacted_at)}</Text>
              </View>
            )}

            {/* Next follow-up */}
            {lead.next_followup_at && (
              <View style={styles.detailRow}>
                <Target size={13} color={isFollowUpDue ? '#F59E0B' : '#64748B'} />
                <Text style={styles.detailLabel}>Next Follow-up</Text>
                <Text style={[styles.detailValue, isFollowUpDue && { color: '#F59E0B' }]}>
                  {timeUntil(lead.next_followup_at)}
                </Text>
              </View>
            )}

            {/* Captured */}
            <View style={styles.detailRow}>
              <Star size={13} color="#64748B" />
              <Text style={styles.detailLabel}>Captured</Text>
              <Text style={styles.detailValue}>{timeAgo(lead.created_at)}</Text>
            </View>

            {/* Intent signals */}
            {signals.length > 0 && (
              <View style={styles.signalsSection}>
                <Text style={styles.signalsTitle}>Intent Signals</Text>
                {signals.map((sig, i) => (
                  <View key={i} style={styles.signalRow}>
                    <TrendingUp size={11} color={intentColor(sig.score)} />
                    <Text style={styles.signalSource}>
                      {sig.source.replace(/_/g, ' ')}
                    </Text>
                    <Text style={[styles.signalScore, { color: intentColor(sig.score) }]}>
                      {Math.round(sig.score * 100)}%
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
type FilterKey = 'all' | 'new' | 'active' | 'won';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'new',    label: 'New' },
  { key: 'active', label: 'Active' },
  { key: 'won',    label: 'Won' },
];

const PLATFORM_COLORS_LS: Record<string, string> = {
  facebook:  '#1877F2',
  instagram: '#E1306C',
  tiktok:    '#FE2C55',
  twitter:   '#1DA1F2',
  linkedin:  '#0A66C2',
  whatsapp:  '#25D366',
  email:     '#10B981',
};

type Props = NativeStackScreenProps<RootStackParamList, 'Leads'>;

export default function LeadsScreen({ route }: Props) {
  const navigation = useNavigation<any>();
  const { session } = useAuthStore();

  // Optional deep-link filters from ConversionTrackerPanel
  const strategyId = route?.params?.strategyId ?? null;
  const platformFilter = route?.params?.platform ?? null;

  const openConversation = (_lead: Lead) => {
    navigation.navigate('Interactions' as any);
  };

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const fetchLeads = useCallback(async () => {
    if (!session?.user) return;
    try {
      let query = supabase
        .from('agent_leads')
        .select('id, platform, platform_user_id, platform_username, first_interaction, intent_score, intent_signals, stage, dm_sequence_step, last_contacted_at, next_followup_at, created_at')
        .eq('user_id', session.user.id)
        .order('intent_score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (strategyId) query = query.eq('strategy_id', strategyId);
      if (platformFilter) query = query.eq('platform', platformFilter);

      const { data, error } = await query;
      if (!error && data) setLeads(data as Lead[]);
    } catch (e) {
      console.error('LeadsScreen error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.user?.id, strategyId, platformFilter]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchLeads();
  }, [fetchLeads]));

  const onRefresh = () => {
    setRefreshing(true);
    fetchLeads();
  };

  // ── Filter + Search ──
  const filtered = leads.filter(lead => {
    if (filter !== 'all') {
      const meta = STAGE_META[lead.stage];
      if (!meta || meta.filter !== filter) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        lead.platform_username?.toLowerCase().includes(q) ||
        lead.platform?.toLowerCase().includes(q) ||
        lead.first_interaction?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── Summary stats ──
  const totalLeads = leads.length;
  const hotLeads   = leads.filter(l => l.intent_score >= 0.8).length;
  const dueLeads   = leads.filter(l =>
    l.next_followup_at &&
    new Date(l.next_followup_at).getTime() <= Date.now() &&
    l.stage !== 'closed' && l.stage !== 'closed_won',
  ).length;
  const wonLeads   = leads.filter(l => l.stage === 'closed' || l.stage === 'closed_won').length;

  const isFiltered = !!(strategyId || platformFilter);
  const platColor  = platformFilter ? (PLATFORM_COLORS_LS[platformFilter.toLowerCase()] ?? '#00F0FF') : '#00F0FF';

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ── Header ── */}
        <Animated.View entering={FadeInDown.delay(0).springify()} style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ArrowLeft size={20} color="#94A3B8" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Leads Inbox</Text>
            <Text style={styles.headerSub}>{totalLeads} captured · {hotLeads} hot</Text>
          </View>
          <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
            <RefreshCw size={17} color="#64748B" />
          </TouchableOpacity>
        </Animated.View>

        {/* ── Active filter banner ── */}
        {isFiltered && (
          <Animated.View entering={FadeInDown.delay(20).springify()} style={styles.filterBanner}>
            <View style={styles.filterBannerLeft}>
              <View style={[styles.filterBannerDot, { backgroundColor: platColor }]} />
              <Text style={styles.filterBannerText} numberOfLines={1}>
                {[
                  platformFilter && (platformFilter.charAt(0).toUpperCase() + platformFilter.slice(1)),
                  strategyId && 'this strategy',
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate('Leads')}
              style={styles.filterBannerClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={12} color="#64748B" />
              <Text style={styles.filterBannerClearText}>Clear filter</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ── Search ── */}
        <Animated.View entering={FadeInDown.delay(60).springify()} style={styles.searchRow}>
          <Search size={15} color="#475569" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search leads..."
            placeholderTextColor="#334155"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={{ color: '#475569', fontSize: 13 }}>✕</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* ── Filter Tabs ── */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterTab, filter === f.key && styles.filterTabActive]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterTabText, filter === f.key && styles.filterTabTextActive]}>
                {f.label}
              </Text>
              {f.key !== 'all' && (
                <Text style={[styles.filterTabCount, filter === f.key && { color: '#00F0FF' }]}>
                  {f.key === 'new'    ? leads.filter(l => STAGE_META[l.stage]?.filter === 'new').length
                    : f.key === 'active' ? leads.filter(l => STAGE_META[l.stage]?.filter === 'active').length
                    : wonLeads}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </Animated.View>

        {/* ── Summary Bar ── */}
        <Animated.View entering={FadeInDown.delay(140).springify()} style={styles.summaryBar}>
          {[
            { icon: Users,       color: '#00F0FF', value: totalLeads, label: 'Total' },
            { icon: Zap,         color: '#10B981', value: hotLeads,   label: 'Hot' },
            { icon: Clock,       color: '#F59E0B', value: dueLeads,   label: 'Due' },
            { icon: CheckCircle2,color: '#A78BFA', value: wonLeads,   label: 'Won' },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <View key={i} style={styles.summaryItem}>
                <Icon size={13} color={s.color} />
                <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.summaryLabel}>{s.label}</Text>
              </View>
            );
          })}
        </Animated.View>

        {/* ── Lead List ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />}
        >
          {loading ? (
            <View style={styles.emptyState}>
              <Circle size={32} color="#1E293B" />
              <Text style={styles.emptyTitle}>Loading leads…</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Target size={40} color="#1E293B" />
              <Text style={styles.emptyTitle}>
                {search.length > 0 ? 'No results' : filter === 'all' ? 'No leads yet' : `No ${filter} leads`}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search.length > 0
                  ? 'Try a different search term'
                  : filter === 'all'
                    ? 'Salesman AI captures leads from your posts automatically'
                    : `AI is working on finding ${filter} leads`}
              </Text>
            </View>
          ) : (
            filtered.map((lead, i) => (
              <LeadCard key={lead.id} lead={lead} index={i} onPress={() => openConversation(lead)} />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.07)',
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 18 },
  headerSub: { color: '#64748B', fontSize: 12, marginTop: 1 },
  refreshBtn: { padding: 8 },

  // ── Active filter banner ────────────────────────────────────────────────────
  filterBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginTop: 8, marginBottom: 2,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(0,240,255,0.05)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
  },
  filterBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  filterBannerDot: { width: 8, height: 8, borderRadius: 4 },
  filterBannerText: { color: '#E2E8F0', fontSize: 12, fontWeight: '600', flex: 1 },
  filterBannerClear: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  filterBannerClearText: { color: '#64748B', fontSize: 11, fontWeight: '600' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 10, marginBottom: 6,
    backgroundColor: '#151B2B', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: '#E2E8F0', fontSize: 14 },

  filterRow: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 10,
  },
  filterTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
  },
  filterTabActive: {
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderColor: 'rgba(0,240,255,0.3)',
  },
  filterTabText: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  filterTabTextActive: { color: '#00F0FF' },
  filterTabCount: {
    color: '#334155', fontSize: 10, fontWeight: '800',
    backgroundColor: '#1E293B', paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 6, minWidth: 18, textAlign: 'center',
  },

  summaryBar: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#151B2B', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B',
  },
  summaryItem: {
    flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3,
  },
  summaryValue: { fontSize: 16, fontWeight: '800' },
  summaryLabel: { color: '#475569', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },

  listContent: { paddingHorizontal: 16, paddingBottom: 32 },

  // ── Card ──
  card: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', marginBottom: 10,
    overflow: 'hidden', padding: 14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  avatar: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  avatarText: { fontSize: 16, fontWeight: '800' },
  leadName: { color: '#E2E8F0', fontWeight: '700', fontSize: 14 },
  stageBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  stageBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  dueBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20,
  },
  dueBadgeText: { color: '#F59E0B', fontSize: 9, fontWeight: '700' },
  platformTag: { fontSize: 11, fontWeight: '600' },
  dot: { color: '#334155', fontSize: 11 },
  timeText: { color: '#475569', fontSize: 11 },
  intentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  intentBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  intentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  intentLabel: { color: '#475569', fontSize: 10, width: 36 },
  intentBarTrack: {
    flex: 1, height: 5, borderRadius: 3, backgroundColor: '#1E293B', overflow: 'hidden',
  },
  intentBarFill: { height: '100%', borderRadius: 3 },
  intentScore: { fontSize: 11, fontWeight: '800', width: 30, textAlign: 'right' },

  preview: {
    color: '#64748B', fontSize: 12, fontStyle: 'italic',
    lineHeight: 18, marginBottom: 4,
  },

  // ── Expanded ──
  expandedSection: { marginTop: 4 },
  expandedDivider: { height: 1, backgroundColor: '#1E293B', marginBottom: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  detailLabel: { color: '#64748B', fontSize: 12, flex: 1 },
  detailValue: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },

  dmStepRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dmDot: { width: 8, height: 8, borderRadius: 4 },
  dmStepText: { color: '#64748B', fontSize: 11, marginLeft: 4 },

  signalsSection: { marginTop: 8 },
  signalsTitle: { color: '#475569', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  signalSource: { flex: 1, color: '#64748B', fontSize: 11, textTransform: 'capitalize' },
  signalScore: { fontSize: 11, fontWeight: '700' },

  // ── Empty ──
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { color: '#475569', fontSize: 16, fontWeight: '700' },
  emptySubtitle: { color: '#334155', fontSize: 13, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
});
