
import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Menu, Users, MessageCircle, ExternalLink } from 'lucide-react-native';
import { DrawerActions } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';

const CHANNELS = [
  {
    id: 'telegram',
    name: 'Telegram Community',
    desc: 'Join live discussions, get strategy help, and share wins with other AdRoom users.',
    letter: 'T',
    bg: '#2AABEE',
    action: 'https://t.me/adroomai',
    cta: 'Join Telegram',
  },
  {
    id: 'discord',
    name: 'Discord Server',
    desc: 'Real-time chat, feature requests, bug reports, and community challenges.',
    letter: 'D',
    bg: '#5865F2',
    action: 'https://discord.gg/KPKMShHEmu',
    cta: 'Join Discord',
  },
  {
    id: 'twitter',
    name: 'Follow on X (Twitter)',
    desc: 'Stay updated on new features, AI tips, and marketing strategies from our team.',
    letter: 'X',
    bg: '#000000',
    action: 'https://twitter.com/adroomai',
    cta: 'Follow Now',
  },
  {
    id: 'reddit',
    name: 'Reddit Community',
    desc: 'r/AdRoomAI — post campaigns, ask questions, and get community feedback.',
    letter: 'r',
    bg: '#FF4500',
    action: 'https://reddit.com/r/adroomai',
    cta: 'Join Subreddit',
  },
];

const SUPPORT_LINKS = [
  { label: 'Help Center & Docs', url: 'https://docs.adroomai.com' },
  { label: 'Report a Bug', url: 'https://adroomai.com/bugs' },
  { label: 'Request a Feature', url: 'https://adroomai.com/features' },
  { label: 'Contact Support', url: 'mailto:support@adroomai.com' },
];

export default function CommunityScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const open = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.backBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Community</Text>
        </View>
        <View style={styles.headerBadge}>
          <Users size={14} color="#00F0FF" />
          <Text style={styles.headerBadgeText}>Global</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 24) }]}
      >
        {/* Banner */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={styles.banner}>
          <View style={styles.bannerIcon}>
            <MessageCircle size={26} color="#00F0FF" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.bannerTitle}>Join the AdRoom Community</Text>
            <Text style={styles.bannerDesc}>
              Connect with marketers from 50+ countries sharing campaigns, strategies, and AI insights.
            </Text>
          </View>
        </Animated.View>

        {/* Channels */}
        <Text style={styles.sectionLabel}>CHANNELS</Text>
        {CHANNELS.map((ch, i) => (
          <Animated.View key={ch.id} entering={FadeInDown.delay(100 + i * 60).springify()}>
            <TouchableOpacity
              onPress={() => open(ch.action)}
              style={styles.channelCard}
              activeOpacity={0.8}
            >
              <View style={[styles.channelLogo, { backgroundColor: ch.bg }]}>
                <Text style={styles.channelLogoText}>{ch.letter}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={styles.channelName}>{ch.name}</Text>
                <Text style={styles.channelDesc} numberOfLines={2}>{ch.desc}</Text>
              </View>
              <View style={styles.channelCta}>
                <Text style={styles.channelCtaText}>{ch.cta}</Text>
                <ExternalLink size={12} color="#00F0FF" style={{ marginTop: 2 }} />
              </View>
            </TouchableOpacity>
          </Animated.View>
        ))}

        {/* Support */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>SUPPORT</Text>
        <Animated.View entering={FadeInDown.delay(350).springify()} style={styles.supportCard}>
          {SUPPORT_LINKS.map((link, i) => (
            <TouchableOpacity
              key={link.label}
              onPress={() => open(link.url)}
              style={[styles.supportRow, i < SUPPORT_LINKS.length - 1 && styles.supportRowBorder]}
            >
              <Text style={styles.supportLabel}>{link.label}</Text>
              <ExternalLink size={14} color="#64748B" />
            </TouchableOpacity>
          ))}
        </Animated.View>
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
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  headerBadgeText: { color: '#00F0FF', fontSize: 12, fontWeight: '700' },

  scroll: { padding: 16 },
  sectionLabel: {
    color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1.5,
    textTransform: 'uppercase', marginBottom: 10,
  },

  banner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,240,255,0.05)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
    borderRadius: 18, padding: 18, marginBottom: 24,
  },
  bannerIcon: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(0,240,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  bannerTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  bannerDesc: { color: '#64748B', fontSize: 12, lineHeight: 18 },

  channelCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B',
    padding: 16, marginBottom: 10,
  },
  channelLogo: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  channelLogoText: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  channelName: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  channelDesc: { color: '#64748B', fontSize: 12, lineHeight: 17 },
  channelCta: { alignItems: 'center', gap: 4, marginLeft: 10 },
  channelCtaText: { color: '#00F0FF', fontSize: 11, fontWeight: '700' },

  supportCard: {
    backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  supportRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 15,
  },
  supportRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  supportLabel: { color: '#E2E8F0', fontSize: 14, fontWeight: '500' },
});
