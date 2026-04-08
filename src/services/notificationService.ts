import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || '';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

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
      allowAnnouncements: true,
    },
  });

  return status === 'granted';
}

export async function registerPushToken(): Promise<string | null> {
  try {
    const granted = await requestNotificationPermissions();
    if (!granted) {
      console.log('[Notifications] Permission not granted');
      return null;
    }

    if (Platform.OS === 'android') {
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

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    const pushToken = tokenData.data;
    console.log('[Notifications] Expo Push Token:', pushToken);

    await savePushTokenToBackend(pushToken);

    return pushToken;
  } catch (err: any) {
    console.error('[Notifications] Token registration error:', err.message);
    return null;
  }
}

async function savePushTokenToBackend(token: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !BACKEND_URL) return;

    const res = await fetch(`${BACKEND_URL}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? '1.0.0',
      }),
    });

    if (res.ok) {
      console.log('[Notifications] Push token registered with backend');
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('[Notifications] Token registration failed:', err);
    }
  } catch (err: any) {
    console.error('[Notifications] Backend save error:', err.message);
  }
}

export function setupNotificationListeners(
  onReceive?: (notification: Notifications.Notification) => void,
  onResponse?: (response: Notifications.NotificationResponse) => void
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
