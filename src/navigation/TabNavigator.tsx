import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from '../types';
import DashboardScreen from '../screens/DashboardScreen';
import CampaignListScreen from '../screens/CampaignListScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { Text } from 'react-native';

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#1E40AF',
        tabBarInactiveTintColor: 'gray',
        tabBarIcon: ({ focused, color, size }) => {
          let iconName = '•'; 
          
          if (route.name === 'Dashboard') iconName = 'D';
          if (route.name === 'CampaignList') iconName = 'C';
          if (route.name === 'Settings') iconName = 'S';

          return <Text style={{ color, fontSize: 18, fontWeight: focused ? 'bold' : 'normal' }}>{iconName}</Text>;
        },
      })}
    >
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
