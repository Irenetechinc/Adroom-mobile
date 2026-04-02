import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { RootStackParamList } from '../types';
import { supabase } from '../services/supabase';
import { Mail, Lock, Eye, EyeOff, Zap } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <View style={styles.inner}>
          {/* Logo */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.logoBlock}>
            <View style={styles.logoIcon}>
              <Zap size={28} color="#00F0FF" />
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
                  {showPassword
                    ? <EyeOff size={18} color="#475569" />
                    : <Eye size={18} color="#475569" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Forgot */}
            <TouchableOpacity style={styles.forgotWrap} activeOpacity={0.7}>
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  kav: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  logoBlock: { alignItems: 'center', marginBottom: 40 },
  logoIcon: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: 'rgba(0,240,255,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  logoText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  logoSub: { color: '#64748B', fontSize: 14, marginTop: 6, fontWeight: '500' },
  form: { gap: 0 },
  fieldGroup: { marginBottom: 16 },
  label: { color: '#94A3B8', fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#151B2B',
    borderWidth: 1.5, borderColor: '#1E293B',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
  },
  inputFocused: { borderColor: '#00F0FF', backgroundColor: 'rgba(0,240,255,0.04)' },
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
});
