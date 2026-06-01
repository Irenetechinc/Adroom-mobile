/**
 * Lead Conversation Screen
 * Full DM thread view for a single lead — shows every AI outbound message,
 * when it was sent, what step it was, plus the next scheduled message preview.
 * Pulls from:
 *  - lead_dm_messages  (each AI message logged at send time)
 *  - agent_tasks       (pending/scheduled DM tasks = next message preview)
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import {
  ArrowLeft, MessageCircle, Clock, Send, Bot, User,
  Target, Calendar, CheckCircle2, Zap, AlertCircle,
} from 'lucide-react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DmMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  message: string;
  persona_name?: string;
  sequence_step: number;
  sent_at: string;
  meta?: Record<string, any>;
}

interface ScheduledMessage {
  id: string;
  scheduled_at: string;
  task_type: string;
  content: { body?: string; headline?: string };
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877F2', instagram: '#E1306C', twitter: '#1DA1F2',
  linkedin: '#0A66C2', tiktok: '#FE2C55', reddit: '#FF4500',
  whatsapp: '#25D366', news: '#64748B', forum: '#A78BFA', nairaland: '#A78BFA', quora: '#B92B27',
};

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

function intentColor(score: number) {
  if (score >= 0.8) return '#10B981';
  if (score >= 0.6) return '#F59E0B';
  return '#64748B';
}

function stepLabel(step: number) {
  if (step === 0) return 'Introduction';
  if (step === 1) return 'Follow-up 1';
  if (step === 2) return 'Follow-up 2';
  return `Follow-up ${step}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function LeadConversationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { session } = useAuthStore();

  const lead: Lead = route.params?.lead;
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const platformColor = PLATFORM_COLORS[lead?.platform?.toLowerCase()] || '#64748B';
  const scoreColor = intentColor(lead?.intent_score || 0);

  const fetchData = useCallback(async () => {
    if (!session?.user?.id || !lead?.id) return;
    try {
      const [msgRes, taskRes] = await Promise.all([
        // All messages exchanged with this lead
        supabase
          .from('lead_dm_messages')
          .select('id, direction, message, persona_name, sequence_step, sent_at, meta')
          .eq('lead_id', lead.id)
          .order('sent_at', { ascending: true })
          .limit(100),

        // Next scheduled / pending DM tasks for this user on this platform lead
        supabase
          .from('agent_tasks')
          .select('id, scheduled_at, task_type, content')
          .eq('user_id', session.user.id)
          .in('task_type', ['DM_BLAST', 'FOLLOW_UP', 'DM'])
          .eq('status', 'pending')
          .eq('platform', lead.platform)
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(3),
      ]);

      if (msgRes.data) setMessages(msgRes.data as DmMessage[]);
      if (taskRes.data) setScheduled(taskRes.data as ScheduledMessage[]);
    } catch (e) {
      console.error('LeadConversationScreen fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
      // Scroll to bottom after load
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [session?.user?.id, lead?.id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]));

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (!lead) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Lead not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <Animated.View entering={FadeInDown.delay(0).springify()} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color="#94A3B8" />
        </TouchableOpacity>
        <View style={[styles.avatar, { backgroundColor: `${platformColor}20`, borderColor: `${platformColor}40` }]}>
          <Text style={[styles.avatarText, { color: platformColor }]}>
            {lead.platform.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.leadName} numberOfLines={1}>@{lead.platform_username}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.platformTag, { color: platformColor }]}>
              {lead.platform.charAt(0).toUpperCase() + lead.platform.slice(1)}
            </Text>
            <Text style={styles.dot}>·</Text>
            <View style={[styles.stagePill, { backgroundColor: `${scoreColor}15` }]}>
              <Text style={[styles.stagePillText, { color: scoreColor }]}>
                {Math.round((lead.intent_score || 0) * 100)}% intent
              </Text>
            </View>
          </View>
        </View>
        <View style={[styles.stepBadge, { backgroundColor: '#00F0FF18' }]}>
          <MessageCircle size={11} color="#00F0FF" />
          <Text style={styles.stepBadgeText}>Step {lead.dm_sequence_step}/3</Text>
        </View>
      </Animated.View>

      {/* ── First interaction context ── */}
      {lead.first_interaction ? (
        <Animated.View entering={FadeInDown.delay(60).springify()} style={styles.contextBanner}>
          <AlertCircle size={12} color="#F59E0B" />
          <Text style={styles.contextText} numberOfLines={2}>
            First signal: "{lead.first_interaction}"
          </Text>
        </Animated.View>
      ) : null}

      {/* ── Thread ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={[styles.threadContent, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00F0FF" />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color="#00F0FF" style={{ marginTop: 40 }} />
        ) : messages.length === 0 ? (
          <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.emptyThread}>
            <View style={styles.emptyIcon}><MessageCircle size={28} color="#1E293B" /></View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>
              AdRoom AI will send the first message when the follow-up schedule runs.
            </Text>
          </Animated.View>
        ) : (
          messages.map((msg, i) => (
            <Animated.View
              key={msg.id}
              entering={FadeInUp.delay(i * 40).springify()}
              style={[styles.bubble, msg.direction === 'outbound' ? styles.bubbleOut : styles.bubbleIn]}
            >
              {/* Sender label */}
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
                    <User size={10} color={platformColor} />
                    <Text style={[styles.bubbleSender, { color: platformColor }]}>
                      @{lead.platform_username}
                    </Text>
                  </>
                )}
                <Text style={styles.bubbleTime}>{timeAgo(msg.sent_at)}</Text>
              </View>

              {/* Message bubble */}
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

              {/* Delivery indicator for outbound */}
              {msg.direction === 'outbound' && (
                <View style={styles.deliveredRow}>
                  <CheckCircle2 size={9} color="#10B981" />
                  <Text style={styles.deliveredText}>Sent</Text>
                </View>
              )}
            </Animated.View>
          ))
        )}

        {/* ── Next Message Preview ── */}
        {scheduled.length > 0 && !loading && (
          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.nextMessageSection}>
            <View style={styles.nextMessageHeader}>
              <Zap size={12} color="#F59E0B" />
              <Text style={styles.nextMessageTitle}>Next Scheduled Message</Text>
            </View>
            {scheduled.slice(0, 1).map(task => (
              <View key={task.id} style={styles.nextMessageCard}>
                <View style={styles.nextMessageMeta}>
                  <Calendar size={11} color="#64748B" />
                  <Text style={styles.nextMessageTime}>{timeUntil(task.scheduled_at)}</Text>
                  <Text style={styles.nextMessageType}>{task.task_type}</Text>
                </View>
                {task.content?.body || task.content?.headline ? (
                  <Text style={styles.nextMessagePreview} numberOfLines={3}>
                    {task.content.body || task.content.headline}
                  </Text>
                ) : (
                  <Text style={styles.nextMessagePreview}>
                    AI Brain will generate this message fresh at send time based on latest context.
                  </Text>
                )}
              </View>
            ))}
          </Animated.View>
        )}

        {/* ── Timeline summary ── */}
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
                <Text style={[
                  styles.timelineValue,
                  new Date(lead.next_followup_at) <= new Date() && { color: '#F59E0B' },
                ]}>
                  {timeUntil(lead.next_followup_at)}
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#475569', fontSize: 14 },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B', gap: 10,
  },
  backBtn: { padding: 6, marginRight: 2 },
  avatar: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1,
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  leadName: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' },
  platformTag: { fontSize: 11, fontWeight: '600' },
  dot: { color: '#334155', fontSize: 11 },
  stagePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  stagePillText: { fontSize: 10, fontWeight: '700' },
  stepBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  stepBadgeText: { color: '#00F0FF', fontSize: 10, fontWeight: '700' },

  contextBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#1A2236', paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  contextText: { color: '#64748B', fontSize: 11, flex: 1, fontStyle: 'italic', lineHeight: 16 },

  thread: { flex: 1 },
  threadContent: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

  emptyThread: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: '#0F1623',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: '#1E293B',
  },
  emptyTitle: { color: '#E2E8F0', fontSize: 15, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { color: '#475569', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // Bubble layout
  bubble: { gap: 4 },
  bubbleOut: { alignItems: 'flex-end' },
  bubbleIn: { alignItems: 'flex-start' },

  bubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  bubbleSender: { fontSize: 10, fontWeight: '600' },
  bubbleStep: { fontSize: 9, color: '#334155', backgroundColor: '#0F1623', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  bubbleTime: { fontSize: 9, color: '#334155', marginLeft: 'auto' },

  bubbleBody: {
    maxWidth: '82%', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10,
  },
  bubbleBodyOut: { backgroundColor: '#00204A', borderTopRightRadius: 4 },
  bubbleBodyIn: { backgroundColor: '#151B2B', borderTopLeftRadius: 4, borderWidth: 1, borderColor: '#1E293B' },
  bubbleText: { fontSize: 13, lineHeight: 19 },
  bubbleTextOut: { color: '#BAE6FD' },
  bubbleTextIn: { color: '#94A3B8' },

  deliveredRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2, marginRight: 2 },
  deliveredText: { fontSize: 9, color: '#10B981' },

  // Next message
  nextMessageSection: { marginTop: 12, marginBottom: 4 },
  nextMessageHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  nextMessageTitle: { color: '#F59E0B', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  nextMessageCard: {
    backgroundColor: '#12172A', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#F59E0B30', borderStyle: 'dashed',
  },
  nextMessageMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  nextMessageTime: { color: '#F59E0B', fontSize: 11, fontWeight: '600' },
  nextMessageType: { color: '#334155', fontSize: 10, marginLeft: 'auto' },
  nextMessagePreview: { color: '#64748B', fontSize: 12, lineHeight: 18, fontStyle: 'italic' },

  // Timeline
  timeline: {
    backgroundColor: '#0F1623', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#1E293B', gap: 8, marginTop: 8,
  },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineLabel: { color: '#475569', fontSize: 11, flex: 1 },
  timelineValue: { color: '#64748B', fontSize: 11, fontWeight: '600' },
});
