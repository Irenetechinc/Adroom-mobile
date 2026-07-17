import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { DrawerActions } from '@react-navigation/native';
import {
  Menu, MessageSquare, Heart, CornerDownRight, ThumbsUp, Edit3,
  Wifi, WifiOff, RefreshCw, ArrowLeft, Bot, User, MessageCircle,
  Clock, Send, Target, Calendar, CheckCircle2, Zap, AlertCircle, Users,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp, FadeInRight } from 'react-native-reanimated';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import { Skeleton } from '../components/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = 'interactions' | 'lead_dms';

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

interface Lead {
  id: string;
  platform: string;
  platform_username: string;
  platform_user_id: string;
  intent_score: number;
  stage: string;
  dm_sequence_step: number;
  first_interaction?: string;
  last_contacted_at?: string;
  next_followup_at?: string;
  created_at: string;
}

interface DmMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  message: string;
  persona_name?: string;
  sequence_step: number;
  sent_at: string;
  meta?: Record<string, any>;
}

interface ScheduledTask {
  id: string;
  scheduled_at: string;
  task_type: string;
  content: { body?: string; headline?: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877F2', instagram: '#E1306C', tiktok: '#FE2C55',
  twitter: '#1DA1F2', x: '#1DA1F2', linkedin: '#0A66C2',
  whatsapp: '#25D366', reddit: '#FF4500', news: '#64748B',
  forum: '#A78BFA', competitor: '#F59E0B',
};

const STAGE_COLORS: Record<string, string> = {
  new: '#64748B', warm: '#F59E0B', engaged: '#60A5FA',
  nurturing: '#A78BFA', closing: '#10B981', closed: '#10B981', won: '#10B981',
};

// ─── Helper functions ─────────────────────────────────────────────────────────

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

function timeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'Overdue';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function platformInitial(platform: string): string {
  switch (platform?.toLowerCase()) {
    case 'facebook': return 'f';
    case 'instagram': return 'IG';
    case 'tiktok': return 'T';
    case 'twitter': case 'x': return 'X';
    case 'linkedin': return 'in';
    case 'whatsapp': return 'WA';
    case 'reddit': return 'R';
    default: return platform?.[0]?.toUpperCase() || '?';
  }
}

function intentColor(score: number): string {
  if (score >= 0.8) return '#10B981';
  if (score >= 0.6) return '#F59E0B';
  return '#64748B';
}

function stepLabel(step: number): string {
  if (step === 0) return 'Introduction';
  if (step === 1) return 'Follow-up 1';
  if (step === 2) return 'Follow-up 2';
  return `Follow-up ${step}`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

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

function LeadListSkeleton() {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} scrollEnabled={false}>
      {[...Array(4)].map((_, i) => (
        <View key={i} style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', padding: 14, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Skeleton width={40} height={40} borderRadius={12} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="55%" height={13} borderRadius={4} />
              <Skeleton width="40%" height={11} borderRadius={4} />
            </View>
            <Skeleton width={50} height={22} borderRadius={6} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Interaction Card ─────────────────────────────────────────────────────────

const InteractionCard = ({ item, index }: { item: Interaction; index: number }) => {
  const pColor = PLATFORM_COLORS[item.platform?.toLowerCase()] || '#475569';
  return (
    <Animated.View entering={FadeInDown.delay(index * 40).springify()}>
      <View style={styles.card}>
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
              <View style={styles.iconBadge}><ThumbsUp size={10} color="#F59E0B" /></View>
            )}
            {item.isReplied && (
              <View style={styles.iconBadge}><Edit3 size={10} color="#10B981" /></View>
            )}
          </View>
        </View>
        <View style={styles.clientBubble}>
          {item.type === 'reply' && <CornerDownRight size={11} color="#60A5FA" style={{ marginBottom: 3 }} />}
          <Text style={styles.clientText}>{item.content}</Text>
        </View>
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

// ─── Lead List Card ───────────────────────────────────────────────────────────

const LeadCard = ({ lead, index, onPress }: { lead: Lead; index: number; onPress: () => void }) => {
  const pColor = PLATFORM_COLORS[lead.platform?.toLowerCase()] || '#64748B';
  const sColor = intentColor(lead.intent_score);
  const stageColor = STAGE_COLORS[lead.stage] || '#64748B';
  const stepsDone = lead.dm_sequence_step || 0;
  const isOverdue = lead.next_followup_at && new Date(lead.next_followup_at) <= new Date();

  return (
    <Animated.View entering={FadeInRight.delay(index * 50).springify()}>
      <TouchableOpacity style={styles.leadCard} onPress={onPress} activeOpacity={0.85}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[styles.leadAvatar, { backgroundColor: `${pColor}20`, borderColor: `${pColor}40` }]}>
            <Text style={[styles.leadAvatarText, { color: pColor }]}>
              {platformInitial(lead.platform)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.leadUsername} numberOfLines={1}>@{lead.platform_username}</Text>
              {isOverdue && (
                <View style={styles.overdueBadge}>
                  <Clock size={9} color="#F59E0B" />
                  <Text style={styles.overdueText}>Due</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <View style={[styles.stageBadge, { backgroundColor: `${stageColor}18` }]}>
                <Text style={[styles.stageBadgeText, { color: stageColor }]}>
                  {lead.stage}
                </Text>
              </View>
              <Text style={styles.leadMeta}>
                Step {stepsDone}/3
              </Text>
              {lead.last_contacted_at && (
                <Text style={styles.leadMeta}>· {timeAgo(lead.last_contacted_at)}</Text>
              )}
            </View>
          </View>
          <View style={[styles.intentBadge, { backgroundColor: `${sColor}15` }]}>
            <Text style={[styles.intentText, { color: sColor }]}>
              {Math.round(lead.intent_score * 100)}%
            </Text>
          </View>
        </View>
        {lead.first_interaction ? (
          <Text style={styles.firstInteraction} numberOfLines={1}>
            "{lead.first_interaction}"
          </Text>
        ) : null}
        <View style={styles.stepBar}>
          {[0, 1, 2].map(s => (
            <View key={s} style={[styles.stepDot, { backgroundColor: s < stepsDone ? sColor : '#1E293B' }]} />
          ))}
          <Text style={styles.stepBarLabel}>{stepsDone}/3 messages sent</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─── Conversation Thread (embedded) ──────────────────────────────────────────

const ConversationThread = ({
  lead,
  messages,
  scheduledTasks,
  loading,
  refreshing,
  onRefresh,
  onBack,
}: {
  lead: Lead;
  messages: DmMessage[];
  scheduledTasks: ScheduledTask[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const isFirstLoad = useRef(true);
  const insets = useSafeAreaInsets();
  const pColor = PLATFORM_COLORS[lead.platform?.toLowerCase()] || '#64748B';
  const sColor = intentColor(lead.intent_score);

  useEffect(() => {
    if (!loading && messages.length > 0) {
      // First load: instant snap to bottom (no animation flash)
      // Subsequent real-time appends: smooth animated scroll
      const animated = !isFirstLoad.current;
      if (isFirstLoad.current) isFirstLoad.current = false;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated }), animated ? 60 : 120);
    }
  }, [loading, messages.length]);

  return (
    <View style={{ flex: 1 }}>
      {/* Thread header */}
      <Animated.View entering={FadeInDown.delay(0).springify()} style={styles.threadHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <ArrowLeft size={20} color="#94A3B8" />
        </TouchableOpacity>
        <View style={[styles.leadAvatar, { backgroundColor: `${pColor}20`, borderColor: `${pColor}40` }]}>
          <Text style={[styles.leadAvatarText, { color: pColor }]}>
            {platformInitial(lead.platform)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.threadLeadName} numberOfLines={1}>@{lead.platform_username}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.threadPlatformTag, { color: pColor }]}>
              {lead.platform.charAt(0).toUpperCase() + lead.platform.slice(1)}
            </Text>
            <Text style={styles.threadDot}>·</Text>
            <View style={[styles.stagePill, { backgroundColor: `${sColor}18` }]}>
              <Text style={[styles.stagePillText, { color: sColor }]}>
                {Math.round(lead.intent_score * 100)}% intent
              </Text>
            </View>
          </View>
        </View>
        <View style={[styles.stepBadge, { backgroundColor: '#00F0FF18' }]}>
          <MessageCircle size={11} color="#00F0FF" />
          <Text style={styles.stepBadgeText}>Step {lead.dm_sequence_step}/3</Text>
        </View>
      </Animated.View>

      {/* First interaction context */}
      {lead.first_interaction ? (
        <Animated.View entering={FadeInDown.delay(40).springify()} style={styles.contextBanner}>
          <AlertCircle size={12} color="#F59E0B" />
          <Text style={styles.contextText} numberOfLines={2}>
            First signal: "{lead.first_interaction}"
          </Text>
        </Animated.View>
      ) : null}

      {/* Message thread */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 120, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color="#00F0FF" style={{ marginTop: 40 }} />
        ) : messages.length === 0 ? (
          <Animated.View entering={FadeInDown.delay(80).springify()} style={styles.emptyThread}>
            <View style={styles.emptyThreadIcon}><MessageCircle size={28} color="#1E293B" /></View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>
              AdRoom AI will send the first DM when the follow-up schedule runs.
            </Text>
          </Animated.View>
        ) : (
          messages.map((msg, i) => (
            <Animated.View
              key={msg.id}
              entering={FadeInUp.delay(i * 40).springify()}
              style={[styles.bubble, msg.direction === 'outbound' ? styles.bubbleOut : styles.bubbleIn]}
            >
              <View style={styles.bubbleMeta}>
                {msg.direction === 'outbound' ? (
                  <>
                    <Bot size={10} color="#00F0FF" />
                    <Text style={[styles.bubbleSender, { color: '#00F0FF' }]}>
                      {msg.persona_name ? `AI · ${msg.persona_name}` : 'AdRoom AI'}
                    </Text>
                    <Text style={styles.bubbleStep}>{stepLabel(msg.sequence_step)}</Text>
                  </>
                ) : (
                  <>
                    <User size={10} color={pColor} />
                    <Text style={[styles.bubbleSender, { color: pColor }]}>@{lead.platform_username}</Text>
                  </>
                )}
                <Text style={styles.bubbleTime}>{timeAgo(msg.sent_at)}</Text>
              </View>
              <View style={[
                styles.bubbleBody,
                msg.direction === 'outbound' ? styles.bubbleBodyOut : styles.bubbleBodyIn,
              ]}>
                <Text style={[
                  styles.bubbleText,
                  msg.direction === 'outbound' ? styles.bubbleTextOut : styles.bubbleTextIn,
                ]}>
                  {msg.message}
                </Text>
              </View>
              {msg.direction === 'outbound' && (
                <View style={styles.deliveredRow}>
                  <CheckCircle2 size={9} color="#10B981" />
                  <Text style={styles.deliveredText}>Sent</Text>
                </View>
              )}
            </Animated.View>
          ))
        )}

        {/* Next scheduled message */}
        {scheduledTasks.length > 0 && !loading && (
          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.nextMsgSection}>
            <View style={styles.nextMsgHeader}>
              <Zap size={12} color="#F59E0B" />
              <Text style={styles.nextMsgTitle}>Next Scheduled Message</Text>
            </View>
            <View style={styles.nextMsgCard}>
              <View style={styles.nextMsgMeta}>
                <Calendar size={11} color="#64748B" />
                <Text style={styles.nextMsgTime}>{timeUntil(scheduledTasks[0].scheduled_at)}</Text>
                <Text style={styles.nextMsgType}>{scheduledTasks[0].task_type}</Text>
              </View>
              <Text style={styles.nextMsgPreview}>
                {scheduledTasks[0].content?.body || scheduledTasks[0].content?.headline ||
                  'AI Brain will generate this message fresh at send time based on latest context.'}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Timeline */}
        {!loading && (
          <Animated.View entering={FadeInDown.delay(240).springify()} style={styles.timeline}>
            <View style={styles.timelineRow}>
              <Target size={11} color="#64748B" />
              <Text style={styles.timelineLabel}>Lead captured</Text>
              <Text style={styles.timelineValue}>{timeAgo(lead.created_at)}</Text>
            </View>
            {lead.last_contacted_at && (
              <View style={styles.timelineRow}>
                <Send size={11} color="#64748B" />
                <Text style={styles.timelineLabel}>Last contacted</Text>
                <Text style={styles.timelineValue}>{timeAgo(lead.last_contacted_at)}</Text>
              </View>
            )}
            {lead.next_followup_at && (
              <View style={styles.timelineRow}>
                <Clock size={11} color={new Date(lead.next_followup_at) <= new Date() ? '#F59E0B' : '#64748B'} />
                <Text style={styles.timelineLabel}>Next follow-up</Text>
                <Text style={[styles.timelineValue, new Date(lead.next_followup_at) <= new Date() && { color: '#F59E0B' }]}>
                  {timeUntil(lead.next_followup_at)}
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function InteractionsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, session } = useAuthStore();

  // Tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>('interactions');

  // ── Interactions tab state ────────────────────────────────────────────────
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<any>(null);

  // ── Lead DMs tab state ────────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsRefreshing, setLeadsRefreshing] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadMessages, setLeadMessages] = useState<DmMessage[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesRefreshing, setMessagesRefreshing] = useState(false);

  // Ref so realtime callbacks always see the latest selectedLead without stale closure
  const selectedLeadRef = useRef<Lead | null>(null);
  useEffect(() => { selectedLeadRef.current = selectedLead; }, [selectedLead]);

  // ── Map helpers ───────────────────────────────────────────────────────────

  const mapComment = (row: any): Interaction => ({
    id: row.id, type: row.parent_id ? 'reply' : 'comment',
    platform: row.platform || 'facebook',
    clientName: row.author_name || 'User',
    content: row.content || '',
    adroomReply: row.reply_content || undefined,
    isReplied: !!row.is_replied, isLiked: !!row.is_liked,
    parentId: row.parent_id || undefined,
    externalId: row.external_id || undefined,
    createdAt: row.created_at,
  });

  const mapMessage = (row: any): Interaction => ({
    id: row.id, type: 'message',
    platform: row.platform || 'facebook',
    clientName: row.sender_name || 'User',
    content: row.content || '',
    adroomReply: row.reply_content || (row.is_replied ? '(replied via AdRoom AI)' : undefined),
    isReplied: !!row.is_replied, isLiked: !!row.is_liked,
    createdAt: row.created_at,
  });

  // ── Load interactions ─────────────────────────────────────────────────────

  const loadInteractions = useCallback(async () => {
    if (!isSupabaseConfigured || !user) return;
    try {
      const [commentsRes, messagesRes] = await Promise.all([
        supabase.from('comments').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(60),
        supabase.from('messages').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(60),
      ]);
      const all = [
        ...(commentsRes.data || []).map(mapComment),
        ...(messagesRes.data || []).map(mapMessage),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setInteractions(all);
    } catch (e) {
      console.error('[Interactions] Load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // ── Load leads ────────────────────────────────────────────────────────────

  const loadLeads = useCallback(async () => {
    if (!isSupabaseConfigured || !user) return;
    try {
      const { data } = await supabase
        .from('agent_leads')
        .select('id, platform, platform_username, platform_user_id, intent_score, stage, dm_sequence_step, first_interaction, last_contacted_at, next_followup_at, created_at')
        .eq('user_id', user.id)
        .not('stage', 'eq', 'lost')
        .order('last_contacted_at', { ascending: false })
        .limit(80);
      setLeads(data as Lead[] || []);
    } catch (e) {
      console.error('[Interactions] Load leads error:', e);
    } finally {
      setLeadsLoading(false);
      setLeadsRefreshing(false);
    }
  }, [user]);

  // ── Load messages for selected lead ──────────────────────────────────────

  const loadLeadMessages = useCallback(async (lead: Lead) => {
    if (!session?.user?.id || !lead?.id) return;
    setMessagesLoading(true);
    try {
      const [msgRes, taskRes] = await Promise.all([
        supabase.from('lead_dm_messages')
          .select('id, direction, message, persona_name, sequence_step, sent_at, meta')
          .eq('lead_id', lead.id)
          .order('sent_at', { ascending: true })
          .limit(100),
        supabase.from('agent_tasks')
          .select('id, scheduled_at, task_type, content')
          .eq('user_id', session.user.id)
          .in('task_type', ['DM_BLAST', 'FOLLOW_UP', 'DM'])
          .eq('status', 'pending')
          .eq('platform', lead.platform)
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(3),
      ]);
      setLeadMessages((msgRes.data as DmMessage[]) || []);
      setScheduledTasks((taskRes.data as ScheduledTask[]) || []);
    } catch (e) {
      console.error('[Interactions] Load lead messages error:', e);
    } finally {
      setMessagesLoading(false);
      setMessagesRefreshing(false);
    }
  }, [session?.user?.id]);

  // ── Realtime subscription ─────────────────────────────────────────────────

  const subscribeRealtime = useCallback(() => {
    if (!isSupabaseConfigured || !user) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel(`interactions-${user.id}`)

      // ── Interactions tab: comments + messages ──────────────────────────────
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `user_id=eq.${user.id}` },
        () => loadInteractions()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `user_id=eq.${user.id}` },
        () => loadInteractions()
      )

      // ── Lead DMs tab: agent_leads list ─────────────────────────────────────
      // Refreshes the lead list whenever a lead is created, updated, or deleted.
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'agent_leads', filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          loadLeads();
          // If the updated lead is the one currently being viewed, update it
          const current = selectedLeadRef.current;
          if (current && payload.new && payload.new.id === current.id) {
            setSelectedLead((prev) => prev ? { ...prev, ...payload.new } : prev);
          }
        }
      )

      // ── Lead DMs tab: lead_dm_messages (new outbound/inbound DMs) ──────────
      // When the AI sends a DM or an inbound reply arrives, update the thread
      // instantly without requiring a manual pull-to-refresh.
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lead_dm_messages', filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const incoming = payload.new as DmMessage & { lead_id: string };
          // Always refresh the lead list so "last contacted" times update
          loadLeads();
          // If this message belongs to the currently open conversation, append it
          const current = selectedLeadRef.current;
          if (current && incoming.lead_id === current.id) {
            setLeadMessages((prev) => {
              // Avoid duplicates in case a full refresh already added it
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, incoming];
            });
          }
        }
      )

      // ── Lead DMs tab: scheduled task changes ──────────────────────────────
      // Keeps the "Next Scheduled Message" preview up to date when the scheduler
      // creates or completes a follow-up task for a lead on the current platform.
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tasks', filter: `user_id=eq.${user.id}` },
        () => {
          const current = selectedLeadRef.current;
          if (current) loadLeadMessages(current);
        }
      )

      .subscribe((status: string) => setConnected(status === 'SUBSCRIBED'));

    channelRef.current = channel;
  }, [user, loadInteractions, loadLeads, loadLeadMessages]);

  useEffect(() => {
    loadInteractions();
    loadLeads();
    subscribeRealtime();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [loadInteractions, loadLeads, subscribeRealtime]);

  const onRefresh = () => { setRefreshing(true); loadInteractions(); };
  const onLeadsRefresh = () => { setLeadsRefreshing(true); loadLeads(); };
  const onMessagesRefresh = () => { setMessagesRefreshing(true); if (selectedLead) loadLeadMessages(selectedLead); };

  const openLead = (lead: Lead) => {
    setSelectedLead(lead);
    loadLeadMessages(lead);
  };

  const closeLead = () => {
    setSelectedLead(null);
    setLeadMessages([]);
    setScheduledTasks([]);
  };

  // ── Stats ─────────────────────────────────────────────────────────────────

  const commentCount = interactions.filter(i => i.type === 'comment').length;
  const messageCount = interactions.filter(i => i.type === 'message').length;
  const replyCount = interactions.filter(i => i.type === 'reply').length;

  const hotLeads = leads.filter(l => l.intent_score >= 0.7).length;
  const overdueLeads = leads.filter(l => l.next_followup_at && new Date(l.next_followup_at) <= new Date()).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (selectedLead) {
              closeLead();
            } else {
              navigation.dispatch(DrawerActions.openDrawer());
            }
          }}
          style={styles.menuBtn}
        >
          {selectedLead ? <ArrowLeft color="#E2E8F0" size={22} /> : <Menu color="#E2E8F0" size={22} />}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>
            {selectedLead ? `@${selectedLead.platform_username}` : 'Interactions'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.liveBadge, { borderColor: connected ? 'rgba(16,185,129,0.4)' : 'rgba(100,116,139,0.3)' }]}>
            {connected ? <Wifi size={11} color="#10B981" /> : <WifiOff size={11} color="#64748B" />}
            <Text style={[styles.liveText, { color: connected ? '#10B981' : '#64748B' }]}>
              {connected ? 'Live' : 'Offline'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={activeTab === 'interactions' ? onRefresh : selectedLead ? onMessagesRefresh : onLeadsRefresh}
            style={styles.refreshBtn}
          >
            <RefreshCw size={15} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab bar — hide when viewing a conversation thread */}
      {!selectedLead && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'interactions' && styles.tabActive]}
            onPress={() => setActiveTab('interactions')}
            activeOpacity={0.8}
          >
            <MessageSquare size={14} color={activeTab === 'interactions' ? '#00F0FF' : '#475569'} />
            <Text style={[styles.tabText, activeTab === 'interactions' && styles.tabTextActive]}>
              Comments & Messages
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'lead_dms' && styles.tabActive]}
            onPress={() => setActiveTab('lead_dms')}
            activeOpacity={0.8}
          >
            <Users size={14} color={activeTab === 'lead_dms' ? '#00F0FF' : '#475569'} />
            <Text style={[styles.tabText, activeTab === 'lead_dms' && styles.tabTextActive]}>
              Lead DMs
            </Text>
            {overdueLeads > 0 && (
              <View style={styles.overduePill}>
                <Text style={styles.overduePillText}>{overdueLeads}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── TAB 1: Comments & Messages ── */}
      {activeTab === 'interactions' && (
        <>
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
              <View style={styles.emptyIcon}><MessageSquare size={32} color="#1E293B" /></View>
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
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" colors={['#00F0FF']} />
              }
            />
          )}
        </>
      )}

      {/* ── TAB 2: Lead DMs ── */}
      {activeTab === 'lead_dms' && (
        <>
          {/* Conversation thread (when a lead is selected) */}
          {selectedLead ? (
            <ConversationThread
              lead={selectedLead}
              messages={leadMessages}
              scheduledTasks={scheduledTasks}
              loading={messagesLoading}
              refreshing={messagesRefreshing}
              onRefresh={onMessagesRefresh}
              onBack={closeLead}
            />
          ) : (
            <>
              {/* Lead DM stats */}
              <View style={styles.statsRow}>
                {[
                  { label: 'Active Leads', count: leads.length, color: '#60A5FA' },
                  { label: 'Hot (70%+)', count: hotLeads, color: '#10B981' },
                  { label: 'Follow-up Due', count: overdueLeads, color: '#F59E0B' },
                ].map((s) => (
                  <View key={s.label} style={styles.statCard}>
                    <Text style={[styles.statCount, { color: s.color }]}>{s.count}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>

              {leadsLoading ? (
                <LeadListSkeleton />
              ) : leads.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
                  <View style={styles.emptyIcon}><Users size={32} color="#1E293B" /></View>
                  <Text style={styles.emptyTitle}>No lead conversations yet</Text>
                  <Text style={styles.emptySubtitle}>
                    When the SALESMAN agent detects high-intent users, it starts DM conversations. They'll appear here.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={leads}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item, index }) => (
                    <LeadCard lead={item} index={index} onPress={() => openLead(item)} />
                  )}
                  contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24 }}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl refreshing={leadsRefreshing} onRefresh={onLeadsRefresh} tintColor="#00F0FF" colors={['#00F0FF']} />
                  }
                />
              )}
            </>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  // Tabs
  tabBar: {
    flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 8,
    gap: 8, borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#0F1623', borderWidth: 1, borderColor: '#1E293B',
  },
  tabActive: {
    backgroundColor: 'rgba(0,240,255,0.07)', borderColor: 'rgba(0,240,255,0.2)',
  },
  tabText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#00F0FF' },
  overduePill: {
    backgroundColor: '#F59E0B', borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  overduePillText: { color: '#000', fontSize: 9, fontWeight: '800' },

  // Stats
  statsRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: '#151B2B', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E293B', paddingVertical: 10, alignItems: 'center',
  },
  statCount: { fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#475569', fontSize: 10, fontWeight: '600', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Interaction card
  card: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', padding: 14, marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  platformBadge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  platformLetter: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  clientName: { color: '#E2E8F0', fontWeight: '700', fontSize: 14 },
  metaRow: { marginTop: 2, fontSize: 11 },
  typeTag: { fontWeight: '700', fontSize: 11 },
  timestamp: { color: '#475569', fontSize: 11 },
  iconBadge: {
    width: 22, height: 22, borderRadius: 6,
    backgroundColor: 'rgba(30,41,59,0.8)', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  clientBubble: {
    backgroundColor: '#0B0F19', borderRadius: 10, borderWidth: 1, borderColor: '#1E293B',
    padding: 10, marginBottom: 8,
  },
  clientText: { color: '#94A3B8', fontSize: 13, lineHeight: 19 },
  adroomBubble: {
    backgroundColor: 'rgba(0,240,255,0.05)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.12)', padding: 10,
  },
  adroomDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00F0FF' },
  adroomLabel: { color: '#00F0FF', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  adroomText: { color: '#E2E8F0', fontSize: 13, lineHeight: 19, marginTop: 2 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginTop: 2 },
  pendingText: { color: '#475569', fontSize: 11 },

  // Lead card
  leadCard: {
    backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B',
    padding: 14, marginBottom: 10, gap: 10,
  },
  leadAvatar: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  leadAvatarText: { fontSize: 14, fontWeight: '800' },
  leadUsername: { color: '#E2E8F0', fontWeight: '700', fontSize: 14, flex: 1 },
  overdueBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F59E0B18', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
  },
  overdueText: { color: '#F59E0B', fontSize: 9, fontWeight: '700' },
  stageBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  stageBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  leadMeta: { color: '#475569', fontSize: 11 },
  intentBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  intentText: { fontSize: 13, fontWeight: '800' },
  firstInteraction: {
    color: '#64748B', fontSize: 11, fontStyle: 'italic',
    backgroundColor: '#0B0F19', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#1E293B',
  },
  stepBar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 24, height: 4, borderRadius: 2 },
  stepBarLabel: { color: '#334155', fontSize: 10, marginLeft: 4 },

  // Thread header
  threadHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B', gap: 10,
  },
  backBtn: { padding: 6, marginRight: 2 },
  threadLeadName: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' },
  threadPlatformTag: { fontSize: 11, fontWeight: '600' },
  threadDot: { color: '#334155', fontSize: 11 },
  stagePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  stagePillText: { fontSize: 10, fontWeight: '700' },
  stepBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  stepBadgeText: { color: '#00F0FF', fontSize: 10, fontWeight: '700' },

  // Context banner
  contextBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#1A2236', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  contextText: { color: '#64748B', fontSize: 11, flex: 1, fontStyle: 'italic', lineHeight: 16 },

  // Thread messages
  emptyThread: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyThreadIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: '#0F1623',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: '#1E293B',
  },
  bubble: { gap: 4 },
  bubbleOut: { alignItems: 'flex-end' },
  bubbleIn: { alignItems: 'flex-start' },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  bubbleSender: { fontSize: 10, fontWeight: '600' },
  bubbleStep: {
    fontSize: 9, color: '#334155', backgroundColor: '#0F1623',
    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
  bubbleTime: { fontSize: 9, color: '#334155', marginLeft: 'auto' },
  bubbleBody: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
  bubbleBodyOut: { backgroundColor: '#00204A', borderTopRightRadius: 4 },
  bubbleBodyIn: { backgroundColor: '#151B2B', borderTopLeftRadius: 4, borderWidth: 1, borderColor: '#1E293B' },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  bubbleTextOut: { color: '#BAE6FD' },
  bubbleTextIn: { color: '#94A3B8' },
  deliveredRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2, marginRight: 2 },
  deliveredText: { fontSize: 9, color: '#10B981' },

  // Next message
  nextMsgSection: { marginTop: 12, marginBottom: 4 },
  nextMsgHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  nextMsgTitle: { color: '#F59E0B', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  nextMsgCard: {
    backgroundColor: '#12172A', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#F59E0B30',
  },
  nextMsgMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  nextMsgTime: { color: '#F59E0B', fontSize: 11, fontWeight: '600' },
  nextMsgType: { color: '#334155', fontSize: 10, marginLeft: 'auto' },
  nextMsgPreview: { color: '#64748B', fontSize: 12, lineHeight: 18, fontStyle: 'italic' },

  // Timeline
  timeline: {
    backgroundColor: '#0F1623', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#1E293B', gap: 8, marginTop: 8,
  },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineLabel: { color: '#475569', fontSize: 11, flex: 1 },
  timelineValue: { color: '#64748B', fontSize: 11, fontWeight: '600' },

  // Empty states
  emptyIcon: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: '#E2E8F0', fontWeight: '700', fontSize: 18, marginBottom: 8 },
  emptySubtitle: { color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
