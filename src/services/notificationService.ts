import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

/**
 * Production push token registration.
 *
 * End-to-end flow:
 *   1. Generate (or load) a stable per-install device_id stored in SecureStore.
 *   2. Ask for notification permission (no-op on web / Expo Go).
 *   3. Fetch the Expo push token via getExpoPushTokenAsync(projectId).
 *   4. POST { token, device_id, platform, app_version } to the Railway backend
 *      which upserts on (user_id, device_id) into Supabase device_push_tokens.
 *   5. Cache the success payload locally so we only re-POST when something
 *      changes (token rotated, user changed, app upgraded) instead of hitting
 *      the API on every cold start.
 *   6. On failure, leave a `pending` flag in SecureStore — App.tsx retries on
 *      foreground until it lands.
 */

const BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.apiUrl ||
  '';

const DEVICE_ID_KEY = 'adroom.push.device_id';
const LAST_REG_KEY = 'adroom.push.last_registration';
const PENDING_KEY = 'adroom.push.pending';

// Re-confirm registration with the backend at most once per 24 hours even if
// nothing changed, so last_seen_at stays fresh and the row in
// device_push_tokens is rebuilt quickly if it was wiped server-side.
const REREGISTER_AFTER_MS = 24 * 60 * 60 * 1000;

interface LastRegistration {
  token: string;
  device_id: string;
  user_id: string;
  app_version: string;
  registered_at: number;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// In-memory mirror of the SecureStore pending flag so other modules (e.g.
// AppState foreground listener) can ask "do we still need to retry?" without
// awaiting SecureStore on every check.
let pendingRetry = false;
let lastError: string | null = null;

async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing && existing.length > 0) return existing;
  } catch {}
  const fresh = Crypto.randomUUID();
  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
  } catch {}
  return fresh;
}

async function loadLastRegistration(): Promise<LastRegistration | null> {
  try {
    const raw = await SecureStore.getItemAsync(LAST_REG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastRegistration;
  } catch {
    return null;
  }
}

async function saveLastRegistration(reg: LastRegistration): Promise<void> {
  try {
    await SecureStore.setItemAsync(LAST_REG_KEY, JSON.stringify(reg));
  } catch {}
}

async function clearLastRegistration(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_REG_KEY);
  } catch {}
}

async function setPending(pending: boolean): Promise<void> {
  pendingRetry = pending;
  try {
    if (pending) await SecureStore.setItemAsync(PENDING_KEY, '1');
    else await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {}
}

export async function isRegistrationPending(): Promise<boolean> {
  if (pendingRetry) return true;
  try {
    const v = await SecureStore.getItemAsync(PENDING_KEY);
    pendingRetry = v === '1';
    return pendingRetry;
  } catch {
    return false;
  }
}

export function getLastRegistrationError(): string | null {
  return lastError;
}

/**
 * Wipe the cached "last successful registration" record and re-run the full
 * registration flow with `force: true`. Intended to be called from the
 * Notifications diagnostic screen when the user taps "Test push" and the
 * backend reports `tokensFound === 0` — in that case the local cache
 * wrongly believes the device is registered, so we throw it away and try
 * again from scratch.
 */
export async function forcePushReregistration(): Promise<string | null> {
  try {
    await SecureStore.deleteItemAsync(LAST_REG_KEY);
  } catch {}
  return registerPushToken({ force: true });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      allowProvisional: false,
    },
  });

  return status === 'granted';
}

async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'AdRoom Notifications',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#00F0FF',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
    sound: 'default',
  });

  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Campaign Alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 150, 100, 150],
    lightColor: '#F59E0B',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
    sound: 'default',
  });
}

function isExpoGo(): boolean {
  // SDK 53+ removed remote push support inside Expo Go. Detect it cleanly
  // so we log a clear message instead of crashing.
  return (Constants as any).appOwnership === 'expo';
}

