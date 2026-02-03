import React from 'react';
import { View, Text, TouchableOpacity, Image, SafeAreaView } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { Home, LayoutDashboard, List, Settings, LogOut, X, History } from 'lucide-react-native';
import { useAuthStore } from '../store/authStore';

export default function SideMenu(props: DrawerContentComponentProps) {
  const navigation = useNavigation();
  const { signOut, user } = useAuthStore();

  const menuItems = [
    { label: 'Agent Center', icon: Home, route: 'AgentChat' },
    { label: 'Live Dashboard', icon: LayoutDashboard, route: 'Dashboard' },
    { label: 'Campaigns', icon: List, route: 'CampaignList' },
    { label: 'Strategy History', icon: History, route: 'StrategyHistory' },
    { label: 'System Settings', icon: Settings, route: 'Settings' },
  ];

  return (
    <View className="flex-1 bg-[#050B14]">
      <SafeAreaView className="flex-1">
        {/* Header Profile Section */}
        <View className="px-6 py-8 border-b border-adroom-neon/10 mb-6">
          <View className="flex-row items-center justify-between mb-6">
            <View className="w-10 h-10 rounded-full bg-adroom-neon/10 items-center justify-center border border-adroom-neon">
              <Text className="text-adroom-neon font-bold text-lg">AI</Text>
            </View>
            <TouchableOpacity onPress={() => props.navigation.closeDrawer()}>
                <X color="#64748B" size={24} />
            </TouchableOpacity>
          </View>
          
          <Text className="text-white text-xl font-bold tracking-wider mb-1">
            AdRoom <Text className="text-adroom-neon">OS</Text>
          </Text>
          <Text className="text-adroom-text-muted text-xs uppercase tracking-widest">
            Autonomous Marketing
          </Text>
        </View>

        {/* Menu Items */}
        <View className="flex-1 px-4 space-y-2">
          {menuItems.map((item, index) => {
            const isFocused = props.state.index === index;
            const Icon = item.icon;
            
            return (
              <TouchableOpacity
                key={item.route}
                onPress={() => props.navigation.navigate(item.route)}
                className={`flex-row items-center p-4 rounded-xl mb-2 ${
                  isFocused 
                    ? 'bg-adroom-neon/10 border-l-4 border-adroom-neon' 
                    : 'opacity-70'
                }`}
              >
                <Icon 
                  color={isFocused ? '#00F0FF' : '#94A3B8'} 
                  size={22} 
                  strokeWidth={isFocused ? 2.5 : 2}
                />
                <Text className={`ml-4 text-base ${
                  isFocused 
                    ? 'text-white font-bold tracking-wide' 
                    : 'text-adroom-text-muted font-medium'
                }`}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Footer */}
        <View className="p-6 border-t border-adroom-neon/10">
            <TouchableOpacity 
                onPress={signOut}
                className="flex-row items-center p-4 rounded-xl bg-red-500/10 border border-red-500/20"
            >
                <LogOut color="#EF4444" size={20} />
                <Text className="text-red-400 font-bold ml-3 uppercase text-xs tracking-wider">Disconnect</Text>
            </TouchableOpacity>
            <Text className="text-adroom-text-muted/30 text-[10px] text-center mt-6">
                v1.0.0 • Production Build
            </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
