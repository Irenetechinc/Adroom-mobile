import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from '../types';
import DashboardScreen from '../screens/DashboardScreen';
import CampaignListScreen from '../screens/CampaignListScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AgentChatScreen from '../screens/AgentChatScreen';
import { Text, View } from 'react-native';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Simple futuristic icon component placeholder
const TabIcon = ({ name, focused, color }: { name: string; focused: boolean; color: string }) => (
  <View className={`items-center justify-center ${focused ? 'bg-adroom-neon/20 rounded-full p-2' : ''}`}>
    <Text style={{ color, fontSize: 20, fontWeight: focused ? 'bold' : 'normal' }}>
      {name}
    </Text>
  </View>
);

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0B0F19',
          borderTopColor: '#1E293B',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#00F0FF',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarIcon: ({ focused, color, size }) => {
          let iconSymbol = '•'; 
          
          if (route.name === 'AgentChat') iconSymbol = '◈'; // Agent
          if (route.name === 'Dashboard') iconSymbol = '⊞'; // Dash
          if (route.name === 'CampaignList') iconSymbol = '≣'; // List
          if (route.name === 'Settings') iconSymbol = '⚙'; // Settings

          return <TabIcon name={iconSymbol} focused={focused} color={color} />;
        },
      })}
    >
      <Tab.Screen 
        name="AgentChat" 
        component={AgentChatScreen} 
        options={{ title: 'Agent' }}
      />
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen 
        name="CampaignList" 
        component={CampaignListScreen} 
        options={{ title: 'Campaigns' }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
