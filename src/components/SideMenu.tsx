import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import {
  Bot, LayoutDashboard, Settings, LogOut, X, History,
  ChevronRight, Users, MessageSquare, Zap,
} from 'lucide-react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

const menuItems = [
  { label: 'Agent', icon: Bot, route: 'AgentChat', description: 'AI Campaign Assistant' },
  { label: 'Dashboard', icon: LayoutDashboard, route: 'Dashboard', description: 'Performance Overview' },
  { label: 'Strategy History', icon: History, route: 'StrategyHistory', description: 'Past Strategies' },
  { label: 'Interactions', icon: MessageSquare, route: 'Interactions', description: 'Real-time Comments & Messages' },
  { label: 'Community', icon: Users, route: 'Community', description: 'AdRoom Global Network' },
  { label: 'Settings', icon: Settings, route: 'Settings', description: 'App Preferences' },
];

export default function SideMenu(props: DrawerContentComponentProps) {
  const { signOut, user } = useAuthStore();
  const navigation = useNavigation<any>();

  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'U';
  const userEmail = user?.email || '';

  return (
    <View style={{ flex: 1, backgroundColor: '#050B14' }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(0,240,255,0.08)', marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(0,240,255,0.12)',
                borderWidth: 1.5, borderColor: '#00F0FF',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#00F0FF', fontWeight: '800', fontSize: 16 }}>{userInitial}</Text>
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                  {userEmail.split('@')[0]}
                </Text>
                <Text style={{ color: '#64748B', fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                  {userEmail}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => props.navigation.closeDrawer()} style={{ padding: 4 }}>
              <X color="#64748B" size={20} />
            </TouchableOpacity>
          </View>

          {/* Brand */}
          <View style={{
            backgroundColor: 'rgba(0,240,255,0.06)',
            borderWidth: 1, borderColor: 'rgba(0,240,255,0.15)',
            borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
          }}>
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 1 }}>
              AdRoom <Text style={{ color: '#00F0FF' }}>AI</Text>
            </Text>
            <Text style={{ color: '#64748B', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>
              Autonomous Marketing
            </Text>
          </View>
        </View>

        {/* Nav Items */}
        <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 4 }}>
          {menuItems.map((item, index) => {
            const activeRoute = props.state.routes[props.state.index]?.name;
            const isFocused = activeRoute === item.route;
            const Icon = item.icon;

            return (
              <Animated.View key={item.route} entering={FadeInLeft.delay(index * 60).springify()}>
                <TouchableOpacity
                  onPress={() => props.navigation.navigate(item.route)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 14, paddingVertical: 13,
                    borderRadius: 14, marginBottom: 4,
                    backgroundColor: isFocused ? 'rgba(0,240,255,0.08)' : 'transparent',
                    borderWidth: isFocused ? 1 : 0,
                    borderColor: isFocused ? 'rgba(0,240,255,0.25)' : 'transparent',
                    borderLeftWidth: isFocused ? 3 : 0,
                    borderLeftColor: isFocused ? '#00F0FF' : 'transparent',
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: isFocused ? 'rgba(0,240,255,0.12)' : 'rgba(148,163,184,0.06)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon color={isFocused ? '#00F0FF' : '#64748B'} size={18} strokeWidth={isFocused ? 2.5 : 2} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: isFocused ? '#FFFFFF' : '#94A3B8', fontWeight: isFocused ? '700' : '500', fontSize: 15 }}>
                      {item.label}
                    </Text>
                    <Text style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>
                      {item.description}
                    </Text>
                  </View>
                  {isFocused && <ChevronRight color="#00F0FF" size={14} />}
                </TouchableOpacity>
              </Animated.View>
            );
          })}

          {/* Energy — navigates to Subscription screen */}
          <Animated.View entering={FadeInLeft.delay(menuItems.length * 60).springify()}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Subscription')}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 14, paddingVertical: 13,
                borderRadius: 14, marginBottom: 4,
                backgroundColor: 'rgba(245,158,11,0.07)',
                borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)',
              }}
              activeOpacity={0.7}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: 'rgba(245,158,11,0.12)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Zap color="#F59E0B" size={18} strokeWidth={2} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 15 }}>
                  Energy
                </Text>
                <Text style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>
                  Credits & Subscription
                </Text>
              </View>
              <ChevronRight color="#F59E0B" size={14} />
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Footer */}
        <View style={{ paddingHorizontal: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: 'rgba(0,240,255,0.06)', paddingTop: 12 }}>
          <TouchableOpacity
            onPress={signOut}
            style={{
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14,
              backgroundColor: 'rgba(239,68,68,0.07)',
              borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
            }}
            activeOpacity={0.7}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: 'rgba(239,68,68,0.1)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <LogOut color="#EF4444" size={18} />
            </View>
            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 15, marginLeft: 12 }}>Sign Out</Text>
          </TouchableOpacity>
          <Text style={{ color: '#1E293B', fontSize: 10, textAlign: 'center', marginTop: 14, letterSpacing: 0.5 }}>
            AdRoom AI • v2.2.1
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
