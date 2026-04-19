
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  ChevronLeft, Link2, Link2Off, CheckCircle2,
  ShieldCheck, RefreshCw, AlertCircle, ExternalLink, Lock, Zap,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAgentStore } from '../store/agentStore';
import { useEnergyStore } from '../store/energyStore';
import { Skeleton } from '../components/Skeleton';

function ConnectedAccountsSkeleton({ insets }: { insets: { bottom: number } }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: Math.max(40, insets.bottom + 20) }} scrollEnabled={false}>
      <Skeleton width="100%" height={15} borderRadius={4} style={{ marginBottom: 20 }} />
      {[...Array(5)].map((_, i) => (
        <View key={i} style={{ backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B', padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Skeleton width={48} height={48} borderRadius={14} />
            <View style={{ flex: 1, gap: 7 }}>
              <Skeleton width="55%" height={14} borderRadius={4} />
              <Skeleton width="75%" height={12} borderRadius={4} />
            </View>
            <Skeleton width={82} height={30} borderRadius={10} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

type Platform = {
  id: string;
  name: string;
  sub: string;
  letter: string;
  bg: string;
  letterColor: string;
  comingSoon?: boolean;
};

const PLATFORMS: Platform[] = [
  { id: 'facebook', name: 'Facebook', sub: 'Meta Business Suite', letter: 'f', bg: '#1877F2', letterColor: '#FFFFFF' },
  { id: 'instagram', name: 'Instagram', sub: 'Meta Business Suite', letter: 'IG', bg: 'rgba(195,42,163,0.9)', letterColor: '#FFFFFF' },
  { id: 'tiktok', name: 'TikTok', sub: 'TikTok for Creators', letter: 'T', bg: '#111', letterColor: '#FFFFFF' },
  { id: 'twitter', name: 'X / Twitter', sub: 'X Platform', letter: 'X', bg: '#000000', letterColor: '#FFFFFF' },
  { id: 'linkedin', name: 'LinkedIn', sub: 'LinkedIn Marketing', letter: 'in', bg: '#0A66C2', letterColor: '#FFFFFF', comingSoon: true },
  { id: 'google', name: 'Google Ads', sub: 'Google Marketing Platform', letter: 'G', bg: 'rgba(234,67,53,0.12)', letterColor: '#EA4335', comingSoon: true },
];

export default function ConnectedAccountsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const { tokens, connectedPlatforms, loadConnectedPlatforms, disconnectPlatform } = useAgentStore();
  const { subscription } = useEnergyStore();
  const plan = subscription?.plan ?? 'none';
  const isPro = plan === 'pro' || plan === 'pro_plus';

  // Use connectedPlatforms (populated from backend AND from live OAuth flow) as
  // the primary source of truth. Fall back to tokens for any connection made in
  // the current session that hasn't been persisted to backend yet.
  const isConnected = (id: string) => !!connectedPlatforms[id] || !!tokens[id];
  const connectedCount = PLATFORMS.filter(p => !p.comingSoon && isConnected(p.id)).length;
  const isStarterLimited = !isPro && connectedCount >= 1;

  const refresh = useCallback(async () => {
    setLoading(true);
    await loadConnectedPlatforms();
    setLoading(false);
    setInitialLoad(false);
  }, [loadConnectedPlatforms]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleConnect = (platform: Platform) => {
    const params: any = {};
    if (platform.id === 'facebook') params.connectFacebook = true;
    else if (platform.id === 'instagram') params.connectInstagram = true;
    else if (platform.id === 'tiktok') params.connectTikTok = true;
    else if (platform.id === 'linkedin') params.connectLinkedIn = true;
    else if (platform.id === 'twitter') params.connectTwitter = true;
    navigation.navigate('AgentChat', params);
  };

  const handleUpgrade = () => {
    (navigation as any).navigate('Subscription', { scrollToPlan: 'pro' });
  };

  const handleDisconnect = (platform: Platform) => {
    Alert.alert(
      `Disconnect ${platform.name}?`,
      'This will pause all autonomous campaigns on this platform. Your content history will remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(platform.id);
            try {
              await disconnectPlatform(platform.id);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to disconnect. Please try again.');
            } finally {
              setDisconnecting(null);
            }
          },
        },
      ],
    );
  };

  const getConnectedLabel = (platform: Platform): string => {
    const cfg = connectedPlatforms[platform.id];
    if (!cfg) {
      if (platform.id === 'instagram') return 'Instagram Account';
      if (platform.id === 'twitter') return 'X / Twitter Account';
      if (platform.id === 'linkedin') return 'LinkedIn Profile';
      if (platform.id === 'tiktok') return 'TikTok Creator';
      return 'Account Connected';
    }
    if (cfg.page_name) return cfg.page_name;
    if (platform.id === 'instagram') return 'Instagram Account';
    if (platform.id === 'twitter') return 'X / Twitter Account';
    if (platform.id === 'linkedin') return cfg.org_urn ? 'Company Page' : 'Personal Profile';
    if (platform.id === 'tiktok') return 'TikTok Creator';
    return 'Account Connected';
  };

  const getConnectedSub = (platform: Platform): string => {
    const cfg = connectedPlatforms[platform.id];
    if (!cfg) return 'Account Linked';
    if (platform.id === 'facebook') return cfg.ad_account_id ? `Ad Account: ${cfg.ad_account_id}` : 'Business Page Linked';
    if (platform.id === 'instagram') return cfg.instagram_account_id ? `IG: ${cfg.instagram_account_id}` : 'Account Linked';
    if (platform.id === 'twitter') return 'X Account Linked';
    if (platform.id === 'linkedin') return cfg.org_urn ? `Page: ${cfg.org_urn}` : (cfg.person_urn ? `Profile: ${cfg.person_urn}` : 'Profile Linked');
    if (platform.id === 'tiktok') return cfg.open_id ? `ID: ${cfg.open_id.substring(0, 12)}…` : 'Creator Account Linked';
    return '';
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>Settings</Text>
          <Text style={styles.headerTitle}>Connected Accounts</Text>
        </View>
        <TouchableOpacity onPress={refresh} style={styles.refreshBtn} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#64748B" size="small" />
            : <RefreshCw size={16} color="#64748B" />}
        </TouchableOpacity>
      </View>

      {initialLoad ? (
        <ConnectedAccountsSkeleton insets={insets} />
      ) : null}

      <ScrollView
        style={[{ flex: 1 }, initialLoad && { display: 'none' }]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
      >
        <Text style={styles.pageDesc}>
          Connect your social accounts so AdRoom can autonomously publish, reply, and engage on your behalf — across every platform.
        </Text>

        {!isPro && (
          <View style={styles.planBanner}>
            <Zap size={14} color="#F59E0B" />
            <Text style={styles.planBannerText}>
              {connectedCount === 0
                ? 'Free plan: Connect 1 account. Upgrade to Pro for unlimited.'
                : "You've used your 1 free account slot. Upgrade to Pro to add more."}
            </Text>
            <TouchableOpacity onPress={handleUpgrade} style={styles.planBannerBtn}>
              <Text style={styles.planBannerBtnText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        )}

        {PLATFORMS.map((platform, index) => {
          const connected = isConnected(platform.id);
          const comingSoon = !!platform.comingSoon;
          const disc = disconnecting === platform.id;
          const locked = !connected && !comingSoon && isStarterLimited;

          return (
            <Animated.View
              key={platform.id}
              entering={FadeInDown.delay(index * 60).springify()}
              style={[styles.platformCard, (comingSoon || locked) && styles.platformCardDim]}
            >
              <View style={styles.platformHeader}>
                <View style={[styles.platformLogoWrap, { backgroundColor: platform.bg }]}>
                  <Text style={[styles.platformLogo, { color: platform.letterColor, fontSize: platform.letter.length > 1 ? 14 : 22 }]}>
                    {platform.letter}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.platformName, (comingSoon || locked) && { opacity: 0.5 }]}>{platform.name}</Text>
                  <Text style={styles.platformSub}>{platform.sub}</Text>
                </View>
                {comingSoon ? (
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonText}>SOON</Text>
                  </View>
                ) : locked ? (
                  <View style={styles.lockedBadge}>
                    <Lock size={10} color="#F59E0B" />
                    <Text style={styles.lockedBadgeText}>PRO</Text>
                  </View>
                ) : (
                  <View style={[styles.statusBadge, connected
                    ? { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.25)' }
                    : { backgroundColor: 'rgba(100,116,139,0.1)', borderColor: 'rgba(100,116,139,0.2)' }
                  ]}>
                    <View style={[styles.statusDot, { backgroundColor: connected ? '#10B981' : '#475569' }]} />
                    <Text style={[styles.statusText, { color: connected ? '#34D399' : '#64748B' }]}>
                      {connected ? 'Connected' : 'Not Linked'}
                    </Text>
                  </View>
                )}
              </View>

              {!comingSoon && (
                locked ? (
                  <View style={styles.lockedBody}>
                    <Lock size={28} color="#F59E0B" />
                    <Text style={styles.lockedTitle}>Pro Feature</Text>
                    <Text style={styles.lockedDesc}>
                      Upgrade to Pro to connect {platform.name} and run autonomous campaigns across multiple platforms simultaneously.
                    </Text>
                    <TouchableOpacity onPress={handleUpgrade} style={styles.upgradeBtn} activeOpacity={0.85}>
                      <Zap size={16} color="#000" />
                      <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
                    </TouchableOpacity>
                  </View>
                ) : connected ? (
                  <View style={styles.connectedBody}>
                    <View style={styles.accountInfoRow}>
                      <View style={styles.accountAvatar}>
                        <Text style={styles.accountAvatarText}>
                          {getConnectedLabel(platform).charAt(0).toUpperCase() || platform.letter.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.accountName}>{getConnectedLabel(platform)}</Text>
                        <Text style={styles.accountType}>{getConnectedSub(platform)}</Text>
                      </View>
                      <CheckCircle2 color="#10B981" size={20} />
                    </View>

                    <View style={styles.activeBanner}>
                      <ShieldCheck size={14} color="#10B981" />
                      <Text style={styles.activeBannerText}>Autonomous publishing is active on {platform.name}</Text>
                    </View>

                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => handleConnect(platform)}
                        style={styles.reconfigureBtn}
                        activeOpacity={0.8}
                      >
                        <ExternalLink size={16} color="#00F0FF" />
                        <Text style={styles.reconfigureBtnText}>Reconfigure</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDisconnect(platform)}
                        disabled={disc}
                        style={styles.disconnectBtn}
                        activeOpacity={0.8}
                      >
                        {disc
                          ? <ActivityIndicator color="#EF4444" size="small" />
                          : <Link2Off size={16} color="#EF4444" />}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.notConnectedBody}>
                    <View style={styles.warningIcon}>
                      <AlertCircle size={26} color="#F59E0B" />
                    </View>
                    <Text style={styles.notConnectedTitle}>Not Connected</Text>
                    <Text style={styles.notConnectedDesc}>
                      Connect your {platform.name} account so AdRoom AI can autonomously post, reply, and engage for your campaign.
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleConnect(platform)}
                      style={styles.connectBtn}
                      activeOpacity={0.85}
                    >
                      <Link2 size={18} color="#0B0F19" />
                      <Text style={styles.connectBtnText}>Connect {platform.name}</Text>
                    </TouchableOpacity>
                  </View>
                )
              )}
            </Animated.View>
          );
        })}
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
  refreshBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { padding: 16 },
  pageDesc: { color: '#64748B', fontSize: 13, lineHeight: 20, marginBottom: 16 },

  planBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 14, padding: 12, marginBottom: 16,
  },
  planBannerText: { flex: 1, color: '#F59E0B', fontSize: 12, lineHeight: 17 },
  planBannerBtn: {
    backgroundColor: '#F59E0B', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  planBannerBtnText: { color: '#000', fontWeight: '800', fontSize: 11 },

  platformCard: {
    backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B',
    overflow: 'hidden', marginBottom: 12,
  },
  platformCardDim: { opacity: 0.6 },
  platformHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  platformLogoWrap: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  platformLogo: { fontWeight: '900' },
  platformName: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  platformSub: { color: '#475569', fontSize: 11, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  statusText: { fontSize: 11, fontWeight: '700' },
  comingSoonBadge: {
    backgroundColor: 'rgba(112,0,255,0.08)', borderColor: 'rgba(112,0,255,0.2)',
    borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  comingSoonText: { color: '#7000FF', fontSize: 10, fontWeight: '700' },
  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)',
    borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  lockedBadgeText: { color: '#F59E0B', fontSize: 10, fontWeight: '700' },

  connectedBody: { padding: 16 },
  accountInfoRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 14,
    backgroundColor: 'rgba(0,240,255,0.04)', borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.1)',
  },
  accountAvatar: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  accountAvatarText: { color: '#00F0FF', fontWeight: '800', fontSize: 18 },
  accountName: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  accountType: { color: '#64748B', fontSize: 11 },
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(16,185,129,0.07)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)',
    borderRadius: 10, padding: 12, marginBottom: 14,
  },
  activeBannerText: { color: '#10B981', fontSize: 12, fontWeight: '600', flex: 1 },
  actionRow: { flexDirection: 'row', gap: 10 },
  reconfigureBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(0,240,255,0.08)', borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    borderRadius: 12, paddingVertical: 12,
  },
  reconfigureBtnText: { color: '#00F0FF', fontWeight: '700', fontSize: 13 },
  disconnectBtn: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },

  lockedBody: { padding: 24, alignItems: 'center' },
  lockedTitle: { color: '#F59E0B', fontWeight: '800', fontSize: 16, marginTop: 12, marginBottom: 8 },
  lockedDesc: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  upgradeBtn: {
    backgroundColor: '#F59E0B', borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingVertical: 13, gap: 8,
  },
  upgradeBtnText: { color: '#000', fontWeight: '800', fontSize: 14 },

  notConnectedBody: { padding: 24, alignItems: 'center' },
  warningIcon: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(245,158,11,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  notConnectedTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginBottom: 8 },
  notConnectedDesc: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  connectBtn: {
    backgroundColor: '#00F0FF', borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingVertical: 14, gap: 10,
  },
  connectBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 15 },
  comingSoonIcon: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: 'rgba(112,0,255,0.1)', borderWidth: 1, borderColor: 'rgba(112,0,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  comingSoonTitle: { color: '#A78BFA', fontWeight: '800', fontSize: 16, marginBottom: 8 },
  comingSoonPill: {
    backgroundColor: 'rgba(112,0,255,0.1)', borderWidth: 1, borderColor: 'rgba(112,0,255,0.25)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
  },
  comingSoonPillText: { color: '#A78BFA', fontWeight: '700', fontSize: 12 },
});
