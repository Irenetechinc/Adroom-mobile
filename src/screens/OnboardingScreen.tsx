import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap, Target, TrendingUp, ShieldCheck, ArrowRight, Brain, Cpu } from 'lucide-react-native';
import Animated, {
  FadeInDown, FadeInUp, useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, withSequence, interpolate, Easing,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

const features = [
  {
    icon: Brain,
    title: 'AI Strategy Engine',
    description: 'Autonomous campaigns that adapt in real-time using GPT-powered decision making.',
    color: '#00F0FF',
    bg: 'rgba(0,240,255,0.08)',
    border: 'rgba(0,240,255,0.2)',
    delay: 500,
  },
  {
    icon: TrendingUp,
    title: 'Smart Asset Generation',
    description: 'Generate professional banners, ad copy, and creative assets in seconds.',
    color: '#7000FF',
    bg: 'rgba(112,0,255,0.08)',
    border: 'rgba(112,0,255,0.2)',
    delay: 650,
  },
  {
    icon: ShieldCheck,
    title: 'Auto Integrity Check',
    description: 'Every asset is vetted for policy compliance before going live on any platform.',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.2)',
    delay: 800,
  },
  {
    icon: Cpu,
    title: 'Autonomous Execution',
    description: 'Launch, manage, and optimize Facebook campaigns completely hands-free.',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.2)',
    delay: 950,
  },
];

function PulsingOrb() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000 }),
        withTiming(0.4, { duration: 2000 }),
      ),
      -1,
      false,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.outerOrb, animStyle]}>
      <View style={styles.innerOrb}>
        <Zap size={38} color="#00F0FF" />
      </View>
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
            <Text style={styles.tagline}>Automated Digital Marketing Agent</Text>
            <Text style={styles.subtitle}>
              The world's first fully autonomous marketing OS — powered by real AI.
            </Text>
          </Animated.View>
        </Animated.View>

        {/* Stats Row */}
        <Animated.View entering={FadeInDown.delay(400).springify()} style={styles.statsRow}>
          {[
            { value: '10x', label: 'Faster Setup' },
            { value: 'AI', label: 'Powered' },
            { value: '24/7', label: 'Autonomous' },
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
      <Animated.View entering={FadeInUp.delay(1100).springify()} style={styles.cta}>
        <TouchableOpacity
          onPress={() => navigation.replace('Login')}
          style={styles.ctaButton}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Get Started</Text>
          <View style={styles.ctaArrow}>
            <ArrowRight color="#0B0F19" size={20} strokeWidth={2.5} />
          </View>
        </TouchableOpacity>
        <Text style={styles.ctaNote}>Already have an account?{' '}
          <Text style={{ color: '#00F0FF' }} onPress={() => navigation.replace('Login')}>Sign In</Text>
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
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(0,240,255,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.4)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 28,
  },
  innerOrb: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(0,240,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
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
