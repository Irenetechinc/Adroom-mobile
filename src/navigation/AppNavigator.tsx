import React, { useEffect } from 'react';
import { View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAuthStore } from '../store/authStore';

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import TabNavigator from './TabNavigator';
import FacebookConfigScreen from '../screens/FacebookConfigScreen';
// AgentChatScreen is now in TabNavigator
import StrategyApprovalScreen from '../screens/StrategyApprovalScreen';
import { AuthLoadingSkeleton } from '../components/Skeleton';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AdRoomTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0B0F19',
    card: '#151B2B',
    text: '#E2E8F0',
    primary: '#00F0FF',
    border: '#1E293B',
  },
};

export default function AppNavigator() {
  const { session, isLoading, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return (
      <AuthLoadingSkeleton />
    );
  }

  return (
    <NavigationContainer theme={AdRoomTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen 
              name="StrategyApproval" 
              component={StrategyApprovalScreen} 
              options={{ title: 'Approve Strategy', headerShown: true }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
