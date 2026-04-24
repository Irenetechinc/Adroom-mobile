import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert, Modal, Image,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { Mail, Lock, Eye, EyeOff, KeyRound, CheckCircle, ArrowLeft, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<'input' | 'sent'>('input');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotEmailFocused, setForgotEmailFocused] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) Alert.alert('Sign In Failed', error.message);
  };

  const openForgotModal = () => {
    setForgotEmail(email.trim());
    setForgotStep('input');
    setResendSent(false);
    setResendCooldown(0);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setShowForgotModal(true);
  };

  const startCooldown = () => {
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
  };

  const handleSendReset = async () => {
    const trimmed = forgotEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: 'adroom://reset-password',
      });
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      setForgotStep('sent');
      setResendSent(false);
      startCooldown();
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResendReset = async () => {
    if (resendLoading || resendCooldown > 0) return;
    setResendLoading(true);
    setResendSent(false);
    try {
      await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: 'adroom://reset-password',
      });
      setResendSent(true);
      startCooldown();
    } catch {
      // fail silently
    } finally {
      setResendLoading(false);
    }
  };

  const closeForgotModal = () => {
    setShowForgotModal(false);
    setForgotStep('input');
    setResendSent(false);
    setResendCooldown(0);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kav}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

          {/* Logo */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.logoBlock}>
            <View style={styles.logoIcon}>
              <Image
                source={require('../../assets/icon.png')}
                style={{ width: 44, height: 44, borderRadius: 13 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.logoText}>AdRoom <Text style={{ color: '#00F0FF' }}>AI</Text></Text>
            <Text style={styles.logoSub}>Sign in to your account</Text>
          </Animated.View>

          {/* Form */}
          <Animated.View entering={FadeInDown.delay(250).springify()} style={styles.form}>
            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={[styles.inputWrap, emailFocused && styles.inputFocused]}>
                <Mail size={18} color={emailFocused ? '#00F0FF' : '#475569'} style={{ marginRight: 10 }} />
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
              <View style={[styles.inputWrap, passwordFocused && styles.inputFocused]}>
                <Lock size={18} color={passwordFocused ? '#00F0FF' : '#475569'} style={{ marginRight: 10 }} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="••••••••"
                  placeholderTextColor="#475569"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  {showPassword ? <EyeOff size={18} color="#475569" /> : <Eye size={18} color="#475569" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Forgot */}
            <TouchableOpacity style={styles.forgotWrap} onPress={openForgotModal} activeOpacity={0.7}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            {/* Submit */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              style={[styles.btn, loading && { opacity: 0.7 }]}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#0B0F19" />
                : <Text style={styles.btnText}>Sign In</Text>}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>Don't have an account?</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Sign up */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Signup')}
              style={styles.outlineBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.outlineBtnText}>Create Account</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Forgot Password Modal ── */}
      <Modal visible={showForgotModal} transparent animationType="fade" onRequestClose={closeForgotModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>

              {/* Close */}
              <TouchableOpacity onPress={closeForgotModal} style={styles.closeBtn}>
                <X size={18} color="#475569" />
              </TouchableOpacity>

              {forgotStep === 'input' ? (
                <>
                  {/* Icon */}
                  <View style={styles.modalIconWrap}>
                    <View style={styles.modalIconRing}>
                      <KeyRound size={28} color="#00F0FF" />
                    </View>
                  </View>

                  <Text style={styles.modalTitle}>Reset your password</Text>
                  <Text style={styles.modalSubtitle}>
                    Enter the email you signed up with and we'll send you a secure reset link right away.
                  </Text>

                  {/* Email Input */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.inputLabel}>Email Address</Text>
                    <View style={[styles.inputWrap, forgotEmailFocused && styles.inputFocusedCyan]}>
                      <Mail size={17} color={forgotEmailFocused ? '#00F0FF' : '#475569'} style={{ marginRight: 10 }} />
                      <TextInput
                        style={styles.input}
                        placeholder="your@email.com"
                        placeholderTextColor="#475569"
                        value={forgotEmail}
                        onChangeText={setForgotEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoFocus
                        onFocus={() => setForgotEmailFocused(true)}
                        onBlur={() => setForgotEmailFocused(false)}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={handleSendReset}
                    disabled={forgotLoading}
                    style={[styles.modalPrimaryBtn, forgotLoading && { opacity: 0.7 }]}
                    activeOpacity={0.85}
                  >
                    {forgotLoading
                      ? <ActivityIndicator color="#0B0F19" size="small" />
                      : <Text style={styles.modalPrimaryBtnText}>Send Reset Link</Text>
                    }
                  </TouchableOpacity>

                  <TouchableOpacity onPress={closeForgotModal} style={styles.modalSecondaryBtn}>
                    <Text style={styles.modalSecondaryBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Success icon */}
                  <View style={styles.modalIconWrap}>
                    <View style={[styles.modalIconRing, { borderColor: 'rgba(16,185,129,0.35)', backgroundColor: 'rgba(16,185,129,0.08)' }]}>
                      <Mail size={28} color="#10B981" />
                    </View>
                  </View>

                  <Text style={styles.modalTitle}>Check your inbox</Text>
                  <Text style={styles.modalSubtitle}>We sent a password reset link to</Text>

                  <View style={styles.emailChip}>
                    <Text style={styles.emailChipText} numberOfLines={1}>{forgotEmail}</Text>
                  </View>

                  <Text style={styles.modalBody}>
                    Open the link in the email to create a new password. It expires in 1 hour, so check soon.
                  </Text>

                  {/* Steps */}
                  <View style={styles.modalDivider} />
                  {[
                    'Open the email from AdRoom AI',
                    'Tap "Reset My Password"',
                    'Choose a new password and sign in',
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
                    onPress={handleResendReset}
                    disabled={resendLoading || resendCooldown > 0}
                    style={[
                      styles.resendBtn,
                      resendSent && styles.resendBtnSent,
                      resendCooldown > 0 && !resendSent && { opacity: 0.5 },
                    ]}
                    activeOpacity={0.75}
                  >
                    {resendLoading ? (
                      <ActivityIndicator size="small" color="#67E8F9" />
                    ) : resendSent ? (
                      <>
                        <CheckCircle size={14} color="#10B981" />
                        <Text style={[styles.resendText, { color: '#10B981' }]}>
                          Sent!{resendCooldown > 0 ? `  Resend in ${resendCooldown}s` : ''}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.resendText}>
                        Didn't get it?{resendCooldown > 0 ? `  Resend in ${resendCooldown}s` : '  Resend Link'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  {/* Back to sign in */}
                  <TouchableOpacity onPress={closeForgotModal} style={styles.modalPrimaryBtn} activeOpacity={0.85}>
                    <ArrowLeft size={17} color="#0B0F19" />
                    <Text style={styles.modalPrimaryBtnText}>Back to Sign In</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  kav: { flex: 1 },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  logoBlock: { alignItems: 'center', marginBottom: 40 },
  logoIcon: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: '#151B2B',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    overflow: 'hidden',
  },
  logoText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  logoSub: { color: '#64748B', fontSize: 14, marginTop: 6, fontWeight: '500' },
  form: { gap: 0 },
  fieldGroup: { marginBottom: 16 },
  label: { color: '#94A3B8', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#151B2B', borderWidth: 1.5, borderColor: '#1E293B',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
  },
  inputFocused: { borderColor: '#00F0FF', backgroundColor: 'rgba(0,240,255,0.04)' },
  inputFocusedCyan: { borderColor: '#00F0FF', backgroundColor: 'rgba(0,240,255,0.04)' },
  input: { flex: 1, color: '#E2E8F0', fontSize: 15, fontWeight: '500' },
  forgotWrap: { alignItems: 'flex-end', marginBottom: 24, marginTop: -4 },
  forgotText: { color: '#00F0FF', fontSize: 13, fontWeight: '600' },
  btn: {
    backgroundColor: '#00F0FF', borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  btnText: { color: '#0B0F19', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1E293B' },
  dividerText: { color: '#475569', fontSize: 12, fontWeight: '500' },
  outlineBtn: {
    borderWidth: 1.5, borderColor: '#1E293B', borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center',
  },
  outlineBtnText: { color: '#94A3B8', fontWeight: '700', fontSize: 15 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center', alignItems: 'center', padding: 22,
  },
  modalCard: {
    backgroundColor: '#111827', borderRadius: 26,
    padding: 28, width: '100%',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
  },
  closeBtn: {
    position: 'absolute', top: 16, right: 16, padding: 6,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8,
  },
  modalIconWrap: { alignItems: 'center', marginBottom: 18, marginTop: 4 },
  modalIconRing: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: {
    color: '#FFFFFF', fontSize: 22, fontWeight: '800',
    textAlign: 'center', letterSpacing: -0.3, marginBottom: 8,
  },
  modalSubtitle: {
    color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20,
  },
  inputLabel: {
    color: '#94A3B8', fontSize: 11, fontWeight: '600',
    letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase',
  },
  modalPrimaryBtn: {
    backgroundColor: '#00F0FF', borderRadius: 14,
    height: 52, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
  },
  modalPrimaryBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 15 },
  modalSecondaryBtn: {
    marginTop: 10, paddingVertical: 13, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#1E293B',
  },
  modalSecondaryBtnText: { color: '#64748B', fontWeight: '600', fontSize: 14 },
  emailChip: {
    alignSelf: 'center', backgroundColor: 'rgba(0,240,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.2)',
    borderRadius: 50, paddingHorizontal: 16, paddingVertical: 6,
    marginBottom: 14, maxWidth: '100%',
  },
  emailChipText: { color: '#67E8F9', fontSize: 13, fontWeight: '600' },
  modalBody: { color: '#475569', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  modalDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 18 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepNumText: { color: '#67E8F9', fontSize: 11, fontWeight: '800' },
  stepText: { color: '#94A3B8', fontSize: 13, flex: 1, lineHeight: 18 },
  resendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)',
    borderRadius: 10, paddingVertical: 11, marginBottom: 10, marginTop: 4,
    backgroundColor: 'rgba(0,240,255,0.05)',
  },
  resendBtnSent: {
    borderColor: 'rgba(16,185,129,0.25)',
    backgroundColor: 'rgba(16,185,129,0.06)',
  },
  resendText: { color: '#67E8F9', fontSize: 13, fontWeight: '600' },
});
