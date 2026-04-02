
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';

import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {Facebook, LogOut, Instagram, Linkedin, Twitter, Video } from 'lucide-react-native';
import { RootStackParamList } from '../types';

import { FacebookService } from '../services/facebook';
import { FacebookConfig } from '../types/facebook';
import {
  ChevronLeft, Link2, Link2Off, CheckCircle2,
  ShieldCheck, RefreshCw, AlertCircle, ExternalLink,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';


export default function ConnectedAccountsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  const [config, setConfig] = useState<FacebookConfig | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await FacebookService.getConfig();
      setConfig(data);
    } catch (err) {
      console.error('Failed to load FB config:', err);

    } finally {
      setLoading(false);
    }

  };

  useEffect(() => { loadConfig(); }, []);

  const handleConnect = (platform: string) => {
    const routeParams: any = {};
    if (platform === 'facebook') routeParams.connectFacebook = true;
    if (platform === 'instagram') routeParams.connectInstagram = true;
    if (platform === 'tiktok') routeParams.connectTikTok = true;
    if (platform === 'linkedin') routeParams.connectLinkedIn = true;
    if (platform === 'twitter') routeParams.connectTwitter = true;
    
    navigation.navigate('AgentChat', routeParams);
  };

  const handleDisconnect = (platform: string) => {
    Alert.alert(

      'Disconnect Facebook',
      'This will pause all autonomous campaigns. Are you sure you want to disconnect?',

      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            try {

              Alert.alert('Disconnected', 'Your Facebook account has been unlinked.');
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'Failed to disconnect. Please try again.');

            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],

    );
  };

  return (

    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>Settings</Text>
          <Text style={styles.headerTitle}>Connected Accounts</Text>
        </View>
        <TouchableOpacity onPress={loadConfig} style={styles.refreshBtn}>
          <RefreshCw size={16} color="#64748B" />

        </TouchableOpacity>
      </View>


      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
        <Text style={styles.pageDesc}>
          Manage external platform connections that AdRoom AI uses to autonomously launch and manage your campaigns.
        </Text>

        {/* Facebook */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.platformCard}>
          {/* Platform Header */}
          <View style={styles.platformHeader}>
            <View style={styles.platformLogoWrap}>
              <Text style={styles.platformLogo}>f</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.platformName}>Facebook Ads</Text>
              <Text style={styles.platformSub}>Meta Business Suite</Text>
            </View>
            <View style={[styles.statusBadge, config
              ? { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.25)' }
              : { backgroundColor: 'rgba(100,116,139,0.1)', borderColor: 'rgba(100,116,139,0.2)' }
            ]}>
              <View style={[styles.statusDot, { backgroundColor: config ? '#10B981' : '#475569' }]} />
              <Text style={[styles.statusText, { color: config ? '#34D399' : '#64748B' }]}>
                {config ? 'Connected' : 'Not Linked'}
              </Text>
            </View>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#00F0FF" size="small" />
              <Text style={styles.loadingText}>Loading account data...</Text>
            </View>
          ) : config ? (
            <View style={styles.connectedBody}>
              {/* Account Info */}
              <View style={styles.accountInfoRow}>
                <View style={styles.accountAvatar}>
                  <Text style={styles.accountAvatarText}>
                    {config.page_name ? config.page_name.charAt(0).toUpperCase() : 'F'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>{config.page_name || 'Facebook Page'}</Text>
                  <Text style={styles.accountType}>Linked Business Page</Text>
                </View>
                <CheckCircle2 color="#10B981" size={20} />
              </View>

              {/* Details */}
              <View style={styles.detailsBlock}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ad Account ID</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>{config.ad_account_id}</Text>
                </View>
              </View>

              {/* Status banner */}
              <View style={styles.activeBanner}>
                <ShieldCheck size={14} color="#10B981" />
                <Text style={styles.activeBannerText}>Real-time autonomous optimization is active</Text>
              </View>

              {/* Actions */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: true })}
                  style={styles.reconfigureBtn}
                  activeOpacity={0.8}
                >
                  <ExternalLink size={16} color="#00F0FF" />
                  <Text style={styles.reconfigureBtnText}>Reconfigure</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDisconnect}
                  disabled={disconnecting}
                  style={styles.disconnectBtn}
                  activeOpacity={0.8}
                >
                  {disconnecting
                    ? <ActivityIndicator color="#EF4444" size="small" />
                    : <Link2Off size={16} color="#EF4444" />}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.notConnectedBody}>
              <View style={styles.warningIcon}>
                <AlertCircle size={28} color="#F59E0B" />
              </View>
              <Text style={styles.notConnectedTitle}>Not Connected</Text>
              <Text style={styles.notConnectedDesc}>
                Link your Facebook Business account to allow AdRoom AI to autonomously launch and manage your ads.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('AgentChat', { fromStrategyApproval: true })}
                style={styles.connectBtn}
                activeOpacity={0.85}
              >
                <Link2 size={18} color="#0B0F19" />
                <Text style={styles.connectBtnText}>Connect Facebook</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>

        {/* TikTok – Coming Soon */}
        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.comingSoonCard}>
          <View style={styles.platformHeader}>
            <View style={[styles.platformLogoWrap, { backgroundColor: '#111' }]}>
              <Text style={[styles.platformLogo, { color: '#FFFFFF' }]}>T</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.platformName, { opacity: 0.5 }]}>TikTok Ads</Text>
              <Text style={styles.platformSub}>TikTok for Business</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(112,0,255,0.08)', borderColor: 'rgba(112,0,255,0.2)' }]}>
              <Text style={{ color: '#7000FF', fontSize: 10, fontWeight: '700' }}>SOON</Text>
            </View>
          </View>
        </Animated.View>

        {/* Google Ads – Coming Soon */}
        <Animated.View entering={FadeInDown.delay(270).springify()} style={styles.comingSoonCard}>
          <View style={styles.platformHeader}>
            <View style={[styles.platformLogoWrap, { backgroundColor: 'rgba(234,67,53,0.1)' }]}>
              <Text style={[styles.platformLogo, { color: '#EA4335' }]}>G</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.platformName, { opacity: 0.5 }]}>Google Ads</Text>
              <Text style={styles.platformSub}>Google Marketing Platform</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(112,0,255,0.08)', borderColor: 'rgba(112,0,255,0.2)' }]}>
              <Text style={{ color: '#7000FF', fontSize: 10, fontWeight: '700' }}>SOON</Text>
            </View>
          </View>
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
  refreshBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { padding: 16, paddingBottom: 40 },
  pageDesc: { color: '#64748B', fontSize: 13, lineHeight: 20, marginBottom: 20 },
  platformCard: {
    backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B',
    overflow: 'hidden', marginBottom: 12,
  },
  comingSoonCard: {
    backgroundColor: '#0F1520', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B',
    overflow: 'hidden', marginBottom: 12, opacity: 0.6,
  },
  platformHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  platformLogoWrap: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: '#1877F2', alignItems: 'center', justifyContent: 'center',
  },
  platformLogo: { color: '#FFFFFF', fontWeight: '900', fontSize: 20 },
  platformName: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  platformSub: { color: '#475569', fontSize: 11, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  statusText: { fontSize: 11, fontWeight: '700' },
  loadingWrap: { flexDirection: 'row', alignItems: 'center', padding: 20, justifyContent: 'center', gap: 10 },
  loadingText: { color: '#64748B', fontSize: 13 },
  connectedBody: { padding: 16 },
  accountInfoRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 16,
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
  detailsBlock: { marginBottom: 14 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0B0F19', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#1E293B',
  },
  detailLabel: { color: '#64748B', fontSize: 12 },
  detailValue: { color: '#E2E8F0', fontWeight: '600', fontSize: 12, flex: 1, textAlign: 'right', marginLeft: 16 },
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(16,185,129,0.07)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)',
    borderRadius: 10, padding: 12, marginBottom: 16,
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
  notConnectedBody: { padding: 24, alignItems: 'center' },
  warningIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: 'rgba(245,158,11,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  notConnectedTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginBottom: 8 },
  notConnectedDesc: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  connectBtn: {
    backgroundColor: '#00F0FF', borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, paddingVertical: 14, gap: 10,
  },
  connectBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 15 },
});
