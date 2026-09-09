import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  Dimensions,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Target, TrendingUp, ShieldCheck, ArrowRight, Globe, Zap, Rocket } from 'lucide-react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';

const { width } = Dimensions.get('window');

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

const features = [
  {
    icon: TrendingUp,
    title: 'Autonomous targeting',
    description: 'Adirum AI identifies and prioritizes the opportunities most likely to convert, then moves without manual direction or repeated prompting.',
    color: '#00F0FF',
    bg: 'rgba(0,240,255,0.08)',
    border: 'rgba(0,240,255,0.18)',
    delay: 420,
  },
  {
    icon: Globe,
    title: 'Autonomous market signal',
    description: 'The system continuously detects where demand is forming so the right buyers, message, and timing are aligned around active opportunity.',
    color: '#34D399',
    bg: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.18)',
    delay: 560,
  },
  {
    icon: Target,
    title: 'Autonomous outreach',
    description: 'The workforce engages the right prospects and advances conversations without waiting for human approvals or repeated instruction.',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.18)',
    delay: 700,
  },
  {
    icon: Rocket,
    title: 'Autonomous deal flow',
    description: 'Once momentum is active, the system keeps the deal moving through the next qualifying steps and toward conversion with minimal friction.',
    color: '#A78BFA',
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.18)',
    delay: 840,
  },
  {
    icon: Zap,
    title: 'Autonomous operations',
    description: 'Execution is handled end-to-end so campaigns, follow-up, and required next actions keep moving without slowing the user down.',
    color: '#F87171',
    bg: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.18)',
    delay: 980,
  },
  {
    icon: ShieldCheck,
    title: 'Outcome-first experience',
    description: 'The user sees sales momentum, customer acquisition, and revenue impact — not a list of suggestions or operational chores to manage manually.',
    color: '#38BDF8',
    bg: 'rgba(56,189,248,0.08)',
    border: 'rgba(56,189,248,0.18)',
    delay: 1120,
  },
];

function PulsingOrb() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.outerOrb, animStyle]}>
      <View style={styles.orbHalo} />
      <Image source={require('../../assets/icon.png')} style={styles.logoImage} resizeMode="contain" />
    </Animated.View>
  );
}

function FeatureRow({ icon: Icon, title, description, color, bg, border, delay }: any) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify()} style={[styles.featureCard, { backgroundColor: bg, borderColor: border }]}>
      <View style={[styles.featureIcon, { backgroundColor: `${color}1F` }]}>
        <Icon size={19} color={color} strokeWidth={2.2} />
      </View>
      <View style={styles.featureCopy}>
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
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
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
        <Animated.View entering={FadeInDown.delay(130).springify()} style={styles.topBar}>
          <View style={styles.brandChip}>
            <Text style={styles.brandChipText}>Adirum AI</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} activeOpacity={0.9}>
            <Text style={styles.loginLink}>Log in</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(260).springify()} style={styles.heroCard}>
          <View style={styles.heroRow}>
            <PulsingOrb />
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Live ops</Text>
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>Ready</Text>
              </View>
            </View>
          </View>

          <Text style={styles.kicker}>Autonomous Marketing Workforce</Text>
          <Text style={styles.brandName}>
            We find the buyer.{'\n'}We close the deal.
          </Text>
          <Text style={styles.subtitle}>
            Adirum AI is a 100% autonomous marketing workforce built to identify demand, advance the right pipeline, and deliver measurable sales outcomes without requiring manual intervention.
          </Text>

          <View style={styles.heroActions}>
            <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Signup')} activeOpacity={0.9}>
              <Text style={styles.primaryButtonText}>Get started</Text>
              <View style={styles.primaryButtonIcon}>
                <ArrowRight size={18} color="#07111C" strokeWidth={2.5} />
              </View>
            </TouchableOpacity>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(440).springify()} style={styles.statsRow}>
          {[
            { value: '24/7', label: 'Live orchestration' },
            { value: '5×', label: 'More reach' },
            { value: '1 flow', label: 'From idea to action' },
          ].map((stat, index) => (
            <View key={index} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </Animated.View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionEyebrow}>What you unlock</Text>
          <Text style={styles.sectionTitle}>Autonomous growth. Measurable results.</Text>
        </View>

        <View style={styles.featuresList}>
          {features.map((feature) => (
            <FeatureRow key={feature.title} {...feature} />
          ))}
        </View>
      </ScrollView>

      <Animated.View
        entering={FadeInUp.delay(1100).springify()}
        style={[styles.cta, { paddingBottom: Math.max(insets.bottom + 16, 28) }]}
      >
        <Text style={styles.ctaNote}>Already have an account?</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.ctaButton} activeOpacity={0.9}>
          <Text style={styles.ctaText}>Sign in</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07111C',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 160,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  brandChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.18)',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
  },
  brandChipText: {
    color: '#E2F7FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  loginLink: {
    color: '#7DD3FC',
    fontSize: 13,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: '#0F1B2A',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
    marginBottom: 18,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
  },
  outerOrb: {
    width: 86,
    height: 86,
    borderRadius: 26,
    backgroundColor: '#111E2D',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  orbHalo: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 38,
    backgroundColor: 'rgba(0,240,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.18)',
  },
  logoImage: {
    width: 66,
    height: 66,
    borderRadius: 20,
    zIndex: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.24)',
    backgroundColor: 'rgba(52,211,153,0.08)',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.28)',
    backgroundColor: 'rgba(96,165,250,0.08)',
  },
  badgeText: {
    color: '#A7F3D0',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  statusPillText: {
    color: '#BFDBFE',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  kicker: {
    color: '#8FB3CF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  brandName: {
    color: '#F8FAFC',
    fontSize: Math.min(width * 0.09, 33),
    lineHeight: Math.min(width * 0.12, 41),
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 10,
  },
  subtitle: {
    color: '#9AAFC2',
    fontSize: 14,
    lineHeight: 22,
    maxWidth: 560,
  },
  heroActions: {
    marginTop: 18,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00F0FF',
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#07111C',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  primaryButtonIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(7,17,28,0.13)',
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    backgroundColor: '#0F1B2A',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.10)',
    borderRadius: 18,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 22,
  },
  stat: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(148,163,184,0.08)',
  },
  statValue: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  sectionHeader: {
    marginTop: 4,
    marginBottom: 14,
  },
  sectionEyebrow: {
    color: '#6EE7F9',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  featuresList: {
    marginBottom: 12,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  featureCopy: {
    flex: 1,
  },
  featureTitle: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 4,
  },
  featureDesc: {
    color: '#9AAFC2',
    fontSize: 12.5,
    lineHeight: 18,
  },
  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(7,17,28,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(148,163,184,0.10)',
  },
  ctaNote: {
    color: '#8E9EB4',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  ctaButton: {
    backgroundColor: '#101A2A',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.18)',
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#E2F7FF',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
