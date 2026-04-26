import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert, Modal,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { Mail, Lock, Eye, EyeOff, ArrowLeft, UserPlus, CheckCircle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

type Props = NativeStackScreenProps<RootStackParamList, 'Signup'>;

const BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string) ||
  '';

export default function SignupScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const handleSignup = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Missing Fields', 'Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      if (BACKEND_URL) {
        const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        const data = await res.json();
        setLoading(false);
        if (!res.ok) {
          Alert.alert('Registration Failed', data.error || 'Something went wrong. Please try again.');
          return;
        }
        await supabase.auth.resend({ type: 'signup', email: email.trim() }).catch(() => {});
      } else {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        setLoading(false);
        if (error) {
          Alert.alert('Registration Failed', error.message);
          return;
        }
      }
      setRegisteredEmail(email.trim());
      setShowEmailModal(true);
    } catch (err: any) {
      setLoading(false);
      Alert.alert('Registration Failed', 'Could not connect. Please check your connection and try again.');
    }
  };

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleResend = async () => {
    if (resendLoading || resendCooldown > 0 || !registeredEmail) return;
    setResendLoading(true);
    setResendSent(false);
    try {
      if (BACKEND_URL) {
        await fetch(`${BACKEND_URL}/api/auth/resend-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: registeredEmail }),
        }).catch(() => {});
      }
      await supabase.auth.resend({ type: 'signup', email: registeredEmail }).catch(() => {});
      setResendSent(true);
      setResendCooldown(60);
      cooldownRef.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      // silently ignore
    } finally {
      setResendLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Back */}
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
            <ArrowLeft size={22} color="#94A3B8" />
          </TouchableOpacity>

          {/* Header */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.header}>
            <View style={styles.logoIcon}>
              <UserPlus size={26} color="#7000FF" />
            </View>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Set up your intelligence workforce in under a minute</Text>
          </Animated.View>

          {/* Form */}
          <Animated.View entering={FadeInDown.delay(250).springify()} style={styles.form}>
            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={[styles.inputWrap, emailFocused && styles.inputFocused]}>
                <Mail size={18} color={emailFocused ? '#7000FF' : '#475569'} style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.input}
                  placeholder="your@email.com"
                  placeholderTextColor="#475569"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.inputWrap, passFocused && styles.inputFocused]}>
                <Lock size={18} color={passFocused ? '#7000FF' : '#475569'} style={{ marginRight: 10 }} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Min. 6 characters"
                  placeholderTextColor="#475569"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  onFocus={() => setPassFocused(true)}
                  onBlur={() => setPassFocused(false)}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  {showPassword ? <EyeOff size={18} color="#475569" /> : <Eye size={18} color="#475569" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={[styles.inputWrap, confirmFocused && styles.inputFocused]}>
                <Lock size={18} color={confirmFocused ? '#7000FF' : '#475569'} style={{ marginRight: 10 }} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Repeat your password"
                  placeholderTextColor="#475569"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirm}
                  onFocus={() => setConfirmFocused(true)}
                  onBlur={() => setConfirmFocused(false)}
                />
                <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  {showConfirm ? <EyeOff size={18} color="#475569" /> : <Eye size={18} color="#475569" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Terms notice */}
            <Text style={styles.terms}>
              By creating an account you agree to our{' '}
              <Text style={{ color: '#7000FF' }}>Terms of Service</Text> and{' '}
              <Text style={{ color: '#7000FF' }}>Privacy Policy</Text>.
            </Text>

            {/* Submit */}
            <TouchableOpacity
              onPress={handleSignup}
              disabled={loading}
              style={[styles.btn, loading && { opacity: 0.7 }]}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.btnText}>Create Account</Text>}
            </TouchableOpacity>

            {/* Sign in link */}
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.signinRow}>
              <Text style={styles.signinText}>Already have an account?{' '}</Text>
              <Text style={[styles.signinText, { color: '#7000FF', fontWeight: '700' }]}>Sign In</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Email Verification Sent Modal */}
      <Modal visible={showEmailModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Icon */}
            <View style={styles.modalIconWrap}>
              <View style={styles.modalIconRing}>
                <Mail size={30} color="#7000FF" />
              </View>
            </View>

            {/* Title */}
            <Text style={styles.modalTitle}>Check Your Inbox</Text>
            <Text style={styles.modalSubtitle}>
              We sent a verification link to
            </Text>
            <View style={styles.emailChip}>
              <Text style={styles.emailChipText} numberOfLines={1}>{registeredEmail}</Text>
            </View>
            <Text style={styles.modalBody}>
              Tap the link in the email to activate your AdRoom AI account. It may take a moment to arrive — check your spam folder if needed.
            </Text>

            {/* Divider */}
            <View style={styles.modalDivider} />

            {/* Steps */}
            {[
              'Open the email from AdRoom AI',
              'Tap "Confirm My Email"',
              'Sign in and launch your first campaign',
            ].map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}

            {/* Resend */}
            <TouchableOpacity
              onPress={handleResend}
              disabled={resendLoading || resendCooldown > 0}
              style={[
                styles.resendBtn,
                resendSent && styles.resendBtnSent,
                (resendCooldown > 0 && !resendSent) && { opacity: 0.5 },
              ]}
              activeOpacity={0.75}
            >
              {resendLoading ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : resendSent ? (
                <>
                  <CheckCircle size={14} color="#10B981" />
                  <Text style={[styles.resendText, { color: '#10B981' }]}>
                    Sent!{resendCooldown > 0 ? `  Resend in ${resendCooldown}s` : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.resendText}>
                  Didn't get it?{resendCooldown > 0 ? `  Resend in ${resendCooldown}s` : '  Resend Email'}
                </Text>
              )}
            </TouchableOpacity>

            {/* CTA */}
            <TouchableOpacity
              onPress={() => {
                setShowEmailModal(false);
                navigation.navigate('Login');
              }}
              style={styles.modalBtn}
              activeOpacity={0.85}
            >
              <CheckCircle size={18} color="#fff" />
              <Text style={styles.modalBtnText}>Got it — Go to Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  header: { alignItems: 'center', marginBottom: 36 },
  logoIcon: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: 'rgba(112,0,255,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(112,0,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { color: '#E2E8F0', fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: '#64748B', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 16 },
  form: {},
  fieldGroup: { marginBottom: 16 },
  label: { color: '#94A3B8', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#151B2B',
    borderWidth: 1.5, borderColor: '#1E293B',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
  },
  inputFocused: { borderColor: '#7000FF', backgroundColor: 'rgba(112,0,255,0.04)' },
  input: { flex: 1, color: '#E2E8F0', fontSize: 15, fontWeight: '500' },
  terms: { color: '#475569', fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 24, marginTop: 4 },
  btn: {
    backgroundColor: '#7000FF', borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  btnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  signinRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },
  signinText: { color: '#64748B', fontSize: 14 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    backgroundColor: '#151B2B', borderRadius: 24,
    padding: 28, width: '100%',
    borderWidth: 1, borderColor: 'rgba(112,0,255,0.25)',
  },
  modalIconWrap: { alignItems: 'center', marginBottom: 20 },
  modalIconRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(112,0,255,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(112,0,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: {
    color: '#E2E8F0', fontSize: 22, fontWeight: '800',
    textAlign: 'center', letterSpacing: -0.3, marginBottom: 8,
  },
  modalSubtitle: {
    color: '#64748B', fontSize: 13, textAlign: 'center', marginBottom: 8,
  },
  emailChip: {
    alignSelf: 'center', backgroundColor: 'rgba(112,0,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(112,0,255,0.2)',
    borderRadius: 50, paddingHorizontal: 16, paddingVertical: 6, marginBottom: 14,
    maxWidth: '100%',
  },
  emailChipText: {
    color: '#A78BFA', fontSize: 13, fontWeight: '600',
  },
  modalBody: {
    color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20,
  },
  modalDivider: {
    height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 18,
  },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12,
  },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(112,0,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(112,0,255,0.3)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepNumText: { color: '#A78BFA', fontSize: 11, fontWeight: '800' },
  stepText: { color: '#94A3B8', fontSize: 13, flex: 1, lineHeight: 18 },
  resendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(112,0,255,0.2)',
    borderRadius: 10, paddingVertical: 11, marginBottom: 10,
    backgroundColor: 'rgba(112,0,255,0.06)',
  },
  resendBtnSent: {
    borderColor: 'rgba(16,185,129,0.25)',
    backgroundColor: 'rgba(16,185,129,0.06)',
  },
  resendText: { color: '#A78BFA', fontSize: 13, fontWeight: '600' },
  modalBtn: {
    backgroundColor: '#7000FF', borderRadius: 14,
    height: 52, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2,
  },
  modalBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
});
