import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ChevronLeft, TrendingUp, Users, Target, Zap,
  Globe, Star, Mail, ArrowRight, CheckCircle,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

const RESULTS = [
  { value: '100%', label: 'Autonomous Execution', sub: 'Zero human input required after setup' },
  { value: '$0', label: 'Ad Spend Needed', sub: 'All organic — no paid campaigns' },
  { value: '24/7', label: 'Always Working', sub: 'Your marketing never sleeps' },
  { value: '5×', label: 'More Reach', sub: 'Than traditional paid campaigns' },
];

const CAPABILITIES = [
  {
    icon: TrendingUp,
    color: '#00F0FF',
    title: 'Explosive Sales Growth',
    body: 'AdRoom AI applies dedicated sales intelligent engine that finds and identifies buying signals, crafts persuasive content, and drives conversions across every platform — continuously, without you lifting a finger.',
  },
  {
    icon: Globe,
    color: '#10B981',
    title: 'Brand Awareness at Scale',
    body: 'Reach tens of thousands of potential customers organically. AdRoom AI builds your brand presence across Facebook, Instagram, TikTok, LinkedIn, and X with targeted, culturally resonant content — all automatically.',
  },
  {
    icon: Target,
    color: '#F59E0B',
    title: 'High-Quality Lead Generation',
    body: 'AdRoom AI\'s lead intelligence pinpoints your ideal audience using real-time trend signals, then engages them with precision messaging that turns cold audiences into warm, ready-to-buy prospects.',
  },
  {
    icon: Zap,
    color: '#7C3AED',
    title: 'Instant Campaign Launches',
    body: 'Launching a new product or brand? AdRoom AI assembles a full launch strategy in minutes — content calendar, platform sequencing, audience targeting, and execution — all handled autonomously from day one.',
  },
  {
    icon: Users,
    color: '#EF4444',
    title: 'Promotions That Actually Convert',
    body: 'Forget generic discount posts. AdRoom AI\'s promotional intelligent engine crafts time-sensitive, high-urgency campaigns tailored to your product and audience, proven to drive immediate action and revenue.',
  },
  {
    icon: Star,
    color: '#F97316',
    title: 'The $15,000 Paid Ads Result — For Free',
    body: 'What a professional agency would charge $10,000–$15,000/month in paid advertising to achieve, AdRoom AI delivers organically. Zero ad budget. Zero agency fees. Same — often better — results.',
  },
];

const PROMISES = [
  'No agencies. No ad budgets. No delays.',
  'Your brand marketed every hour of every day.',
  'Strategies built from real market data — not guesswork.',
  'Content crafted for each platform\'s unique algorithm.',
  'Results you can track, in a dashboard built for clarity.',
  'Your data is encrypted and never shared or sold.',
];

