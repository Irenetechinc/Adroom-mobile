import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet, ScrollView } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { DrawerActions } from '@react-navigation/native';
import {
  Menu, Link, LogOut, User, Shield, ChevronRight,
  Bell, HelpCircle, Info, Settings as SettingsIcon, Zap,
} from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useEnergyStore, PLAN_DETAILS } from '../store/energyStore';
import { Skeleton } from '../components/Skeleton';

function SettingsSkeleton({ insets }: { insets: { bottom: number } }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: Math.max(40, insets.bottom + 20) }} scrollEnabled={false}>
      {/* Profile card */}
      <View style={{ backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <Skeleton width={52} height={52} borderRadius={16} />
        <View style={{ flex: 1, gap: 7 }}>
          <Skeleton width="50%" height={14} borderRadius={4} />
          <Skeleton width="75%" height={12} borderRadius={4} />
        </View>
      </View>
      {/* Two groups */}
      {[3, 2].map((count, gi) => (
        <View key={gi} style={{ marginBottom: 24 }}>
          <Skeleton width={80} height={12} borderRadius={4} style={{ marginBottom: 10, marginLeft: 4 }} />
          <View style={{ backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden' }}>
            {[...Array(count)].map((_, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: i < count - 1 ? 1 : 0, borderBottomColor: '#1E293B' }}>
                <Skeleton width={36} height={36} borderRadius={10} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width="45%" height={13} borderRadius={4} />
                  <Skeleton width="65%" height={11} borderRadius={4} />
                </View>
                <Skeleton width={16} height={16} borderRadius={4} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

export default function SettingsScreen() {
  const { signOut, user } = useAuthStore();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [signingOut, setSigningOut] = useState(false);
  const insets = useSafeAreaInsets();
  const { account, subscription, fetchEnergy, isLoading: energyLoading } = useEnergyStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchEnergy().finally(() => setReady(true));
  }, []);

  const balance = parseFloat(String(account?.balance_credits ?? '0'));
  const plan = subscription?.plan ?? 'none';
  const planInfo = PLAN_DETAILS[plan as keyof typeof PLAN_DETAILS];
  const balanceColor = balance > 20 ? '#00F0FF' : balance > 5 ? '#F59E0B' : '#EF4444';

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } catch {
            Alert.alert('Error', 'Failed to sign out. Please try again.');
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'U';

  const settingsGroups = [
    {
      title: 'Account',
      items: [
        {
          icon: Zap,
          label: 'AdRoom Energy',
          sublabel: `${balance.toFixed(1)} credits • ${planInfo?.name ?? 'No plan'}`,
          color: balanceColor,
          onPress: () => navigation.navigate('Subscription'),
        },
        {
          icon: Link,
          label: 'Connected Accounts',
          sublabel: 'Manage Facebook & other platforms',
          color: '#00F0FF',
          onPress: () => navigation.navigate('ConnectedAccounts'),
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: Bell,
          label: 'Notifications',
          sublabel: 'Campaign alerts & updates',
          color: '#F59E0B',
          onPress: () => navigation.navigate('Notifications'),
        },
        {
          icon: Shield,
          label: 'Privacy & Security',
          sublabel: 'Data and privacy settings',
          color: '#10B981',
          onPress: () => navigation.navigate('PrivacySecurity'),
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          icon: HelpCircle,
          label: 'Help Center',
          sublabel: 'Community, guides & documentation',
          color: '#7000FF',
          onPress: () => (navigation as any).navigate('Main', { screen: 'Community' }),
        },
        {
          icon: Info,
          label: 'About AdRoom AI',
          sublabel: 'Version 1.0.0',
          color: '#94A3B8',
          onPress: () => navigation.navigate('About'),
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={styles.menuBtn}>
          <Menu color="#E2E8F0" size={22} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerLabel}>AdRoom AI</Text>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <View style={styles.headerIcon}>
          <SettingsIcon size={18} color="#64748B" />
        </View>
      </View>

      {!ready && <SettingsSkeleton insets={insets} />}

      <ScrollView style={[{ flex: 1 }, !ready && { display: 'none' }]} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(40, insets.bottom + 20) }]}>
        {/* Profile Card */}
        <Animated.View entering={FadeInDown.delay(100).springify()} style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{userInitial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.email?.split('@')[0] || 'User'}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{user?.email}</Text>
          </View>
          <View style={styles.profileBadge}>
            <User size={14} color="#00F0FF" />
          </View>
        </Animated.View>

        {/* Settings Groups */}
        {settingsGroups.map((group, gi) => (
          <Animated.View key={gi} entering={FadeInDown.delay(150 + gi * 80).springify()} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.groupCard}>
              {group.items.map((item, ii) => {
                const Icon = item.icon;
                return (
                  <TouchableOpacity
                    key={ii}
                    onPress={item.onPress}
                    style={[styles.groupItem, ii < group.items.length - 1 && styles.groupItemBorder]}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.groupItemIcon, { backgroundColor: `${item.color}12` }]}>
                      <Icon size={18} color={item.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupItemLabel}>{item.label}</Text>
                      <Text style={styles.groupItemSublabel}>{item.sublabel}</Text>
                    </View>
                    <ChevronRight size={16} color="#334155" />
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        ))}

        {/* Sign Out */}
        <Animated.View entering={FadeInDown.delay(460).springify()} style={styles.signOutWrap}>
          <TouchableOpacity
            onPress={handleSignOut}
            disabled={signingOut}
            style={[styles.signOutBtn, signingOut && { opacity: 0.6 }]}
            activeOpacity={0.8}
          >
            <LogOut size={18} color="#EF4444" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.versionText}>AdRoom AI • v3.2.0</Text>
      </ScrollView>
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
  menuBtn: { marginRight: 14, padding: 2 },
  headerLabel: { color: '#64748B', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 1 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#151B2B', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { padding: 16, paddingBottom: 40 },
  profileCard: {
    backgroundColor: '#151B2B', borderRadius: 18, borderWidth: 1, borderColor: '#1E293B',
    flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 24,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(0,240,255,0.1)', borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  avatarText: { color: '#00F0FF', fontWeight: '800', fontSize: 20 },
  profileName: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, marginBottom: 3, textTransform: 'capitalize' },
  profileEmail: { color: '#64748B', fontSize: 12 },
  profileBadge: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(0,240,255,0.08)', alignItems: 'center', justifyContent: 'center',
  },
  group: { marginBottom: 20 },
  groupTitle: { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  groupCard: {
    backgroundColor: '#151B2B', borderRadius: 16, borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  groupItem: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  groupItemBorder: { borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  groupItemIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  groupItemLabel: { color: '#E2E8F0', fontWeight: '600', fontSize: 14, marginBottom: 2 },
  groupItemSublabel: { color: '#475569', fontSize: 12 },
  signOutWrap: { marginBottom: 16 },
  signOutBtn: {
    backgroundColor: 'rgba(239,68,68,0.07)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, gap: 10,
  },
  signOutText: { color: '#EF4444', fontWeight: '700', fontSize: 15 },
  versionText: { color: '#1E293B', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