async function postRegistration(payload: {
  token: string;
  device_id: string;
  platform: string;
  app_version: string;
}): Promise<boolean> {
  if (!BACKEND_URL) {
    lastError = 'Backend URL is not configured (EXPO_PUBLIC_API_URL).';
    console.warn('[Notifications]', lastError);
    return false;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    lastError = 'No active session — will retry after sign-in.';
    return false;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      lastError = null;
      return true;
    }
    const errBody = await res.text().catch(() => '');
    lastError = `Backend ${res.status}: ${errBody.slice(0, 200)}`;
    console.warn('[Notifications] Register failed:', lastError);
    return false;
  } catch (e: any) {
    lastError = `Network error: ${e?.message || 'unknown'}`;
    console.warn('[Notifications] Register network error:', lastError);
    return false;
  }
}

/**
 * Register this device's Expo push token with the backend.
 * Safe to call multiple times: short-circuits when nothing has changed and
 * the last successful registration is recent (< 7 days).
 */
export async function registerPushToken(options?: { force?: boolean }): Promise<string | null> {
  const force = options?.force === true;

  if (Platform.OS === 'web') return null;

  if (isExpoGo()) {
    console.log(
      '[Notifications] Skipping push registration — Expo Go does not support remote push tokens. Use a development or production build.',
    );
    return null;
  }

  try {
    const granted = await requestNotificationPermissions();
    if (!granted) {
      console.log('[Notifications] Permission not granted — push registration skipped.');
      lastError = 'Notification permission was denied.';
      return null;
    }

    await setupAndroidChannels();

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    if (!projectId) {
      lastError = 'EAS projectId missing — cannot fetch push token.';
      console.warn('[Notifications]', lastError);
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;
    if (!token) {
      lastError = 'Empty token returned by Expo.';
      return null;
    }

    const deviceId = await getOrCreateDeviceId();
    const appVersion = Constants.expoConfig?.version ?? '1.0.0';

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      // Defer until we have a session; App.tsx re-runs this on SIGNED_IN.
      console.log('[Notifications] No user session yet; deferring push registration.');
      return token;
    }

    // Short-circuit if we already pushed this exact tuple recently.
    if (!force) {
      const last = await loadLastRegistration();
      if (
        last &&
        last.token === token &&
        last.device_id === deviceId &&
        last.user_id === userId &&
        last.app_version === appVersion &&
        Date.now() - last.registered_at < REREGISTER_AFTER_MS
      ) {
        await setPending(false);
        return token;
      }
    }

    const ok = await postRegistration({
      token,
      device_id: deviceId,
      platform: Platform.OS,
      app_version: appVersion,
    });

    if (ok) {
      await saveLastRegistration({
        token,
        device_id: deviceId,
        user_id: userId,
        app_version: appVersion,
        registered_at: Date.now(),
      });
      await setPending(false);
      console.log('[Notifications] Push token registered successfully.');
      return token;
    }

    // Failed — mark pending so foreground listener retries later.
    await setPending(true);
    return token;
  } catch (err: any) {
    lastError = err?.message || 'Unknown error';
    console.error('[Notifications] Token registration error:', lastError);
    await setPending(true);
    return null;
  }
}

/**
 * Mark this device's token inactive on the backend. Call on sign-out so the
 * previous user stops receiving pushes meant for the new user on this device.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!BACKEND_URL) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const last = await loadLastRegistration();
    const deviceId = last?.device_id || (await getOrCreateDeviceId());

    await fetch(`${BACKEND_URL}/api/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ device_id: deviceId }),
    }).catch(() => {});
  } finally {
    await clearLastRegistration();
    await setPending(false);
  }
}

export function setupNotificationListeners(
  onReceive?: (notification: Notifications.Notification) => void,
  onResponse?: (response: Notifications.NotificationResponse) => void,
): () => void {
  const receiveSub = Notifications.addNotificationReceivedListener((notification) => {
    console.log('[Notifications] Received:', notification.request.content.title);
    onReceive?.(notification);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('[Notifications] User tapped notification:', response.notification.request.content.title);
    onResponse?.(response);
  });

  return () => {
    receiveSub.remove();
    responseSub.remove();
  };
}

export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {}
}

export async function dismissAllNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
    await setBadgeCount(0);
  } catch {}
}

export async function scheduleLocalNotification(params: {
  title: string;
  body: string;
  data?: Record<string, any>;
  seconds?: number;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: params.data ?? {},
        sound: 'default',
      },
      trigger: params.seconds
        ? { seconds: params.seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL }
        : null,
    });
  } catch (err: any) {
    console.error('[Notifications] Schedule error:', err.message);
  }
}
