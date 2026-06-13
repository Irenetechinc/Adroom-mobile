import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Share, ActivityIndicator, Clipboard, TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Gift, Copy, Share2, Users, CheckCircle, Clock, Zap } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAuthStore } from '../store/authStore';
import Constants from 'expo-constants';

const BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string) ||
  '';

interface ReferralStats {
  total: number;
  completed: number;
  pending: number;
  total_credits_earned: number;
}

export default function ReferralScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session } = useAuthStore();

  const [code, setCode] = useState<string | null>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const authHeader = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? ''}`,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [codeRes, statsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/referrals/my-code`, { headers: authHeader() }),
        fetch(`${BACKEND_URL}/api/referrals/stats`, { headers: authHeader() }),
      ]);
      const codeData = await codeRes.json();
      const statsData = await statsRes.json();
      if (codeData.code) setCode(codeData.code);
      if (!statsData.error) setStats(statsData);
    } catch { /* silently fail — show empty state */ }
    finally { setLoading(false); }
  }, [session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = () => {
    if (!code) return;
    Clipboard.setString(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: `Join me on AdRoom AI — the AI that runs your social media marketing automatically!\n\nUse my referral code ${code} when you sign up and we both earn energy credits.\n\nDownload the app and enter code: ${code}`,
        title: 'Join AdRoom AI',
      });
    } catch { /* user dismissed share sheet */ }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ArrowLeft size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Refer & Earn</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Math.max(40, insets.bottom + 20) }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card */}
        <Animated.View entering={FadeInDown.delay(50)} style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Gift size={32} color="#F59E0B" />
          </View>
          <Text style={styles.heroTitle}>Give a friend AdRoom AI.</Text>
          <Text style={styles.heroTitle}>Both of you earn credits.</Text>
          <Text style={styles.heroSub}>
            Share your unique referral code. When your friend activates their first plan, you instantly earn{' '}
            <Text style={{ color: '#F59E0B', fontWeight: '700' }}>25 energy credits</Text> — and so do they.
          </Text>
        </Animated.View>

        {/* Referral code box */}
        <Animated.View entering={FadeInDown.delay(100)} style={styles.codeCard}>
          <Text style={styles.codeLabel}>Your referral code</Text>
          {loading ? (
            <ActivityIndicator color="#7000FF" style={{ marginVertical: 16 }} />
          ) : (
            <View style={styles.codeRow}>
              <Text style={styles.codeText} selectable>{code ?? '——'}</Text>
              <TouchableOpacity onPress={handleCopy} style={styles.copyBtn} activeOpacity={0.8}>
                {copied
                  ? <CheckCircle size={18} color="#10B981" />
                  : <Copy size={18} color="#94A3B8" />}
                <Text style={[styles.copyBtnText, copied && { color: '#10B981' }]}>{copied ? 'Copied!' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity onPress={handleShare} style={styles.shareBtn} activeOpacity={0.85} disabled={!code}>
            <Share2 size={18} color="#0B0F19" />
            <Text style={styles.shareBtnText}>Share My Code</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Stats */}
        <Animated.View entering={FadeInDown.delay(150)} style={styles.statsCard}>
          <Text style={styles.statsTitle}>Your Referrals</Text>
          {loading ? (
            <ActivityIndicator color="#7000FF" style={{ marginVertical: 12 }} />
          ) : (
            <View style={styles.statsGrid}>
              <StatTile icon={<Users size={20} color="#7000FF" />} value={stats?.total ?? 0} label="Invited" />
              <StatTile icon={<CheckCircle size={20} color="#10B981" />} value={stats?.completed ?? 0} label="Activated" />
              <StatTile icon={<Clock size={20} color="#F59E0B" />} value={stats?.pending ?? 0} label="Pending" />
              <StatTile icon={<Zap size={20} color="#00F0FF" />} value={stats?.total_credits_earned ?? 0} label="Credits Earned" />
            </View>
          )}
        </Animated.View>

        {/* How it works */}
        <Animated.View entering={FadeInDown.delay(200)} style={styles.howCard}>
          <Text style={styles.statsTitle}>How it works</Text>
          {[
            { step: '1', title: 'Share your code', desc: 'Send your referral code to friends who want to grow their business with AI.' },
            { step: '2', title: 'They sign up', desc: 'Your friend creates an AdRoom AI account and enters your code during signup.' },
            { step: '3', title: 'Both earn credits', desc: 'When they activate their first plan, you both receive 25 energy credits instantly.' },
          ].map((item) => (
            <View key={item.step} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNum}>{item.step}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{item.title}</Text>
                <Text style={styles.stepDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <View style={styles.statTile}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { color: '#E2E8F0', fontSize: 17, fontWeight: '700' },
  heroCard: {
    backgroundColor: '#151B2B', borderRadius: 20, borderWidth: 1, borderColor: '#1E293B',
    padding: 24, alignItems: 'center', marginBottom: 16,
  },
  heroIconWrap: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  heroTitle: { color: '#E2E8F0', fontSize: 22, fontWeight: '800', textAlign: 'center', lineHeight: 30 },
  heroSub: { color: '#94A3B8', fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  codeCard: {
    backgroundColor: '#151B2B', borderRadius: 20, borderWidth: 1, borderColor: '#1E293B',
    padding: 20, marginBottom: 16,
  },
  codeLabel: { color: '#64748B', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0B0F19', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 16, paddingVertical: 12, marginBottom: 14,
  },
  codeText: { color: '#E2E8F0', fontSize: 24, fontWeight: '800', letterSpacing: 4 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  shareBtn: {
    backgroundColor: '#7000FF', borderRadius: 12, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  shareBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  statsCard: {
    backgroundColor: '#151B2B', borderRadius: 20, borderWidth: 1, borderColor: '#1E293B',
    padding: 20, marginBottom: 16,
  },
  statsTitle: { color: '#E2E8F0', fontSize: 15, fontWeight: '700', marginBottom: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statTile: {
    flex: 1, minWidth: '44%', backgroundColor: '#0B0F19', borderRadius: 12, borderWidth: 1,
    borderColor: '#1E293B', padding: 14, alignItems: 'center', gap: 6,
  },
  statValue: { color: '#E2E8F0', fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#64748B', fontSize: 12, fontWeight: '500' },
  howCard: {
    backgroundColor: '#151B2B', borderRadius: 20, borderWidth: 1, borderColor: '#1E293B',
    padding: 20,
  },
  stepRow: { flexDirection: 'row', gap: 14, marginBottom: 18, alignItems: 'flex-start' },
  stepBadge: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(112,0,255,0.15)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepNum: { color: '#7000FF', fontSize: 14, fontWeight: '800' },
  stepTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', marginBottom: 3 },
  stepDesc: { color: '#64748B', fontSize: 13, lineHeight: 19 },
});
