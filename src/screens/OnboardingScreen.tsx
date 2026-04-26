import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions, StyleSheet, Platform, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Target, TrendingUp, ShieldCheck, ArrowRight, Globe, Zap, Star, Users, Rocket } from 'lucide-react-native';
import Animated, {
  FadeInDown, FadeInUp, useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, withSequence, interpolate, Easing,
} from 'react-native-reanimated';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';

const { width, height } = Dimensions.get('window');

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

const features = [
  {
    icon: TrendingUp,
    title: 'Explosive Sales Growth',
    description: 'A dedicated workforce that finds buyers, crafts persuasive content, and drives conversions across every platform — non-stop.',
    color: '#00F0FF',
    bg: 'rgba(0,240,255,0.08)',
    border: 'rgba(0,240,255,0.2)',
    delay: 500,
  },
  {
    icon: Globe,
    title: 'Brand Awareness at Scale',
    description: 'Reach tens of thousands of potential customers organically across Facebook, Instagram, TikTok, LinkedIn, and X.',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.2)',
    delay: 650,
  },
  {
    icon: Target,
    title: 'High-Quality Leads',
    description: 'Pinpoints your ideal audience using real-time trend intelligence and turns cold prospects into warm, ready-to-buy leads.',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.2)',
    delay: 800,
  },
  {
    icon: Rocket,
    title: 'Instant Campaign Launches',
    description: 'A full launch framework — content calendar, audience targeting, and execution — assembled in minutes, not weeks.',
    color: '#7C3AED',
    bg: 'rgba(124,58,237,0.08)',
    border: 'rgba(124,58,237,0.2)',
    delay: 950,
  },
  {
    icon: Zap,
    title: 'Promotions That Convert',
    description: 'Time-sensitive, high-urgency campaigns tailored to your product and audience — proven to drive immediate revenue.',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.2)',
    delay: 1100,
  },
  {
    icon: ShieldCheck,
    title: 'Built-in Integrity Check',
    description: 'Every post, ad, and asset is vetted for policy compliance before it ever goes live on any platform.',
    color: '#06B6D4',
    bg: 'rgba(6,182,212,0.08)',
    border: 'rgba(6,182,212,0.2)',
    delay: 1250,
  },
];

function PulsingOrb() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.outerOrb, animStyle]}>
      <Image
        source={require('../../assets/icon.png')}
        style={styles.logoImage}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

function FeatureRow({ icon: Icon, title, description, color, bg, border, delay }: any) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify()} style={[styles.featureCard, { backgroundColor: bg, borderColor: border }]}>
      <View style={[styles.featureIcon, { backgroundColor: `${color}15` }]}>
        <Icon size={20} color={color} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </Animated.View>
  );
}

export default function OnboardingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS !== 'web') {
          await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
              allowAnnouncements: true,
            },
          });
        }
      } catch {}
      try {
        await Location.requestForegroundPermissionsAsync();
      } catch {}
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.hero}>
          <PulsingOrb />

          <Animated.View entering={FadeInUp.delay(300).springify()}>
            <Text style={styles.brandSmall}>WELCOME TO</Text>
            <Text style={styles.brandName}>
              AdRoom <Text style={{ color: '#00F0FF' }}>AI</Text>
            </Text>
            <Text style={styles.tagline}>Intelligent Automated Digital Marketing Framework</Text>
            <Text style={styles.subtitle}>
              An always-on intelligence workforce that markets your brand across every major platform — no agencies, no ad budgets, no delays.
            </Text>
          </Animated.View>
        </Animated.View>

        {/* Stats Row */}
        <Animated.View entering={FadeInDown.delay(400).springify()} style={styles.statsRow}>
          {[
            { value: '$0', label: 'Ad Spend' },
            { value: '24/7', label: 'Always On' },
            { value: '5×', label: 'More Reach' },
          ].map((stat, i) => (
            <View key={i} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Features */}
        <View style={styles.features}>
          {features.map((f, i) => (
            <FeatureRow key={i} {...f} />
          ))}
        </View>
      </ScrollView>

      {/* CTA */}
      <Animated.View
        entering={FadeInUp.delay(1100).springify()}
        style={[styles.cta, { paddingBottom: Math.max(insets.bottom + 16, 32) }]}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('Signup')}
          style={styles.ctaButton}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Get Started</Text>
          <View style={styles.ctaArrow}>
            <ArrowRight color="#0B0F19" size={20} strokeWidth={2.5} />
          </View>
        </TouchableOpacity>
        <Text style={styles.ctaNote}>Already have an account?{' '}
          <Text style={{ color: '#00F0FF' }} onPress={() => navigation.navigate('Login')}>Sign In</Text>
        </Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  scroll: { paddingBottom: 160, paddingTop: 20 },
  hero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28 },
  outerOrb: {
    width: 110, height: 110, borderRadius: 34,
    backgroundColor: '#151B2B',
    borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.35)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 28,
    overflow: 'hidden',
  },
  logoImage: {
    width: 90, height: 90, borderRadius: 26,
  },
  brandSmall: {
    color: '#64748B', fontSize: 11, letterSpacing: 4,
    fontWeight: '700', textAlign: 'center', marginBottom: 6,
  },
  brandName: {
    color: '#FFFFFF', fontSize: 38, fontWeight: '900',
    textAlign: 'center', letterSpacing: -0.5,
  },
  tagline: {
    color: '#94A3B8', fontSize: 15, textAlign: 'center',
    fontWeight: '500', marginTop: 8, letterSpacing: 0.2,
  },
  subtitle: {
    color: '#475569', fontSize: 13, textAlign: 'center',
    marginTop: 12, lineHeight: 20, paddingHorizontal: 16,
  },
  statsRow: {
    flexDirection: 'row', marginHorizontal: 24, marginBottom: 28,
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.1)',
    overflow: 'hidden',
  },
  stat: {
    flex: 1, alignItems: 'center', paddingVertical: 16,
    borderRightWidth: 1, borderRightColor: 'rgba(0,240,255,0.08)',
  },
  statValue: { color: '#00F0FF', fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#64748B', fontSize: 11, marginTop: 3, fontWeight: '500' },
  features: { paddingHorizontal: 20 },
  featureCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 16,
    padding: 16, marginBottom: 12,
  },
  featureIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  featureTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, marginBottom: 3 },
  featureDesc: { color: '#64748B', fontSize: 12, lineHeight: 17 },
  cta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingBottom: 32, paddingTop: 20,
    backgroundColor: '#0B0F19',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
  },
  ctaButton: {
    backgroundColor: '#00F0FF', borderRadius: 16,
    height: 56, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  ctaText: {
    color: '#0B0F19', fontWeight: '800', fontSize: 17, letterSpacing: 0.3,
  },
  ctaArrow: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center', justifyContent: 'center', marginLeft: 10,
  },
  ctaNote: { color: '#64748B', textAlign: 'center', fontSize: 13 },
});
