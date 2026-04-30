import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, DarkTheme, LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { RootStackParamList } from '../types';
import { useAuthStore } from '../store/authStore';
// Push registration + notification listeners are owned by App.tsx (single
// source of truth) so we don't double-register or attach listeners twice.

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import DrawerNavigator from './DrawerNavigator';
import StrategyApprovalScreen from '../screens/StrategyApprovalScreen';
import { AuthLoadingSkeleton } from '../components/Skeleton';
import OnboardingScreen from '../screens/OnboardingScreen';

import AgentChatScreen from '../screens/AgentChatScreen';
import ConnectedAccountsScreen from '../screens/ConnectedAccountsScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import PrivacySecurityScreen from '../screens/PrivacySecurityScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import AboutScreen from '../screens/AboutScreen';

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

const prefix = Linking.createURL('/');

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [prefix, 'adroom://'],
  config: {
    screens: {
      Main: {
        path: 'main',
        screens: {
          Dashboard: 'dashboard',
          AgentChat: 'agent-chat-tab',
          StrategyHistory: 'strategy-history',
          Interactions: 'interactions',
          Community: 'community',
          Settings: 'settings',
        },
      } as any,
      AgentChat: 'agent-chat',
      ConnectedAccounts: 'connected-accounts',
      StrategyApproval: 'strategy-approval',
      Login: 'login',
      Signup: 'signup',
      Onboarding: 'onboarding',
      ResetPassword: 'reset-password',
    },
  },
};

// Minimum splash duration so the app never flashes a loader for a few ms.
const MIN_SPLASH_MS = 2200;

export default function AppNavigator() {
  const { session, isLoading, hasActiveStrategy, initialize } = useAuthStore();
  const [splashDone, setSplashDone] = useState(false);
  const splashStartedAt = useRef<number>(Date.now());

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Hold the splash for a minimum duration so it doesn't flash off briefly
  // before the auth state is resolved.
  useEffect(() => {
    if (isLoading) return;
    const elapsed = Date.now() - splashStartedAt.current;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    const t = setTimeout(() => setSplashDone(true), remaining);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading || !splashDone) {
    return <AuthLoadingSkeleton />;
  }

  // Authed initial route: Dashboard if user already has an active strategy,
  // otherwise the chat where they can start one.
  const authedInitialDrawerRoute = hasActiveStrategy ? 'Dashboard' : 'AgentChat';

  return (
    <NavigationContainer theme={AdRoomTheme} linking={linking}>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={session ? 'Main' : 'Onboarding'}
      >
        {!session ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main">
              {(props) => (
                <DrawerNavigator {...props} initialRoute={authedInitialDrawerRoute} />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="StrategyApproval"
              component={StrategyApprovalScreen}
              options={{ title: 'Approve Strategy', headerShown: true }}
            />
            <Stack.Screen name="AgentChat" component={AgentChatScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            <Stack.Screen
              name="ConnectedAccounts"
              component={ConnectedAccountsScreen}
              options={{ title: 'Connected Accounts', headerShown: false }}
            />
            <Stack.Screen
              name="Subscription"
              component={SubscriptionScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="PrivacySecurity"
              component={PrivacySecurityScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="About"
              component={AboutScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
