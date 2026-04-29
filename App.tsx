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
import { useProfileStore } from './src/store/profileStore';
import { useNotificationStore } from './src/store/notificationStore';

export default function App() {
  const notifCleanupRef = useRef<(() => void) | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  // Hydrate the shared profile + unread-notifications stores the moment we
  // have a session, and keep them in sync with auth events. This is what
  // makes the username and the notification badge update everywhere in
  // realtime without a sign-out / reload.
  useEffect(() => {
    const hydrateForUser = async (userId?: string | null, email?: string | null) => {
      if (!userId) {
        useProfileStore.getState().reset();
        useNotificationStore.getState().detach();
        return;
      }
      await Promise.all([
        useProfileStore.getState().load(userId, email),
        useNotificationStore.getState().attach(userId),
      ]);
    };

    supabase.auth.getSession().then(({ data }) => {
      hydrateForUser(data.session?.user?.id, data.session?.user?.email);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        useProfileStore.getState().reset();
        useNotificationStore.getState().detach();
        return;
      }
      // USER_UPDATED fires after the client picks up new user_metadata
      // (e.g. display name change); we re-hydrate the profile so the UI
      // reflects it without a sign-out.
      if (session?.user?.id) {
        hydrateForUser(session.user.id, session.user.email);
      }
    });

    return () => { sub?.subscription?.unsubscribe(); };
  }, []);

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
