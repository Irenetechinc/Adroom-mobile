import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Alert, StyleSheet,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Shield, User, Lock, Trash2, ChevronRight, CheckCircle } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase } from '../services/supabase';
import { useProfileStore } from '../store/profileStore';
import Constants from 'expo-constants';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || '';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' } : null;
}

export default function PrivacySecurityScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState('');
  const [nameLoading, setNameLoading] = useState(false);

  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passLoading, setPassLoading] = useState(false);

  const [deletionReason, setDeletionReason] = useState('');
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [deletionPending, setDeletionPending] = useState(false);

  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: any) => {
      const user = data?.user;
      if (user?.user_metadata?.display_name) setDisplayName(user.user_metadata.display_name);
      else if (user?.user_metadata?.full_name) setDisplayName(user.user_metadata.full_name);
    });
  }, []);

  const NAME_CHANGE_KEY = 'LAST_NAME_CHANGE_TS';
  const NAME_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldownUI = (remainingMs: number) => {
    let secs = Math.ceil(remainingMs / 1000);
    setCooldownSecs(secs);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      secs -= 1;
      if (secs <= 0) {
        setCooldownSecs(0);
        clearInterval(cooldownTimerRef.current!);
        cooldownTimerRef.current = null;
      } else {
        setCooldownSecs(secs);
      }
    }, 1000);
  };

  useEffect(() => {
    AsyncStorage.getItem(NAME_CHANGE_KEY).then(ts => {
      if (!ts) return;
      const elapsed = Date.now() - parseInt(ts, 10);
      if (elapsed < NAME_COOLDOWN_MS) startCooldownUI(NAME_COOLDOWN_MS - elapsed);
    });
    return () => { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpdateName() {
    if (!displayName.trim() || displayName.trim().length < 2) {
      Alert.alert('Invalid Name', 'Display name must be at least 2 characters.');
      return;
    }
    if (cooldownSecs > 0) {
      const mins = Math.floor(cooldownSecs / 60);
      const secs = cooldownSecs % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      Alert.alert(
        'Username Cooldown',
        `You can change your username again in ${timeStr}.\n\nThis limit protects your account.`,
        [{ text: 'OK' }],
      );
      return;
    }
    setNameLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('Not authenticated');
      const res = await fetch(`${BACKEND_URL}/api/user/profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      const data = await res.json();
      if (res.status === 429) {
        const remaining = data.remaining_seconds || 180;
        startCooldownUI(remaining * 1000);
        Alert.alert('Username Cooldown', data.error || `Please wait before changing your username again.`);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to update');

      await AsyncStorage.setItem(NAME_CHANGE_KEY, String(Date.now()));
      startCooldownUI(NAME_COOLDOWN_MS);

      // 1) Optimistically push the new name into the shared profile store so
      //    the side menu, settings header, and chat avatar all flip
      //    immediately — no sign-out, no reload.
      useProfileStore.getState().setDisplayName(displayName.trim());

      // 2) Fire-and-forget: ask the local Supabase client to pull fresh
      //    user_metadata from the server. This emits USER_UPDATED which
      //    re-hydrates the profile store from the source of truth.
      //    We deliberately do NOT await this — refreshSession() can hang
      //    indefinitely on a flaky connection, which previously left the
      //    Save button spinning forever even though the name had already
      //    been persisted server-side and pushed into local state.
      supabase.auth.refreshSession().catch(() => { /* non-fatal */ });

      Alert.alert('Success', 'Your display name has been updated.');
      setActiveSection(null);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setNameLoading(false);
    }
  }

  async function handleChangePassword() {
    if (!newPass || newPass.length < 8) {
      Alert.alert('Too Short', 'Password must be at least 8 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }
    setPassLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('Not authenticated');
      const res = await fetch(`${BACKEND_URL}/api/user/change-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ new_password: newPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      Alert.alert('Password Changed', 'Your password has been updated. Please use the new password next time you log in.');
      setNewPass('');
      setCurrentPass('');
      setConfirmPass('');
      setActiveSection(null);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setPassLoading(false);
    }
  }

  async function handleRequestDeletion() {
    Alert.alert(
      'Request Account Deletion',
      'Your deletion request will be reviewed by our team within 30 days. During this time your account will remain active. Do you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit Request',
          style: 'destructive',
          onPress: async () => {
            setDeletionLoading(true);
            try {
              const headers = await authHeaders();
              if (!headers) throw new Error('Not authenticated');
              const res = await fetch(`${BACKEND_URL}/api/user/request-deletion`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ reason: deletionReason.trim() || null }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Failed to submit request');
              setDeletionPending(true);
              setActiveSection(null);
              Alert.alert(
                'Request Submitted',
                data.already_pending
                  ? 'You already have a pending deletion request. Our team is reviewing it.'
                  : 'Your account deletion request has been submitted. Our team will review it within 30 days and contact you at your registered email.',
              );
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setDeletionLoading(false);
            }
          },
        },
      ],
    );
  }

  const sections = [
    {
      id: 'name',
      icon: User,
      color: '#00F0FF',
      label: 'Update Display Name',
      sublabel: 'Change how your name appears in the app',
    },
    {
      id: 'password',
      icon: Lock,
      color: '#7000FF',
      label: 'Change Password',
      sublabel: 'Update your account password',
    },
    {
      id: 'deletion',
      icon: Trash2,
      color: '#EF4444',
      label: 'Request Account Deletion',
      sublabel: deletionPending ? 'Deletion request pending review' : 'Submit a data deletion request',
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>Settings</Text>
          <Text style={styles.headerTitle}>Privacy & Security</Text>
        </View>
        <View style={styles.headerIcon}>
          <Shield size={18} color="#10B981" />
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 20) }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info card */}
          <Animated.View entering={FadeInDown.delay(80).springify()} style={styles.infoCard}>
            <Shield size={18} color="#10B981" style={{ marginRight: 10 }} />
            <Text style={styles.infoText}>
              Your data is stored securely. You can update your account info, change your password, or request full account deletion at any time.
            </Text>
          </Animated.View>

          {/* Settings sections */}
          {sections.map((sec, i) => {
            const Icon = sec.icon;
            const isOpen = activeSection === sec.id;
            return (
              <Animated.View key={sec.id} entering={FadeInDown.delay(150 + i * 80).springify()} style={styles.sectionCard}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => setActiveSection(isOpen ? null : sec.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.sectionIcon, { backgroundColor: `${sec.color}12` }]}>
                    <Icon size={18} color={sec.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionLabel}>{sec.label}</Text>
                    <Text style={styles.sectionSublabel}>{sec.sublabel}</Text>
                  </View>
                  {sec.id === 'deletion' && deletionPending ? (
                    <CheckCircle size={16} color="#F59E0B" />
                  ) : (
                    <ChevronRight size={16} color={isOpen ? '#00F0FF' : '#334155'} style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }} />
                  )}
                </TouchableOpacity>

                {isOpen && sec.id === 'name' && (
                  <View style={styles.sectionBody}>
                    <Text style={styles.fieldLabel}>Display Name</Text>
                    <TextInput
                      style={styles.input}
                      value={displayName}
                      onChangeText={setDisplayName}
                      placeholder="Enter your display name"
                      placeholderTextColor="#475569"
                      maxLength={50}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: cooldownSecs > 0 ? 'rgba(100,116,139,0.1)' : 'rgba(0,240,255,0.1)', borderColor: cooldownSecs > 0 ? '#334155' : 'rgba(0,240,255,0.3)' }]}
                      onPress={handleUpdateName}
                      disabled={nameLoading || cooldownSecs > 0}
                      activeOpacity={0.8}
                    >
                      {nameLoading ? (
                        <ActivityIndicator size="small" color="#00F0FF" />
                      ) : cooldownSecs > 0 ? (
                        <Text style={[styles.actionBtnText, { color: '#64748B' }]}>
                          Wait {Math.floor(cooldownSecs / 60) > 0 ? `${Math.floor(cooldownSecs / 60)}m ` : ''}{cooldownSecs % 60}s
                        </Text>
                      ) : (
                        <Text style={[styles.actionBtnText, { color: '#00F0FF' }]}>Save Name</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {isOpen && sec.id === 'password' && (
                  <View style={styles.sectionBody}>
                    <Text style={styles.fieldLabel}>New Password</Text>
                    <TextInput
                      style={styles.input}
                      value={newPass}
                      onChangeText={setNewPass}
                      placeholder="At least 8 characters"
                      placeholderTextColor="#475569"
                      secureTextEntry
                      autoFocus
                    />
                    <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Confirm New Password</Text>
                    <TextInput
                      style={styles.input}
                      value={confirmPass}
                      onChangeText={setConfirmPass}
                      placeholder="Re-enter new password"
                      placeholderTextColor="#475569"
                      secureTextEntry
                    />
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: 'rgba(112,0,255,0.1)', borderColor: 'rgba(112,0,255,0.3)' }]}
                      onPress={handleChangePassword}
                      disabled={passLoading}
                      activeOpacity={0.8}
                    >
                      {passLoading ? (
                        <ActivityIndicator size="small" color="#7000FF" />
                      ) : (
                        <Text style={[styles.actionBtnText, { color: '#7000FF' }]}>Update Password</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {isOpen && sec.id === 'deletion' && (
                  <View style={styles.sectionBody}>
                    {deletionPending ? (
                      <View style={styles.pendingBox}>
                        <CheckCircle size={20} color="#F59E0B" />
                        <Text style={styles.pendingText}>
                          Your deletion request is under review. Our team will process it within 30 days and contact you via email.
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={styles.deletionWarning}>
                          This will submit a request to permanently delete your account and all associated data. This action cannot be undone once approved.
                        </Text>
                        <Text style={styles.fieldLabel}>Reason (optional)</Text>
                        <TextInput
                          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                          value={deletionReason}
                          onChangeText={setDeletionReason}
                          placeholder="Tell us why you're leaving…"
                          placeholderTextColor="#475569"
                          multiline
                          maxLength={500}
                        />
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }]}
                          onPress={handleRequestDeletion}
                          disabled={deletionLoading}
                          activeOpacity={0.8}
                        >
                          {deletionLoading ? (
                            <ActivityIndicator size="small" color="#EF4444" />
                          ) : (
                            <Text style={[styles.actionBtnText, { color: '#EF4444' }]}>Submit Deletion Request</Text>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </Animated.View>
            );
          })}

          {/* Data info */}
          <Animated.View entering={FadeInDown.delay(500).springify()} style={styles.dataInfoCard}>
            <Text style={styles.dataInfoTitle}>Your Data Rights</Text>
            <Text style={styles.dataInfoText}>
              Under GDPR and applicable privacy laws, you have the right to access, correct, or delete your personal data. Account deletion requests are processed within 30 days.
              {'\n\n'}For urgent data requests, contact support at support@adroomai.com.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)',
  },
  backBtn: { marginRight: 14, padding: 2 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { padding: 16 },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: 'rgba(16,185,129,0.06)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)',
    padding: 14, marginBottom: 20,
  },
  infoText: { color: '#94A3B8', fontSize: 13, flex: 1, lineHeight: 20 },
  sectionCard: {
    backgroundColor: '#151B2B', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B', marginBottom: 12, overflow: 'hidden',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  sectionIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  sectionLabel: { color: '#E2E8F0', fontWeight: '600', fontSize: 14, marginBottom: 2 },
  sectionSublabel: { color: '#475569', fontSize: 12 },
  sectionBody: {
    paddingHorizontal: 14, paddingBottom: 16,
    borderTopWidth: 1, borderTopColor: '#1E293B',
    paddingTop: 14,
  },
  fieldLabel: { color: '#64748B', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: '#0B0F19', borderWidth: 1, borderColor: '#1E293B',
    borderRadius: 10, padding: 12, color: '#E2E8F0', fontSize: 14,
    marginBottom: 4,
  },
  actionBtn: {
    marginTop: 14, borderRadius: 10, borderWidth: 1,
    paddingVertical: 12, alignItems: 'center',
  },
  actionBtnText: { fontWeight: '700', fontSize: 14 },
  deletionWarning: {
    color: '#94A3B8', fontSize: 12, lineHeight: 18,
    backgroundColor: 'rgba(239,68,68,0.06)', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.15)', marginBottom: 14,
  },
  pendingBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(245,158,11,0.06)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)', padding: 12,
  },
  pendingText: { color: '#F59E0B', fontSize: 13, flex: 1, lineHeight: 19 },
  dataInfoCard: {
    backgroundColor: '#0D1220', borderRadius: 14, borderWidth: 1, borderColor: '#1E293B',
    padding: 16, marginTop: 8,
  },
  dataInfoTitle: { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  dataInfoText: { color: '#475569', fontSize: 12, lineHeight: 19 },
});