export default function AboutScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft color="#E2E8F0" size={22} />
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
          <Text style={styles.heroTitle}>Autonomus Intelligent Marketing Engine. </Text>
          <Text style={styles.heroSub}>
            AdRoom AI is not a tool. It's a full-stack intelligent marketing engine that works
            around the clock — without a single human in the loop.
          </Text>
          <View style={styles.heroBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.heroBadgeText}>Always Active · Zero Ad Spend · 100% Organic</Text>
          </View>
        </Animated.View>

        {/* Results Strip */}
        <Animated.View entering={FadeInDown.delay(120).springify()} style={styles.resultsRow}>
          {RESULTS.map((r, i) => (
            <View key={i} style={[styles.resultItem, i < RESULTS.length - 1 && styles.resultBorder]}>
              <Text style={styles.resultValue}>{r.value}</Text>
              <Text style={styles.resultLabel}>{r.label}</Text>
              <Text style={styles.resultSub}>{r.sub}</Text>
            </View>
          ))}
        </Animated.View>

        {/* What AdRoom Does For You */}
        <Animated.View entering={FadeInDown.delay(180).springify()} style={styles.section}>
          <Text style={styles.sectionEyebrow}>The Big Picture</Text>
          <Text style={styles.sectionHeading}>Marketing That Never Stops Working For You</Text>
          <Text style={styles.sectionBody}>
            Most businesses pay thousands every month for agencies, freelancers, or ad budgets —
            and still spend hours managing campaigns. AdRoom AI eliminates all of that.
          </Text>
          <Text style={[styles.sectionBody, { marginTop: 10 }]}>
            From the moment you set up your product, AdRoom AI's autonomus agents take over completely.
            They research your market, identify your audience, create platform-native content,
            publish at optimal times, monitor performance, and adapt — continuously — with
            no instructions from you.
          </Text>
          <Text style={[styles.sectionBody, { marginTop: 10 }]}>
            The result? Sales, awareness, leads, and brand growth delivered automatically,
            every single day.
          </Text>
        </Animated.View>

        {/* Capabilities */}
        <Animated.View entering={FadeInDown.delay(220).springify()} style={styles.section}>
          <Text style={styles.sectionEyebrow}>What We Deliver</Text>
          <Text style={styles.sectionHeading}>Everything Your Business Needs to Grow</Text>
          {CAPABILITIES.map((cap, i) => {
            const Icon = cap.icon;
            return (
              <View key={i} style={styles.capRow}>
                <View style={[styles.capIcon, { backgroundColor: `${cap.color}18` }]}>
                  <Icon size={20} color={cap.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.capTitle}>{cap.title}</Text>
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
              <Zap size={20} color="#F59E0B" />
            </View>
            <Text style={styles.calloutTitle}>The End of Paid Ads</Text>
          </View>
          <Text style={styles.calloutBody}>
            A top-tier paid advertising campaign — the kind that gets real results — costs
            between $10,000 and $15,000 a month. And it stops the moment you stop paying.
          </Text>
          <Text style={[styles.calloutBody, { marginTop: 10 }]}>
            AdRoom AI delivers the same reach, the same conversions, and often better
            engagement — entirely organically. No cost per click. No ad fatigue.
            No dependency on a platform's paid algorithm.
          </Text>
          <Text style={[styles.calloutBody, { marginTop: 10, color: '#00F0FF', fontWeight: '700' }]}>
            Your growth compounds. It never expires.
          </Text>
        </Animated.View>

        {/* Promises */}
        <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.section}>
          <Text style={styles.sectionEyebrow}>Our Commitment</Text>
          <Text style={styles.sectionHeading}>What You Can Always Count On</Text>
          {PROMISES.map((p, i) => (
            <View key={i} style={styles.promiseRow}>
              <CheckCircle size={16} color="#10B981" style={{ marginTop: 2, flexShrink: 0 }} />
              <Text style={styles.promiseText}>{p}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Mission */}
        <Animated.View entering={FadeInDown.delay(340).springify()} style={styles.missionCard}>
          <Text style={styles.missionQuote}>
            "Every business deserves world-class marketing. AdRoom AI exists to make that a reality
            — not a privilege reserved for those with the biggest budgets."
          </Text>
          <Text style={styles.missionAttrib}>— The AdRoom AI Team</Text>
        </Animated.View>

        {/* CTA / Contact */}
        <Animated.View entering={FadeInDown.delay(380).springify()} style={styles.contactCard}>
          <View style={styles.contactLeft}>
            <Mail size={18} color="#00F0FF" />
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
            <ArrowRight size={13} color="#00F0FF" />
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.footer}>
          © {new Date().getFullYear()} AdRoom AI · All rights reserved{'\n'}
          Version 2.2.7 · Built for ambitious businesses worldwide
        </Text>
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
  backBtn: { marginRight: 14, padding: 4 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },

  scroll: { padding: 20 },

  // Hero
  hero: {
    alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20,
    backgroundColor: '#0D1526',
    borderRadius: 24, borderWidth: 1, borderColor: 'rgba(0,240,255,0.14)',
    marginBottom: 16,
  },
  heroIconWrap: {
    width: 88, height: 88, borderRadius: 28,
    backgroundColor: '#151B2B', borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    overflow: 'hidden',
  },
  heroTitle: {
    color: '#FFFFFF', fontSize: 24, fontWeight: '900', textAlign: 'center',
    lineHeight: 32, marginBottom: 14,
  },
  heroSub: {
    color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 22,
    marginBottom: 20, paddingHorizontal: 4,
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,240,255,0.07)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
    borderRadius: 50, paddingHorizontal: 14, paddingVertical: 7,
  },
  liveDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: '#00F0FF',
  },
  heroBadgeText: { color: '#00F0FF', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  // Results Strip
  resultsRow: {
    flexDirection: 'row', backgroundColor: '#151B2B',
    borderRadius: 20, borderWidth: 1, borderColor: '#1E293B',
    marginBottom: 16, overflow: 'hidden',
  },
  resultItem: {
    flex: 1, alignItems: 'center', paddingVertical: 18, paddingHorizontal: 4,
  },
  resultBorder: {
    borderRightWidth: 1, borderRightColor: '#1E293B',
  },
  resultValue: { color: '#00F0FF', fontSize: 20, fontWeight: '900', marginBottom: 3 },
  resultLabel: { color: '#E2E8F0', fontSize: 10, fontWeight: '700', textAlign: 'center', marginBottom: 3 },
  resultSub: { color: '#475569', fontSize: 9, textAlign: 'center', lineHeight: 13 },

  // Sections
  section: {
    backgroundColor: '#151B2B', borderRadius: 20, borderWidth: 1, borderColor: '#1E293B',
    padding: 20, marginBottom: 16,
  },
  sectionEyebrow: {
    color: '#00F0FF', fontSize: 10, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 6,
  },
  sectionHeading: {
    color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 26, marginBottom: 14,
  },
  sectionBody: { color: '#94A3B8', fontSize: 13, lineHeight: 22 },

  // Capability rows
  capRow: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20,
  },
  capIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 14, marginTop: 2, flexShrink: 0,
  },
  capTitle: { color: '#E2E8F0', fontWeight: '800', fontSize: 14, marginBottom: 5 },
  capBody: { color: '#64748B', fontSize: 12, lineHeight: 19 },

  // Callout
  calloutCard: {
    backgroundColor: 'rgba(245,158,11,0.06)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.18)',
    borderRadius: 20, padding: 20, marginBottom: 16,
  },
  calloutHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  calloutIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  calloutTitle: { color: '#F59E0B', fontSize: 16, fontWeight: '800' },
  calloutBody: { color: '#94A3B8', fontSize: 13, lineHeight: 22 },

  // Promises
  promiseRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
  },
  promiseText: { color: '#CBD5E1', fontSize: 13, lineHeight: 20, flex: 1 },

  // Mission
  missionCard: {
    backgroundColor: 'rgba(0,240,255,0.04)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.1)',
    borderRadius: 20, padding: 22, marginBottom: 16, alignItems: 'center',
  },
  missionQuote: {
    color: '#CBD5E1', fontSize: 14, lineHeight: 24, textAlign: 'center',
    fontStyle: 'italic', marginBottom: 14,
  },
  missionAttrib: { color: '#475569', fontSize: 12, fontWeight: '600' },

  // Contact
  contactCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(0,240,255,0.04)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.14)',
    borderRadius: 16, padding: 16, marginBottom: 24,
  },
  contactLeft: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: 'rgba(0,240,255,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  contactTitle: { color: '#E2E8F0', fontWeight: '700', fontSize: 14, marginBottom: 2 },
  contactSub: { color: '#64748B', fontSize: 11 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.22)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  contactBtnText: { color: '#00F0FF', fontWeight: '700', fontSize: 12 },

  footer: { color: '#1E293B', fontSize: 11, textAlign: 'center', lineHeight: 18 },
});
