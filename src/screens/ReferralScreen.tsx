import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Share, ActivityIndicator, Clipboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft, Gift, Copy, Share2, Users, CheckCircle, Clock, Zap, Sparkles,
} from 'lucide-react-native';
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
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Refer & Earn</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Math.max(40, insets.bottom + 20) }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card */}
        <Animated.View entering={FadeInDown.delay(50).springify()} style={s.heroCard}>
          <View style={s.heroIconWrap}>
            <Gift size={32} color="#F59E0B" />
          </View>
          <Text style={s.heroTitle}>Give AdRoom AI to a friend.</Text>
          <Text style={s.heroTitle}>You both earn credits.</Text>
          <Text style={s.heroSub}>
            Share your unique referral code. When your friend activates their first plan, you both
            instantly earn{' '}
            <Text style={{ color: '#F59E0B', fontWeight: '700' }}>25 energy credits</Text>.
          </Text>
          <View style={s.heroPill}>
            <Sparkles size={12} color="#F59E0B" />
            <Text style={s.heroPillText}>No limit — earn from every referral</Text>
          </View>
        </Animated.View>

        {/* Referral code box */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={s.codeCard}>
          <Text style={s.codeLabel}>Your referral code</Text>
          {loading ? (
            <ActivityIndicator color="#7000FF" style={{ marginVertical: 16 }} />
          ) : (
            <View style={s.codeRow}>
              <Text style={s.codeText} selectable>{code ?? '——'}</Text>
              <TouchableOpacity onPress={handleCopy} style={[s.copyBtn, copied && s.copyBtnActive]} activeOpacity={0.8}>
                {copied
                  ? <CheckCircle size={16} color="#10B981" />
                  : <Copy size={16} color="#94A3B8" />}
                <Text style={[s.copyBtnText, copied && { color: '#10B981' }]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity onPress={handleShare} style={s.shareBtn} activeOpacity={0.85} disabled={!code}>
            <Share2 size={18} color="#FFFFFF" />
            <Text style={s.shareBtnText}>Share My Code</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Stats */}
        <Animated.View entering={FadeInDown.delay(150).springify()} style={s.sectionCard}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Your Referrals</Text>
            {(stats?.total ?? 0) > 0 && (
              <View style={s.sectionBadge}>
                <Text style={s.sectionBadgeText}>{stats?.total} total</Text>
              </View>
            )}
          </View>
          {loading ? (
            <ActivityIndicator color="#7000FF" style={{ marginVertical: 12 }} />
          ) : (
            <View style={s.statsGrid}>
              <StatTile
                icon={<Users size={18} color="#7000FF" />}
                value={stats?.total ?? 0}
                label="Invited"
                accentColor="#7000FF"
              />
              <StatTile
                icon={<CheckCircle size={18} color="#10B981" />}
                value={stats?.completed ?? 0}
                label="Activated"
                accentColor="#10B981"
              />
              <StatTile
                icon={<Clock size={18} color="#F59E0B" />}
                value={stats?.pending ?? 0}
                label="Pending"
                accentColor="#F59E0B"
              />
              <StatTile
                icon={<Zap size={18} color="#00F0FF" />}
                value={stats?.total_credits_earned ?? 0}
                label="Credits Earned"
                accentColor="#00F0FF"
              />
            </View>
          )}
        </Animated.View>

        {/* How it works */}
        <Animated.View entering={FadeInDown.delay(200).springify()} style={s.sectionCard}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>How it works</Text>
          </View>
          {[
            {
              step: '1',
              title: 'Share your code',
              desc: 'Send your referral code to friends who want to grow their business with AI.',
              color: '#7000FF',
            },
            {
              step: '2',
              title: 'They sign up',
              desc: "Your friend creates an AdRoom AI account and enters your code during signup.",
              color: '#00F0FF',
            },
            {
              step: '3',
              title: 'Both earn credits',
              desc: 'When they activate their first plan, you both receive 25 energy credits instantly.',
              color: '#F59E0B',
            },
          ].map((item, i, arr) => (
            <View key={item.step} style={[s.stepRow, i < arr.length - 1 && { marginBottom: 20 }]}>
              <View style={s.stepLeft}>
                <View style={[s.stepBadge, { backgroundColor: `${item.color}18`, borderColor: `${item.color}30` }]}>
                  <Text style={[s.stepNum, { color: item.color }]}>{item.step}</Text>
                </View>
                {i < arr.length - 1 && <View style={s.stepConnector} />}
              </View>
              <View style={{ flex: 1, paddingTop: 4 }}>
                <Text style={s.stepTitle}>{item.title}</Text>
                <Text style={s.stepDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({
  icon, value, label, accentColor,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  accentColor: string;
}) {
  return (
    <View style={[s.statTile, { borderColor: `${accentColor}18` }]}>
      <View style={[s.statIconWrap, { backgroundColor: `${accentColor}12` }]}>
        {icon}
      </View>
      <Text style={[s.statValue, { color: accentColor }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  backBtn: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { color: '#E2E8F0', fontSize: 17, fontWeight: '700' },

  heroCard: {
    backgroundColor: '#0F1623',
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.18)',
    padding: 24, alignItems: 'center', marginBottom: 14,
  },
  heroIconWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.22)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  heroTitle: {
    color: '#F1F5F9', fontSize: 22, fontWeight: '800',
    textAlign: 'center', lineHeight: 30, letterSpacing: -0.2,
  },
  heroSub: {
    color: '#94A3B8', fontSize: 14, textAlign: 'center',
    marginTop: 10, lineHeight: 22,
  },
  heroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 14, backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  heroPillText: { color: '#F59E0B', fontSize: 12, fontWeight: '600' },

  codeCard: {
    backgroundColor: '#0F1623',
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(112,0,255,0.22)',
    padding: 20, marginBottom: 14,
  },
  codeLabel: {
    color: '#64748B', fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12,
  },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#080C14', borderRadius: 14, borderWidth: 1, borderColor: '#1E293B',
    paddingHorizontal: 18, paddingVertical: 14, marginBottom: 14,
  },
  codeText: {
    color: '#F1F5F9', fontSize: 26, fontWeight: '900', letterSpacing: 5,
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#1A2235', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: '#2D3D55',
  },
  copyBtnActive: {
    backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)',
  },
  copyBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  shareBtn: {
    backgroundColor: '#7000FF', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  shareBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  sectionCard: {
    backgroundColor: '#0F1623', borderRadius: 22,
    borderWidth: 1, borderColor: '#1A2235',
    padding: 20, marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 18,
  },
  sectionTitle: { color: '#E2E8F0', fontSize: 15, fontWeight: '700' },
  sectionBadge: {
    backgroundColor: 'rgba(112,0,255,0.12)', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  sectionBadgeText: { color: '#A78BFA', fontSize: 12, fontWeight: '600' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: {
    flex: 1, minWidth: '44%', backgroundColor: '#080C14',
    borderRadius: 14, borderWidth: 1,
    padding: 14, alignItems: 'center', gap: 8,
  },
  statIconWrap: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  statLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  stepRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  stepLeft: { alignItems: 'center' },
  stepBadge: {
    width: 34, height: 34, borderRadius: 11, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepConnector: { width: 2, flex: 1, minHeight: 18, backgroundColor: '#1E293B', marginTop: 4 },
  stepNum: { fontSize: 14, fontWeight: '900' },
  stepTitle: { color: '#E2E8F0', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  stepDesc: { color: '#64748B', fontSize: 13, lineHeight: 19 },
});
