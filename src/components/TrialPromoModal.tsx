import React, { useEffect, useState, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Zap, X, Star, Check } from 'lucide-react-native';
import Constants from 'expo-constants';
import { supabase } from '../services/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000';
const SEEN_KEY = 'adroom-trial-modal-seen';

interface Props {
  onNavigateToSubscription: () => void;
}

export default function TrialPromoModal({ onNavigateToSubscription }: Props) {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkAndShow();
  }, []);

  // Pulse animation on the CTA button
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
      // Don't show if user has already seen/dismissed it
      const seen = await AsyncStorage.getItem(SEEN_KEY);
      if (seen) return;

      // Get current user
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Check eligibility from backend (source of truth)
      const res = await fetch(`${API_URL}/api/billing/trial-eligibility`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.eligible) return;

      // Calculate 48h expiry from account creation time
      const createdAt = new Date(session.user.created_at).getTime();
      const expiry = createdAt + 48 * 60 * 60 * 1000;
      if (Date.now() >= expiry) {
        // Already expired — mark seen silently so we don't keep checking
        await AsyncStorage.setItem(SEEN_KEY, 'expired');
        return;
      }

      setExpiresAt(expiry);
      setVisible(true);
    } catch { /* non-fatal — modal is optional */ }
  };

  const dismiss = async () => {
    setVisible(false);
    await AsyncStorage.setItem(SEEN_KEY, 'dismissed').catch(() => {});
  };

  const handleClaim = async () => {
    setVisible(false);
    await AsyncStorage.setItem(SEEN_KEY, 'claimed').catch(() => {});
    onNavigateToSubscription();
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
            Start your free trial today. No charge for 14 days — just a $2 card hold to verify your payment method (refunded instantly).
          </Text>

          {/* Features */}
          {['All 4 AI agents active', '50 energy credits included', 'Auto-publish to all platforms', 'Cancel anytime'].map((f) => (
            <View key={f} style={styles.featureRow}>
              <Check color="#10B981" size={14} strokeWidth={2.5} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}

          {/* Countdown */}
          <View style={styles.countdownBox}>
            <Star color="#F59E0B" size={12} />
            <Text style={styles.countdownLabel}>Offer expires in </Text>
            <Text style={styles.countdownValue}>{countdown}</Text>
          </View>

          {/* CTA */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
            <TouchableOpacity style={styles.ctaBtn} onPress={handleClaim} activeOpacity={0.85}>
              <Zap color="#000" size={16} strokeWidth={2.5} />
              <Text style={styles.ctaText}>Claim Free Trial</Text>
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
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0D1421',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    padding: 24,
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
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(245,158,11,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  featureText: {
    color: '#CBD5E1',
    fontSize: 13,
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
    marginTop: 16,
    marginBottom: 20,
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
