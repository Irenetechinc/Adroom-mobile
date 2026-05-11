
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
import Svg, {
  Path, G, Defs, LinearGradient, Stop, Rect, Circle, ClipPath,
} from 'react-native-svg';
import { useAgentStore } from '../store/agentStore';
import { useEnergyStore } from '../store/energyStore';
import { Skeleton } from '../components/Skeleton';

// ─── Brand SVG Icons ──────────────────────────────────────────────────────────

function FacebookIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.025 4.388 11.017 10.125 11.927v-8.437H7.078v-3.49h3.047V9.43c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.975h-1.513c-1.491 0-1.956.927-1.956 1.879v2.251h3.328l-.532 3.49h-2.796v8.437C19.612 23.09 24 18.098 24 12.073z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

function InstagramIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

function TikTokIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.77a4.85 4.85 0 01-1.01-.08z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

function TwitterXIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

function WhatsAppIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

function LinkedInIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

function GoogleIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </Svg>
  );
}

function SocialIcon({ platform, size = 26 }: { platform: string; size?: number }) {
  switch (platform) {
    case 'facebook':  return <FacebookIcon size={size} />;
    case 'instagram': return <InstagramIcon size={size} />;
    case 'tiktok':    return <TikTokIcon size={size} />;
    case 'twitter':   return <TwitterXIcon size={size} />;
    case 'whatsapp':  return <WhatsAppIcon size={size} />;
    case 'linkedin':  return <LinkedInIcon size={size} />;
    case 'google':    return <GoogleIcon size={size} />;
    default:          return null;
  }
}

// ─── Platform Config ──────────────────────────────────────────────────────────

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
  bg: string;
  comingSoon?: boolean;
};

const PLATFORMS: Platform[] = [
  { id: 'facebook',  name: 'Facebook',          sub: 'Meta Business Suite',         bg: '#1877F2' },
  { id: 'instagram', name: 'Instagram',          sub: 'Meta Business Suite',         bg: 'linear' },
  { id: 'tiktok',    name: 'TikTok',             sub: 'TikTok for Creators',         bg: '#010101' },
  { id: 'twitter',   name: 'X / Twitter',        sub: 'X Platform',                  bg: '#000000' },
  { id: 'whatsapp',  name: 'WhatsApp Business',  sub: 'WhatsApp Business API',       bg: '#25D366' },
  { id: 'linkedin',  name: 'LinkedIn',           sub: 'LinkedIn Marketing',          bg: '#0A66C2', comingSoon: true },
  { id: 'google',    name: 'Google Ads',         sub: 'Google Marketing Platform',   bg: '#FFFFFF',  comingSoon: true },
];

// Instagram uses a gradient background — approximated here
const INSTAGRAM_COLORS = ['#833AB4', '#C13584', '#E1306C', '#F77737', '#FCAF45'];

function PlatformIconBg({ platform, size = 46 }: { platform: Platform; size?: number }) {
  const isInstagram = platform.id === 'instagram';
  const isGoogle    = platform.id === 'google';
  const radius = 13;

  if (isInstagram) {
    return (
      <Svg width={size} height={size} viewBox="0 0 46 46" style={{ borderRadius: radius }}>
        <Defs>
          <LinearGradient id="igGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <Stop offset="0%"   stopColor="#FCAF45" />
            <Stop offset="30%"  stopColor="#F77737" />
            <Stop offset="55%"  stopColor="#E1306C" />
            <Stop offset="80%"  stopColor="#C13584" />
            <Stop offset="100%" stopColor="#833AB4" />
          </LinearGradient>
        </Defs>
        <Rect width={46} height={46} rx={radius} fill="url(#igGrad)" />
        <G transform="translate(10, 10)">
          <InstagramIcon size={26} />
        </G>
      </Svg>
    );
  }

  if (isGoogle) {
    return (
      <View style={{
        width: size, height: size, borderRadius: radius,
        backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: '#E2E8F0',
      }}>
        <GoogleIcon size={26} />
      </View>
    );
  }

  return (
    <View style={{
      width: size, height: size, borderRadius: radius,
      backgroundColor: platform.bg, alignItems: 'center', justifyContent: 'center',
    }}>
      <SocialIcon platform={platform.id} size={26} />
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

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
    if (platform.id === 'facebook')  params.connectFacebook = true;
    else if (platform.id === 'instagram') params.connectInstagram = true;
    else if (platform.id === 'tiktok')    params.connectTikTok = true;
    else if (platform.id === 'linkedin')  params.connectLinkedIn = true;
    else if (platform.id === 'twitter')   params.connectTwitter = true;
    else if (platform.id === 'whatsapp')  params.connectWhatsApp = true;
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
      if (platform.id === 'twitter')   return 'X / Twitter Account';
      if (platform.id === 'linkedin')  return 'LinkedIn Profile';
      if (platform.id === 'tiktok')    return 'TikTok Creator';
      if (platform.id === 'whatsapp')  return 'WhatsApp Business';
      return 'Account Connected';
    }
    if (cfg.page_name) return cfg.page_name;
    if (platform.id === 'instagram') return 'Instagram Account';
    if (platform.id === 'twitter')   return 'X / Twitter Account';
    if (platform.id === 'linkedin')  return cfg.org_urn ? 'Company Page' : 'Personal Profile';
    if (platform.id === 'tiktok')    return 'TikTok Creator';
    if (platform.id === 'whatsapp')  return cfg.page_name || 'WhatsApp Business';
    return 'Account Connected';
  };

  const getConnectedSub = (platform: Platform): string => {
    const cfg = connectedPlatforms[platform.id];
    if (!cfg) return 'Account Linked';
    if (platform.id === 'facebook')  return cfg.ad_account_id ? `Ad Account: ${cfg.ad_account_id}` : 'Business Page Linked';
    if (platform.id === 'instagram') return cfg.instagram_account_id ? `IG: ${cfg.instagram_account_id}` : 'Account Linked';
    if (platform.id === 'twitter')   return 'X Account Linked';
    if (platform.id === 'linkedin')  return cfg.org_urn ? `Page: ${cfg.org_urn}` : (cfg.person_urn ? `Profile: ${cfg.person_urn}` : 'Profile Linked');
    if (platform.id === 'tiktok')    return cfg.open_id ? `ID: ${cfg.open_id.substring(0, 12)}…` : 'Creator Account Linked';
    if (platform.id === 'whatsapp')  return cfg.page_id ? `Phone ID: ${cfg.page_id.substring(0, 12)}…` : 'Business API Linked';
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
          const isProOnlyPlatform = platform.id === 'twitter';
          const locked = !connected && !comingSoon && (isStarterLimited || (!isPro && isProOnlyPlatform));

          return (
            <Animated.View
              key={platform.id}
              entering={FadeInDown.delay(index * 60).springify()}
              style={[styles.platformCard, (comingSoon || locked) && styles.platformCardDim]}
            >
              <View style={styles.platformHeader}>
                <PlatformIconBg platform={platform} size={46} />
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
                          {getConnectedLabel(platform).charAt(0).toUpperCase()}
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
});
