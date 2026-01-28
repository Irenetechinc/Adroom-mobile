import React, { useEffect } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useAuthStore } from '../store/authStore';

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import TabNavigator from './TabNavigator';
import FacebookConfigScreen from '../screens/FacebookConfigScreen';
import AgentChatScreen from '../screens/AgentChatScreen';
import StrategyApprovalScreen from '../screens/StrategyApprovalScreen';
import { AuthLoadingSkeleton } from '../components/Skeleton';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!session ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="FacebookConfig" component={FacebookConfigScreen} />
            <Stack.Screen 
              name="AgentChat" 
              component={AgentChatScreen} 
              options={{ title: 'AdRoom Agent', headerShown: true }}
            />
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
