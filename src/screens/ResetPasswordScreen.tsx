import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert, Image,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { Lock, Eye, EyeOff, ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react-native';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

type Stage = 'verifying' | 'invalid' | 'ready' | 'submitting' | 'success';

function parseUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const hashIdx = url.indexOf('#');
  const queryIdx = url.indexOf('?');
  let raw = '';
  if (hashIdx >= 0) raw = url.substring(hashIdx + 1);
  else if (queryIdx >= 0) raw = url.substring(queryIdx + 1);
  if (!raw) return params;
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return params;
}

export default function ResetPasswordScreen({ navigation }: Props) {
  const [stage, setStage] = useState<Stage>('verifying');
  const [errorMsg, setErrorMsg] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const handledRef = useRef(false);

  useEffect(() => {
    const handleUrl = async (urlStr: string | null) => {
      if (!urlStr || handledRef.current) return;
      handledRef.current = true;
      try {
        const params = parseUrlParams(urlStr);
        if (params.error || params.error_description) {
          setErrorMsg(params.error_description || params.error || 'Invalid or expired link.');
          setStage('invalid');
          return;
        }
        if (params.access_token && params.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (error) {
            setErrorMsg(error.message);
            setStage('invalid');
            return;
          }
          setStage('ready');
          return;
        }
        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (error) {
            setErrorMsg(error.message);
            setStage('invalid');
            return;
          }
          setStage('ready');
          return;
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setStage('ready');
        } else {
          setErrorMsg('This password reset link is invalid or has expired. Please request a new one.');
          setStage('invalid');
        }
      } catch (e: any) {
        setErrorMsg(e.message || 'Something went wrong opening this link.');
        setStage('invalid');
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => {
      handledRef.current = false;
      handleUrl(url);
    });
    return () => sub.remove();
  }, []);

  const handleSubmit = async () => {
    if (!password || !confirmPassword) {
      Alert.alert('Missing fields', 'Please enter and confirm your new password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Please make sure both passwords are identical.');
      return;
    }
    setStage('submitting');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        Alert.alert('Could not update password', error.message);
        setStage('ready');
        return;
      }
      await supabase.auth.signOut();
      setStage('success');
    } catch (e: any) {
      Alert.alert('Could not update password', e.message || 'Please try again.');
      setStage('ready');
    }
  };

  const goToLogin = () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] });

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

          {/* Logo */}
          <Animated.View entering={FadeInDown.delay(80).springify()} style={styles.logoBlock}>
            <View style={styles.logoIcon}>
              <Image source={require('../../assets/logo.png')} style={{ width: 60, height: 60, borderRadius: 14 }} resizeMode="contain" />
            </View>
            <Text style={styles.logoText}>AdRoom <Text style={{ color: '#00F0FF' }}>AI</Text></Text>
          </Animated.View>

          {stage === 'verifying' && (
            <View style={styles.centerBox}>
              <ActivityIndicator color="#00F0FF" size="large" />
              <Text style={styles.statusText}>Verifying your reset link…</Text>
            </View>
          )}

          {stage === 'invalid' && (
            <Animated.View entering={FadeInDown.delay(150).springify()} style={styles.card}>
              <View style={[styles.iconRing, { borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                <AlertCircle size={32} color="#EF4444" />
              </View>
              <Text style={styles.title}>Link no longer valid</Text>
              <Text style={styles.subtitle}>{errorMsg || 'This reset link has expired or already been used.'}</Text>
              <TouchableOpacity onPress={goToLogin} style={styles.primaryBtn} activeOpacity={0.85}>
                <ArrowLeft size={17} color="#0B0F19" />
                <Text style={styles.primaryBtnText}>Back to Sign In</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {(stage === 'ready' || stage === 'submitting') && (
            <Animated.View entering={FadeInDown.delay(150).springify()} style={styles.card}>
              <View style={styles.iconRing}>
                <ShieldCheck size={32} color="#00F0FF" />
              </View>
              <Text style={styles.title}>Choose a new password</Text>
              <Text style={styles.subtitle}>Pick something strong you'll remember. You'll use it next time you sign in.</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>New Password</Text>
                <View style={[styles.inputWrap, passFocused && styles.inputFocused]}>
                  <Lock size={18} color={passFocused ? '#00F0FF' : '#475569'} style={{ marginRight: 10 }} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="At least 6 characters"
                    placeholderTextColor="#475569"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPass}
                    onFocus={() => setPassFocused(true)}
                    onBlur={() => setPassFocused(false)}
                    editable={stage !== 'submitting'}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    {showPass ? <EyeOff size={18} color="#475569" /> : <Eye size={18} color="#475569" />}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={[styles.inputWrap, confirmFocused && styles.inputFocused]}>
                  <Lock size={18} color={confirmFocused ? '#00F0FF' : '#475569'} style={{ marginRight: 10 }} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Re-enter your password"
                    placeholderTextColor="#475569"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirm}
                    onFocus={() => setConfirmFocused(true)}
                    onBlur={() => setConfirmFocused(false)}
                    editable={stage !== 'submitting'}
                  />
                  <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    {showConfirm ? <EyeOff size={18} color="#475569" /> : <Eye size={18} color="#475569" />}
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                onPress={handleSubmit}
                disabled={stage === 'submitting'}
                style={[styles.primaryBtn, stage === 'submitting' && { opacity: 0.7 }]}
                activeOpacity={0.85}
              >
                {stage === 'submitting'
                  ? <ActivityIndicator color="#0B0F19" size="small" />
                  : <Text style={styles.primaryBtnText}>Update Password</Text>}
              </TouchableOpacity>

              <TouchableOpacity onPress={goToLogin} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {stage === 'success' && (
            <Animated.View entering={FadeInDown.delay(150).springify()} style={styles.card}>
              <View style={[styles.iconRing, { borderColor: 'rgba(16,185,129,0.35)', backgroundColor: 'rgba(16,185,129,0.08)' }]}>
                <ShieldCheck size={32} color="#10B981" />
              </View>
              <Text style={styles.title}>Password updated</Text>
              <Text style={styles.subtitle}>Your password has been changed. Sign in with your new password to continue.</Text>
              <TouchableOpacity onPress={goToLogin} style={styles.primaryBtn} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Sign In</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  logoBlock: { alignItems: 'center', marginBottom: 32 },
  logoIcon: {
    width: 84, height: 84, borderRadius: 24, backgroundColor: '#151B2B',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden',
  },
  logoText: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  centerBox: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  statusText: { color: '#94A3B8', fontSize: 14 },
  card: {
    backgroundColor: '#111827', borderRadius: 24, padding: 28,
    borderWidth: 1, borderColor: 'rgba(0,240,255,0.18)', alignItems: 'stretch',
  },
  iconRing: {
    width: 76, height: 76, borderRadius: 38, alignSelf: 'center',
    backgroundColor: 'rgba(0,240,255,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3, marginBottom: 8 },
  subtitle: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  fieldGroup: { marginBottom: 16 },
  label: { color: '#94A3B8', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0B0F19', borderWidth: 1.5, borderColor: '#1E293B',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
  },
  inputFocused: { borderColor: '#00F0FF', backgroundColor: 'rgba(0,240,255,0.04)' },
  input: { flex: 1, color: '#E2E8F0', fontSize: 15, fontWeight: '500' },
  primaryBtn: {
    backgroundColor: '#00F0FF', borderRadius: 14, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8,
  },
  primaryBtnText: { color: '#0B0F19', fontWeight: '800', fontSize: 15 },
  secondaryBtn: { marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E293B' },
  secondaryBtnText: { color: '#64748B', fontWeight: '600', fontSize: 14 },
});
