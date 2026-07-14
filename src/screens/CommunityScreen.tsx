import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  Menu, Users, ExternalLink, Sparkles, ArrowUpRight,
  MessageSquare, HeartHandshake,
} from 'lucide-react-native';
import { DrawerActions } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';

const CHANNELS = [
  {
    id: 'telegram',
    name: 'Telegram Community',
    desc: 'Live strategy discussions, campaign wins, and real-time peer support.',
    letter: 'T',
    bg: '#2AABEE',
    accentBorder: 'rgba(42,171,238,0.22)',
    action: 'https://t.me/+WnLXzsoxrSJmNTI8',
    cta: 'Join Now',
    members: '2.4K',
  },
  {
    id: 'discord',
    name: 'Discord Server',
    desc: 'Real-time chat, feature requests, bug reports, and community challenges.',
    letter: 'D',
    bg: '#5865F2',
    accentBorder: 'rgba(88,101,242,0.22)',
    action: 'https://discord.gg/KPKMShHEmu',
    cta: 'Join Now',
    members: '1.8K',
  },
  {
    id: 'twitter',
    name: 'Follow on X',
    desc: 'AI marketing tips, new feature drops, and behind-the-scenes strategy from the AdRoom team.',
    letter: 'X',
    bg: '#1C1C1C',
    accentBorder: 'rgba(255,255,255,0.1)',
    action: 'https://twitter.com/adroomai',
    cta: 'Follow',
    members: null,
  },
  {
    id: 'reddit',
    name: 'Reddit — r/AdRoomAI',
    desc: 'Post your campaigns, ask questions, and get brutally honest community feedback.',
    letter: 'r',
    bg: '#FF4500',
    accentBorder: '#1E293B',
    action: null,
    cta: 'Coming Soon',
    comingSoon: true,
    members: null,
  },
];

const SUPPORT_LINKS = [
  { label: 'Help Center & Docs', url: 'https://adroomai.com/help.html' },
  { label: 'Report a Bug', url: 'https://adroomai.com/report-bug.html' },
  { label: 'Request a Feature', url: 'https://adroomai.com/request-feature.html' },
  { label: 'Contact Support', url: 'mailto:support@adroomai.com' },
];

export default function CommunityScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const open = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={s.menuBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerEyebrow}>AdRoom AI</Text>
          <Text style={s.headerTitle}>Community</Text>
        </View>
        <View style={s.headerPill}>
          <Users size={13} color="#00F0FF" />
          <Text style={s.headerPillText}>Global</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: Math.max(40, insets.bottom + 24) }}
      >
        {/* Hero Banner */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={s.heroBanner}>
          <View style={s.heroIconCircle}>
            <HeartHandshake size={24} color="#00F0FF" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={s.heroTitle}>Join the global AdRoom community</Text>
            <Text style={s.heroSub}>
              Marketers from 50+ countries sharing campaigns, wins, and AI insights — in real time.
            </Text>
          </View>
        </Animated.View>

        {/* Community Channels */}
        <View style={s.sectionRow}>
          <Text style={s.sectionLabel}>COMMUNITY CHANNELS</Text>
          <View style={s.sectionLine} />
        </View>

        {CHANNELS.map((ch, i) => (
          <Animated.View key={ch.id} entering={FadeInDown.delay(100 + i * 55).springify()}>
            <TouchableOpacity
              onPress={() => !ch.comingSoon && ch.action && open(ch.action)}
              style={[s.channelCard, { borderColor: ch.accentBorder }, ch.comingSoon && { opacity: 0.65 }]}
              activeOpacity={ch.comingSoon ? 1 : 0.78}
            >
              <View style={[s.channelLogo, { backgroundColor: ch.bg }]}>
                <Text style={s.channelLogoText}>{ch.letter}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={s.channelNameRow}>
                  <Text style={s.channelName}>{ch.name}</Text>
                  {ch.members && (
                    <View style={s.membersBadge}>
                      <Text style={s.membersText}>{ch.members}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.channelDesc} numberOfLines={2}>{ch.desc}</Text>
              </View>
              {ch.comingSoon ? (
                <View style={s.soonBadge}>
                  <Text style={s.soonText}>SOON</Text>
                </View>
              ) : (
                <View style={s.ctaWrap}>
                  <Text style={s.ctaText}>{ch.cta}</Text>
                  <ArrowUpRight size={12} color="#00F0FF" />
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        ))}

        {/* Support */}
        <View style={[s.sectionRow, { marginTop: 28 }]}>
          <Text style={s.sectionLabel}>SUPPORT & HELP</Text>
          <View style={s.sectionLine} />
        </View>

        <Animated.View entering={FadeInDown.delay(380).springify()} style={s.supportCard}>
          {SUPPORT_LINKS.map((link, i) => (
            <TouchableOpacity
              key={link.label}
              onPress={() => open(link.url)}
              style={[s.supportRow, i < SUPPORT_LINKS.length - 1 && s.supportDivider]}
            >
              <Text style={s.supportLabel}>{link.label}</Text>
              <ExternalLink size={14} color="#475569" />
            </TouchableOpacity>
          ))}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(480).springify()} style={s.footerNote}>
          <Sparkles size={13} color="#334155" />
          <Text style={s.footerNoteText}>
            AdRoom AI is built in public — your feedback directly shapes the product.
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.07)',
  },
  menuBtn: { marginRight: 14, padding: 6 },
  headerEyebrow: {
    color: '#475569', fontSize: 11, fontWeight: '600',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  headerTitle: { color: '#F1F5F9', fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginTop: 1 },
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,240,255,0.07)', borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.18)', borderRadius: 20,
    paddingHorizontal: 11, paddingVertical: 6,
  },
  headerPillText: { color: '#00F0FF', fontSize: 12, fontWeight: '700' },

  heroBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,240,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.12)',
    borderRadius: 18, padding: 18, marginBottom: 24,
  },
  heroIconCircle: {
    width: 50, height: 50, borderRadius: 15,
    backgroundColor: 'rgba(0,240,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', marginBottom: 5, lineHeight: 20 },
  heroSub: { color: '#64748B', fontSize: 12, lineHeight: 18 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionLabel: {
    color: '#334155', fontSize: 10, fontWeight: '800',
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  sectionLine: { flex: 1, height: 1, backgroundColor: '#1E293B' },

  channelCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0F1623', borderWidth: 1,
    borderRadius: 18, padding: 16, marginBottom: 10,
  },
  channelLogo: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  channelLogoText: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  channelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  channelName: { color: '#F1F5F9', fontWeight: '700', fontSize: 14 },
  membersBadge: {
    backgroundColor: 'rgba(100,116,139,0.15)', borderRadius: 20,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  membersText: { color: '#64748B', fontSize: 10, fontWeight: '600' },
  channelDesc: { color: '#64748B', fontSize: 12, lineHeight: 17 },
  ctaWrap: { alignItems: 'center', gap: 3, marginLeft: 8, flexShrink: 0 },
  ctaText: { color: '#00F0FF', fontSize: 11, fontWeight: '700' },
  soonBadge: {
    backgroundColor: 'rgba(124,58,237,0.1)', borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  soonText: { color: '#A78BFA', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  supportCard: {
    backgroundColor: '#0F1623', borderRadius: 18,
    borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  supportRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 15,
  },
  supportDivider: { borderBottomWidth: 1, borderBottomColor: '#1A2235' },
  supportLabel: { color: '#CBD5E1', fontSize: 14, fontWeight: '500' },

  footerNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 24, paddingHorizontal: 4,
  },
  footerNoteText: { color: '#334155', fontSize: 12, lineHeight: 18, flex: 1 },
});
