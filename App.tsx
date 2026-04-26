import './global.css';
import React, { useEffect, useRef } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import {
  registerPushToken,
  setupNotificationListeners,
  isRegistrationPending,
} from './src/services/notificationService';
import { supabase } from './src/services/supabase';

export default function App() {
  const notifCleanupRef = useRef<(() => void) | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Single-flight push registration so concurrent triggers (initial session
    // + onAuthStateChange + foreground) don't fire multiple parallel POSTs.
    const triggerRegister = (reason: string) => {
      if (inFlightRef.current) return;
      console.log(`[App] Push registration trigger: ${reason}`);
      inFlightRef.current = registerPushToken()
        .catch((e) => console.warn('[App] registerPushToken threw:', e?.message))
        .finally(() => {
          inFlightRef.current = null;
        });
    };

    // Listen for received/tapped notifications.
    notifCleanupRef.current = setupNotificationListeners(
      (notification) => {
        console.log('[App] Notification received:', notification.request.content.title);
      },
      (response) => {
        const data = response.notification.request.content.data;
        console.log('[App] Notification tapped:', data);
      },
    );

    // Initial check: if we already have a session at boot, register now.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) triggerRegister('initial-session');
    });

    // Re-trigger on every auth event that yields a session — covers fresh
    // sign-ins and silent token refreshes after the first launch.
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session) {
        triggerRegister(event);
      }
    });

    // On foreground, retry if the last attempt left a pending flag.
    const onAppStateChange = async (state: AppStateStatus) => {
      if (state !== 'active') return;
      const pending = await isRegistrationPending();
      if (pending) {
        const { data } = await supabase.auth.getSession();
        if (data.session) triggerRegister('foreground-retry');
      }
    };
    const appStateSub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      notifCleanupRef.current?.();
      authListener?.subscription?.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
