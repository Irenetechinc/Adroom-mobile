import React, { useEffect, useState, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Animated, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Zap, X, Star, Check, Crown } from 'lucide-react-native';
import Constants from 'expo-constants';
import { supabase } from '../services/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000';
const SEEN_KEY = 'adroom-trial-modal-seen';

const TRIAL_PLANS = [
  { id: 'starter', name: 'Starter', price: 20, credits: 100, color: '#00F0FF', desc: 'Perfect for getting started' },
  { id: 'pro',     name: 'Pro',     price: 45, credits: 300, color: '#7C3AED', desc: 'Most popular — all agents' },
  { id: 'pro_plus',name: 'Pro+',    price: 100, credits: 600, color: '#F59E0B', desc: 'Maximum power & platforms' },
];

interface Props {
  onStartTrial: (planId: string) => void;
}

export default function TrialPromoModal({ onStartTrial }: Props) {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkAndShow();
  }, []);

  // Pulse animation on CTA
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible]);

  // Live countdown ticker
  useEffect(() => {
    if (!visible || !expiresAt) return;
    const tick = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setCountdown('Expired');
        setVisible(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`);
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [visible, expiresAt]);

  const checkAndShow = async () => {
    try {
      const seen = await AsyncStorage.getItem(SEEN_KEY);
      if (seen) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const createdAt = new Date(session.user.created_at).getTime();
      const expiry = createdAt + 48 * 60 * 60 * 1000;

      // Already past the 48h window
      if (Date.now() >= expiry) {
        await AsyncStorage.setItem(SEEN_KEY, 'expired');
        return;
      }

      // Check eligibility — backend is authoritative, local age-check is fallback
      let eligible = false;
      try {
        const res = await fetch(`${API_URL}/api/billing/trial-eligibility`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          eligible = data.eligible === true;
        } else {
          // Backend unreachable: fall back to age-based check
          eligible = Date.now() < expiry;
        }
      } catch {
        // Network error: fall back to age-based check
        eligible = Date.now() < expiry;
      }

      if (!eligible) return;

      setExpiresAt(expiry);
      setVisible(true);
    } catch { /* non-fatal */ }
  };

  const dismiss = async () => {
    setVisible(false);
    await AsyncStorage.setItem(SEEN_KEY, 'dismissed').catch(() => {});
  };

  const handleClaim = async () => {
    setVisible(false);
    await AsyncStorage.setItem(SEEN_KEY, 'claimed').catch(() => {});
    onStartTrial(selectedPlan);
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Dismiss */}
          <TouchableOpacity style={styles.closeBtn} onPress={dismiss}>
            <X color="#64748B" size={18} />
          </TouchableOpacity>

          {/* Icon */}
          <View style={styles.iconRing}>
            <Zap color="#F59E0B" size={32} strokeWidth={2.5} />
          </View>

          {/* Title */}
          <Text style={styles.title}>14-Day Free Trial</Text>
          <Text style={styles.subtitle}>
            Try AdRoom completely free for 14 days. Pick a plan below to unlock your AI marketing team — no charge until day 15.
          </Text>

          {/* Features */}
          {['No charge for 14 days', '50 energy credits to start', 'Auto-publish to all platforms', 'Cancel anytime before day 15'].map((f) => (
            <View key={f} style={styles.featureRow}>
              <Check color="#10B981" size={14} strokeWidth={2.5} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}

          {/* Plan selector */}
          <Text style={styles.planSelectorLabel}>Choose your plan:</Text>
          {TRIAL_PLANS.map((plan) => {
            const isSelected = plan.id === selectedPlan;
            return (
              <TouchableOpacity
                key={plan.id}
                onPress={() => setSelectedPlan(plan.id)}
                activeOpacity={0.75}
                style={[
                  styles.planRow,
                  { borderColor: isSelected ? plan.color : 'rgba(100,116,139,0.3)' },
                  isSelected && { backgroundColor: `${plan.color}12` },
                ]}
              >
                <View style={[styles.planCheck, { borderColor: plan.color, backgroundColor: isSelected ? plan.color : 'transparent' }]}>
                  {isSelected && <Check color="#000" size={10} strokeWidth={3} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planName, { color: isSelected ? plan.color : '#CBD5E1' }]}>
                    {plan.name}
                  </Text>
                  <Text style={styles.planDesc}>{plan.desc} · ${plan.price}/mo after trial</Text>
                </View>
                <View style={[styles.planCredits, { backgroundColor: `${plan.color}20` }]}>
                  <Zap size={10} color={plan.color} />
                  <Text style={[styles.planCreditsText, { color: plan.color }]}>{plan.credits}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Countdown */}
          <View style={styles.countdownBox}>
            <Star color="#F59E0B" size={12} />
            <Text style={styles.countdownLabel}>Offer expires in </Text>
            <Text style={styles.countdownValue}>{countdown}</Text>
          </View>

          {/* CTA */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
            <TouchableOpacity style={styles.ctaBtn} onPress={handleClaim} activeOpacity={0.85}>
              <Crown color="#000" size={16} strokeWidth={2.5} />
              <Text style={styles.ctaText}>Claim 14-Day Free Trial</Text>
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity onPress={dismiss} style={{ marginTop: 12 }}>
            <Text style={styles.skipText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0D1421',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    padding: 22,
    alignItems: 'center',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(245,158,11,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    marginTop: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 5,
  },
  featureText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  planSelectorLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
    marginTop: 14,
    marginBottom: 8,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 7,
  },
  planCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: {
    fontSize: 14,
    fontWeight: '700',
  },
  planDesc: {
    color: '#475569',
    fontSize: 11,
    marginTop: 1,
  },
  planCredits: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  planCreditsText: {
    fontSize: 11,
    fontWeight: '700',
  },
  countdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 14,
    marginBottom: 16,
  },
  countdownLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  countdownValue: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F59E0B',
    borderRadius: 14,
    paddingVertical: 15,
    width: '100%',
  },
  ctaText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  skipText: {
    color: '#475569',
    fontSize: 13,
  },
});
