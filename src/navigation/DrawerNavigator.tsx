import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { MainTabParamList } from '../types';
import DashboardScreen from '../screens/DashboardScreen';
import CampaignListScreen from '../screens/CampaignListScreen';
import StrategyHistoryScreen from '../screens/StrategyHistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AgentChatScreen from '../screens/AgentChatScreen';
import SideMenu from '../components/SideMenu';

const Drawer = createDrawerNavigator<MainTabParamList>();

export default function DrawerNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <SideMenu {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        drawerStyle: {
          backgroundColor: '#0B0F19',
          width: '80%',
        },
        overlayColor: 'rgba(0,0,0,0.7)',
        sceneContainerStyle: {
          backgroundColor: '#0B0F19',
        },
      }}
    >
      <Drawer.Screen 
        name="AgentChat" 
        component={AgentChatScreen} 
      />
      <Drawer.Screen 
        name="Dashboard" 
        component={DashboardScreen} 
      />
      <Drawer.Screen 
        name="CampaignList" 
        component={CampaignListScreen} 
      />
      <Drawer.Screen 
        name="StrategyHistory" 
        component={StrategyHistoryScreen} 
      />
      <Drawer.Screen 
        name="Settings" 
        component={SettingsScreen} 
      />
    </Drawer.Navigator>
  );
}
