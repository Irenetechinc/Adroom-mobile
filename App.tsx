import './global.css';
import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { registerPushToken, setupNotificationListeners } from './src/services/notificationService';
import { supabase } from './src/services/supabase';

export default function App() {
  const notifCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let initialized = false;

    const initNotifications = async () => {
      if (initialized) return;
      initialized = true;

      await registerPushToken();

      notifCleanupRef.current = setupNotificationListeners(
        (notification) => {
          console.log('[App] Notification received:', notification.request.content.title);
        },
        (response) => {
          const data = response.notification.request.content.data;
          console.log('[App] Notification tapped:', data);
        }
      );
    };

    // Try immediately in case already signed in
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setTimeout(initNotifications, 1500);
    });

    // Also wire up to auth state changes so new sign-ins register immediately
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        setTimeout(initNotifications, 1500);
      }
    });

    return () => {
      notifCleanupRef.current?.();
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
