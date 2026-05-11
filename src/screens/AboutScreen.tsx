import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ChevronLeft, TrendingUp, Users, Target, Zap, Globe, Star,
  Mail, ArrowRight, CheckCircle, MessageCircle, Camera, Video,
  Brain, BarChart2, Shield, Repeat, Send, Bell, Search,
  Activity,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

const COLORS = {
  neon: '#00F0FF',
  amber: '#F59E0B',
  purple: '#7C3AED',
  green: '#10B981',
  red: '#EF4444',
  orange: '#F97316',
  blue: '#3B82F6',
  bg: '#0B0F19',
  card: '#151B2B',
  border: '#1E293B',
  text: '#E2E8F0',
  sub: '#94A3B8',
  muted: '#64748B',
};

const RESULTS = [
  { value: '100%', label: 'Autonomous', sub: 'Zero manual tasks after setup' },
  { value: '$0', label: 'Ad Spend', sub: 'Fully organic — no paid campaigns' },
  { value: '24/7', label: 'Always On', sub: 'Never stops working for you' },
  { value: '5×', label: 'More Reach', sub: 'vs. traditional paid campaigns' },
];

const AUTONOMOUS_ACTIONS = [
  {
    icon: Camera,
    color: COLORS.neon,
    title: 'Original Content & Image Creation',
    body: 'AdRoom AI writes every post from scratch using real-time trend data, emotional signals, and your product context. It generates platform-native captions, hashtags, hooks, and original images tailored to each platform — Facebook, Instagram, TikTok, LinkedIn, and X — all without any input from you.',
  },
  {
    icon: Video,
    color: COLORS.purple,
    title: 'AI Video Production',
    body: 'AdRoom AI creates short-form video content and visual assets automatically. From concept to final output, it produces scroll-stopping videos designed specifically for TikTok, Instagram Reels, and Facebook stories — adapting style and pacing to what\'s trending right now.',
  },
  {
    icon: MessageCircle,
    color: COLORS.green,
    title: 'Comment Replies — Across All Platforms',
    body: 'Every comment on every post gets a thoughtful, on-brand reply — automatically. AdRoom AI reads sentiment, identifies buying signals, handles objections, and engages your audience 24/7 on Facebook, Instagram, TikTok, LinkedIn, and X. No comment goes unanswered.',
  },
  {
    icon: Send,
    color: COLORS.amber,
    title: 'Direct Message Outreach & Follow-Up',
    body: 'AdRoom AI sends personalised DMs to warm leads, interested followers, and potential buyers across every connected platform. It follows up intelligently — adjusting tone and timing based on prior interactions — with human-sounding conversations that actually convert.',
  },
  {
    icon: Target,
    color: COLORS.red,
    title: 'Lead Discovery & Sales Conversion',
    body: 'The Sales Intelligence Engine continuously scans engagement signals, comment threads, and even local business directories to find buyers who are ready now. It initiates contact, nurtures the conversation, and closes deals — without you ever needing to send a single message.',
  },
  {
    icon: Search,
    color: COLORS.orange,
    title: 'Local Business Outreach',
    body: 'AdRoom AI discovers local businesses in your target market and reaches out via WhatsApp and email with personalised, conversion-optimised pitches. It scores prospects by buying potential, prioritises the hottest leads, and manages the entire outreach sequence autonomously.',
  },
  {
    icon: Brain,
    color: COLORS.neon,
    title: 'Real-Time Social Intelligence',
    body: 'Four intelligence engines run continuously in the background — monitoring platform algorithm shifts, trending conversations, emotional ownership signals, and geographic narrative changes. Every post, reply, and DM AdRoom AI sends is informed by what\'s happening right now, not what worked last week.',
  },
  {
    icon: Repeat,
    color: COLORS.purple,
    title: 'Self-Optimising Campaigns',
    body: 'AdRoom AI monitors the real-time performance of every post — reach, engagement, click-throughs, and follower growth — and continuously adjusts its strategy. If something isn\'t working, it pivots automatically. Your campaigns improve every single day without any intervention.',
  },
  {
    icon: BarChart2,
    color: COLORS.green,
    title: 'Performance Tracking & Platform Metrics',
    body: 'AdRoom AI pulls live metrics directly from Facebook, Instagram, Twitter, LinkedIn, and TikTok APIs. It tracks what\'s working across every platform in real time and uses that data to refine content strategy, optimal post timing, and audience targeting — all autonomously.',
  },
  {
    icon: Bell,
    color: COLORS.amber,
    title: 'Autonomous Multi-Platform Publishing',
    body: 'AdRoom AI publishes posts, images, and videos at algorithmically optimal times across Facebook, Instagram, TikTok, LinkedIn, and X simultaneously. It manages scheduling, frequency, and format — ensuring each platform gets content calibrated specifically for its audience and algorithm.',
  },
  {
    icon: Activity,
    color: COLORS.red,
    title: 'Emotional Intelligence & Trend Ownership',
    body: 'AdRoom AI\'s Emotional Intelligence Engine identifies emotional categories your audience cares about — and ensures your brand owns those conversations before competitors do. It\'s not just about posting — it\'s about strategically dominating the narrative in your market.',
  },
  {
    icon: Shield,
    color: COLORS.blue,
    title: 'Not a Scheduler — A True AI Agent',
    body: 'Unlike platforms that just automate post scheduling, AdRoom AI makes real decisions. It reads context, interprets signals, crafts original responses, adapts strategy, and executes actions — the same things a full marketing team would do, running entirely on its own.',
  },
];

