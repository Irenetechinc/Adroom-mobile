import './global.css';
import React, { useEffect, useRef, useState } from 'react';
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
import { useAgentStore } from './src/store/agentStore';
import {
  fetchAppVersionInfo,
  getCurrentAppVersion,
  getUnseenChangelog,
  setLastSeenChangelogVersion,
  shouldForceUpdate,
  shouldOfferOptionalUpdate,
  type AppVersionInfo,
  type ChangelogEntry,
} from './src/services/appVersionService';
import WhatsNewModal from './src/components/WhatsNewModal';
import ForceUpdateModal from './src/components/ForceUpdateModal';

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

    // Pull the connected-platforms list from the backend the moment we
    // have a session. This is what lets connected accounts survive an APK
    // update / fresh install — AsyncStorage may be wiped, but `ad_configs`
    // on Supabase is the source of truth and we re-hydrate from it on
    // every cold start instead of waiting for the user to open the
    // ConnectedAccounts screen.
    const refreshConnectedPlatforms = () => {
      try {
        useAgentStore.getState().loadConnectedPlatforms().catch(() => {});
      } catch { /* store may not be ready yet */ }
    };

    supabase.auth.getSession().then(({ data }: any) => {
      hydrateForUser(data.session?.user?.id, data.session?.user?.email);
      if (data.session?.user?.id) refreshConnectedPlatforms();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event: string, session: any) => {
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
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
          refreshConnectedPlatforms();
        }
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
    supabase.auth.getSession().then(({ data }: any) => {
      if (data.session) triggerRegister('initial-session');
    });

    // Re-trigger on every auth event that yields a session — covers fresh
    // sign-ins and silent token refreshes after the first launch.
    const { data: authListener } = supabase.auth.onAuthStateChange((event: string, session: any) => {
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

  // ── App-version + changelog gating ─────────────────────────────────────
  // On every cold launch (and again when the app comes back to the
  // foreground after a long pause) we ask the backend for the latest
  // version + changelog. The backend may tell us:
  //   - forceUpdate ⇒ render a blocking modal that only links to the store
  //   - updateAvailable (soft) ⇒ render a dismissable "Update?" prompt
  //   - changelog newer than the last version this device acknowledged
  //     ⇒ render the "What's New" modal once.
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [unseenChangelog, setUnseenChangelog] = useState<ChangelogEntry[]>([]);
  const [whatsNewVisible, setWhatsNewVisible] = useState(false);
  const [optionalUpdateVisible, setOptionalUpdateVisible] = useState(false);
  // Once dismissed in this session, don't keep nagging on every foreground.
  const optionalDismissedRef = useRef(false);
  const lastVersionCheckRef = useRef<number>(0);

  const runVersionCheck = React.useCallback(async () => {
    const info = await fetchAppVersionInfo();
    if (!info) return;
    setVersionInfo(info);

    // What's New takes priority over the optional update prompt — if the
    // user just updated, show them what changed BEFORE asking them to
    // update again.
    const unseen = await getUnseenChangelog(info);
    if (unseen.length > 0) {
      setUnseenChangelog(unseen);
      setWhatsNewVisible(true);
      return;
    }

    if (
      shouldOfferOptionalUpdate(info) &&
      !optionalDismissedRef.current
    ) {
      setOptionalUpdateVisible(true);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    runVersionCheck();
    lastVersionCheckRef.current = Date.now();

    // Re-check on foreground, but throttle to once per 30 minutes so we
    // never hammer the endpoint or pop the same modal repeatedly.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const since = Date.now() - lastVersionCheckRef.current;
      if (since < 30 * 60 * 1000) return;
      lastVersionCheckRef.current = Date.now();
      runVersionCheck();
    });
    return () => sub.remove();
  }, [runVersionCheck]);

  const dismissWhatsNew = React.useCallback(async () => {
    setWhatsNewVisible(false);
    await setLastSeenChangelogVersion(getCurrentAppVersion());
    // After acknowledging the changelog, surface the optional update
    // prompt if one is still pending.
    if (
      versionInfo &&
      shouldOfferOptionalUpdate(versionInfo) &&
      !optionalDismissedRef.current
    ) {
      setOptionalUpdateVisible(true);
    }
  }, [versionInfo]);

  const dismissOptional = React.useCallback(() => {
    optionalDismissedRef.current = true;
    setOptionalUpdateVisible(false);
  }, []);

  const forceUpdateActive = !!versionInfo && shouldForceUpdate(versionInfo);

  return (
    <SafeAreaProvider>
      <AppNavigator />

      {/* What's New — first launch on a new version */}
      <WhatsNewModal
        visible={whatsNewVisible && !forceUpdateActive}
        entries={unseenChangelog}
        currentVersion={getCurrentAppVersion()}
        onDismiss={dismissWhatsNew}
      />

      {/* Optional update — soft prompt */}
      <ForceUpdateModal
        visible={optionalUpdateVisible && !forceUpdateActive && !whatsNewVisible}
        mode="optional"
        currentVersion={versionInfo?.currentVersion ?? getCurrentAppVersion()}
        latestVersion={versionInfo?.latestVersion ?? null}
        storeUrl={versionInfo?.storeUrl ?? null}
        onLater={dismissOptional}
      />

      {/* Force update — non-dismissable, rendered last so it's on top */}
      <ForceUpdateModal
        visible={forceUpdateActive}
        mode="required"
        currentVersion={versionInfo?.currentVersion ?? getCurrentAppVersion()}
        latestVersion={versionInfo?.latestVersion ?? null}
        storeUrl={versionInfo?.storeUrl ?? null}
      />
    </SafeAreaProvider>
  );
}