const PLATFORMS = ['Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'X (Twitter)'];

const PROMISES = [
  'Every post written from scratch — never recycled templates',
  'Real replies to real comments, not pre-scripted bots',
  'DMs that sound human because they\'re written for each person',
  'Campaigns that get smarter every day without your input',
  'All organic reach — zero dependency on paid ads',
  'Your data is encrypted and never shared or sold',
];

export default function AboutScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft color={COLORS.text} size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>About</Text>
          <Text style={styles.headerTitle}>AdRoom AI</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
      >
        {/* Hero */}
        <Animated.View entering={FadeInDown.delay(60).springify()} style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Image
              source={require('../../assets/icon.png')}
              style={{ width: 60, height: 60, borderRadius: 18 }}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.heroTitle}>Your Business's{'\n'}Autonomous Marketing Team</Text>
          <Text style={styles.heroSub}>
            AdRoom AI doesn't schedule posts. It creates content, replies to comments, sends DMs,
            follows up leads, tracks performance, and adapts strategy — entirely on its own, around the clock.
          </Text>
          <View style={styles.heroBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.heroBadgeText}>Always Active · Zero Ad Spend · 100% Organic</Text>
          </View>
        </Animated.View>

        {/* Results Strip */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.resultsRow}>
          {RESULTS.map((r, i) => (
            <View key={i} style={[styles.resultItem, i < RESULTS.length - 1 && styles.resultBorder]}>
              <Text style={styles.resultValue}>{r.value}</Text>
              <Text style={styles.resultLabel}>{r.label}</Text>
              <Text style={styles.resultSub}>{r.sub}</Text>
            </View>
          ))}
        </Animated.View>

        {/* What makes AdRoom different */}
        <Animated.View entering={FadeInDown.delay(140).springify()} style={styles.diffCard}>
          <View style={styles.diffHeader}>
            <View style={[styles.diffIcon, { backgroundColor: COLORS.neon + '15' }]}>
              <Brain size={20} color={COLORS.neon} />
            </View>
            <Text style={styles.diffTitle}>Not Automation. Actual Intelligence.</Text>
          </View>
          <Text style={styles.diffBody}>
            Every other "social media tool" lets you schedule posts in advance. AdRoom AI does something fundamentally different — it <Text style={{ color: COLORS.neon, fontWeight: '700' }}>reads, decides, and acts</Text> in real time.
          </Text>
          <Text style={[styles.diffBody, { marginTop: 10 }]}>
            When someone comments on your post at 2am, AdRoom AI reads that comment, understands the intent, and sends a thoughtful reply — one that sounds like your brand voice, not a bot. When a trend emerges, AdRoom AI rewrites your strategy around it before your competitors even notice.
          </Text>
          <Text style={[styles.diffBody, { marginTop: 10, color: COLORS.neon, fontWeight: '700' }]}>
            This is what a real AI agent looks like.
          </Text>
        </Animated.View>

        {/* Platforms */}
        <Animated.View entering={FadeInDown.delay(180).springify()} style={styles.platformCard}>
          <Text style={styles.sectionEyebrow}>Where It Works</Text>
          <Text style={styles.sectionHeading}>Every Major Platform, Fully Connected</Text>
          <View style={styles.platformRow}>
            {PLATFORMS.map((p, i) => (
              <View key={i} style={styles.platformTag}>
                <Text style={styles.platformTagText}>{p}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.diffBody, { marginTop: 12 }]}>
            AdRoom AI posts, replies, DMs, and tracks performance natively on every platform — using real API access, not workarounds.
          </Text>
        </Animated.View>

        {/* Autonomous Actions */}
        <Animated.View entering={FadeInDown.delay(220).springify()} style={styles.section}>
          <Text style={styles.sectionEyebrow}>What It Does For You</Text>
          <Text style={styles.sectionHeading}>Every Autonomous Action, Explained</Text>
          {AUTONOMOUS_ACTIONS.map((cap, i) => {
            const Icon = cap.icon;
            return (
              <View key={i} style={[styles.capRow, i < AUTONOMOUS_ACTIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 18, marginBottom: 18 }]}>
                <View style={[styles.capIcon, { backgroundColor: cap.color + '15' }]}>
                  <Icon size={20} color={cap.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.capTitle, { color: cap.color }]}>{cap.title}</Text>
                  <Text style={styles.capBody}>{cap.body}</Text>
                </View>
              </View>
            );
          })}
        </Animated.View>

        {/* No Paid Ads Callout */}
        <Animated.View entering={FadeInDown.delay(260).springify()} style={styles.calloutCard}>
          <View style={styles.calloutHeader}>
            <View style={styles.calloutIconWrap}>
              <Zap size={20} color={COLORS.amber} />
            </View>
            <Text style={styles.calloutTitle}>The $15,000 Agency Result — For a Fraction of the Cost</Text>
          </View>
          <Text style={styles.calloutBody}>
            A professional agency running paid campaigns at this level of reach and engagement would cost $10,000–$15,000 per month — and require a team of copywriters, designers, community managers, and media buyers.
          </Text>
          <Text style={[styles.calloutBody, { marginTop: 10 }]}>
            AdRoom AI delivers the same output — posts, replies, DMs, leads, brand growth — entirely organically and automatically. No agency. No ad budget. No team.
          </Text>
          <Text style={[styles.calloutBody, { marginTop: 10, color: COLORS.amber, fontWeight: '700' }]}>
            Your growth compounds. It never expires.
          </Text>
        </Animated.View>

        {/* Promises */}
        <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.section}>
          <Text style={styles.sectionEyebrow}>Our Commitment</Text>
          <Text style={styles.sectionHeading}>What You Can Always Count On</Text>
          {PROMISES.map((p, i) => (
            <View key={i} style={styles.promiseRow}>
              <CheckCircle size={16} color={COLORS.green} style={{ marginTop: 2, flexShrink: 0 }} />
              <Text style={styles.promiseText}>{p}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Mission */}
        <Animated.View entering={FadeInDown.delay(340).springify()} style={styles.missionCard}>
          <Text style={styles.missionQuote}>
            "Every business deserves world-class marketing. AdRoom AI exists to make that a reality —
            not a privilege reserved for those with the biggest budgets."
          </Text>
          <Text style={styles.missionAttrib}>— The AdRoom AI Team</Text>
        </Animated.View>

        {/* CTA */}
        <Animated.View entering={FadeInDown.delay(380).springify()} style={styles.contactCard}>
          <View style={styles.contactLeft}>
            <Mail size={18} color={COLORS.neon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>Talk to a Human</Text>
            <Text style={styles.contactSub}>Questions, partnerships, or enterprise enquiries</Text>
          </View>
          <TouchableOpacity
            onPress={() => Linking.openURL('mailto:support@adroomai.com')}
            style={styles.contactBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.contactBtnText}>Contact</Text>
            <ArrowRight size={13} color={COLORS.neon} />
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.footer}>
          © {new Date().getFullYear()} AdRoom AI · All rights reserved{'\n'}
          Version 2.2.10 · Built for ambitious businesses worldwide
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
  },
  backBtn: { marginRight: 14, padding: 4 },
  headerLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },

  scroll: { padding: 20 },

  hero: {
    alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20,
    backgroundColor: '#0D1526', borderRadius: 24,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.14)', marginBottom: 16,
  },
  heroIconWrap: {
    width: 88, height: 88, borderRadius: 28,
    backgroundColor: '#151B2B', borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20, overflow: 'hidden',
  },
  heroTitle: {
    color: '#FFFFFF', fontSize: 24, fontWeight: '900', textAlign: 'center',
    lineHeight: 34, marginBottom: 14,
  },
  heroSub: {
    color: COLORS.sub, fontSize: 14, textAlign: 'center', lineHeight: 22,
    marginBottom: 20, paddingHorizontal: 4,
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,240,255,0.07)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
    borderRadius: 50, paddingHorizontal: 14, paddingVertical: 7,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.neon },
  heroBadgeText: { color: COLORS.neon, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  resultsRow: {
    flexDirection: 'row', backgroundColor: COLORS.card,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 16, overflow: 'hidden',
  },
  resultItem: { flex: 1, alignItems: 'center', paddingVertical: 18, paddingHorizontal: 4 },
  resultBorder: { borderRightWidth: 1, borderRightColor: COLORS.border },
  resultValue: { color: COLORS.neon, fontSize: 20, fontWeight: '900', marginBottom: 3 },
  resultLabel: { color: COLORS.text, fontSize: 10, fontWeight: '700', textAlign: 'center', marginBottom: 3 },
  resultSub: { color: COLORS.muted, fontSize: 9, textAlign: 'center', lineHeight: 13 },

  diffCard: {
    backgroundColor: 'rgba(0,240,255,0.04)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.14)',
    borderRadius: 20, padding: 20, marginBottom: 16,
  },
  diffHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  diffIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  diffTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', flex: 1 },
  diffBody: { color: COLORS.sub, fontSize: 13, lineHeight: 22 },

  platformCard: {
    backgroundColor: COLORS.card, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
    padding: 20, marginBottom: 16,
  },
  platformRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  platformTag: {
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
  },
  platformTagText: { color: COLORS.neon, fontSize: 12, fontWeight: '700' },

  section: {
    backgroundColor: COLORS.card, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
    padding: 20, marginBottom: 16,
  },
  sectionEyebrow: {
    color: COLORS.neon, fontSize: 10, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 6,
  },
  sectionHeading: {
    color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 26, marginBottom: 20,
  },

  capRow: { flexDirection: 'row', alignItems: 'flex-start' },
  capIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 14, marginTop: 2, flexShrink: 0,
  },
  capTitle: { fontWeight: '800', fontSize: 14, marginBottom: 6 },
  capBody: { color: COLORS.muted, fontSize: 12, lineHeight: 20 },

  calloutCard: {
    backgroundColor: 'rgba(245,158,11,0.06)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.18)',
    borderRadius: 20, padding: 20, marginBottom: 16,
  },
  calloutHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  calloutIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  calloutTitle: { color: COLORS.amber, fontSize: 15, fontWeight: '800', flex: 1, lineHeight: 22 },
  calloutBody: { color: COLORS.sub, fontSize: 13, lineHeight: 22 },

  promiseRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  promiseText: { color: '#CBD5E1', fontSize: 13, lineHeight: 20, flex: 1 },

  missionCard: {
    backgroundColor: 'rgba(0,240,255,0.04)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.1)',
    borderRadius: 20, padding: 22, marginBottom: 16, alignItems: 'center',
  },
  missionQuote: {
    color: '#CBD5E1', fontSize: 14, lineHeight: 24, textAlign: 'center',
    fontStyle: 'italic', marginBottom: 14,
  },
  missionAttrib: { color: COLORS.muted, fontSize: 12, fontWeight: '600' },

  contactCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(0,240,255,0.04)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.14)',
    borderRadius: 16, padding: 16, marginBottom: 24,
  },
  contactLeft: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: 'rgba(0,240,255,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  contactTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14, marginBottom: 2 },
  contactSub: { color: COLORS.muted, fontSize: 11 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.22)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  contactBtnText: { color: COLORS.neon, fontWeight: '700', fontSize: 12 },

  footer: { color: '#1E293B', fontSize: 11, textAlign: 'center', lineHeight: 18 },
});
