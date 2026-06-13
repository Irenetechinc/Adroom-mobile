/**
 * App version & changelog service
 *
 * Powers two launch-time behaviors:
 *   1. Force-update gate — if the user's installed version is below the
 *      backend's `minSupportedVersion`, App.tsx renders a blocking modal that
 *      links to the Play Store / App Store. Nothing else loads.
 *   2. "What's New" changelog — when the installed version is higher than
 *      the last version this device acknowledged, App.tsx shows a modal
 *      listing every release note since then.
 *
 * The data source is the public Supabase-backed endpoint
 *   GET /api/app/version?platform=<android|ios>&current=<x.y.z>
 * served by backend/src/server.ts. The endpoint is intentionally
 * unauthenticated so it works on first launch and before sign-in.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.apiUrl ||
  '';

const LAST_SEEN_CHANGELOG_KEY = 'adroom:lastSeenChangelogVersion';
const LAST_VERSION_CHECK_KEY = 'adroom:lastVersionCheckAt';

export interface ChangelogEntry {
  version: string;
  releasedAt: string;
  notes: string;
}

export interface AppVersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  minSupportedVersion: string | null;
  storeUrl: string | null;
  updateAvailable: boolean;
  forceUpdate: boolean;
  changelog: ChangelogEntry[];
}

/**
 * Compares two semver-ish strings (X.Y.Z; pre-release suffixes ignored).
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const core = (v || '0.0.0').split('-')[0].split('+')[0];
    const parts = core.split('.').map((n) => parseInt(n, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function getCurrentAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

function getPlatform(): 'android' | 'ios' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * Fetch version + changelog info from the backend. Returns null if the
 * backend is unreachable — callers should fail open (no force update, no
 * What's New) so a flaky network never bricks the app.
 */
export async function fetchAppVersionInfo(): Promise<AppVersionInfo | null> {
  if (!BACKEND_URL) return null;
  const current = getCurrentAppVersion();
  const platform = getPlatform();
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/app/version?platform=${platform}&current=${encodeURIComponent(current)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as AppVersionInfo;
    await AsyncStorage.setItem(LAST_VERSION_CHECK_KEY, String(Date.now())).catch(() => {});
    return json;
  } catch {
    return null;
  }
}

/** Last version this device explicitly acknowledged in the What's New modal. */
export async function getLastSeenChangelogVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_SEEN_CHANGELOG_KEY);
  } catch {
    return null;
  }
}

export async function setLastSeenChangelogVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SEEN_CHANGELOG_KEY, version);
  } catch {
    /* non-fatal */
  }
}

/**
 * Returns the changelog entries the user hasn't seen yet, capped at the
 * currently installed version. Empty list ⇒ nothing to show.
 *
 * On a fresh install (no last-seen value) we silently mark the current
 * version as seen and return [] — first-time users shouldn't be greeted
 * with a "What's New" modal.
 */
export async function getUnseenChangelog(
  info: AppVersionInfo,
): Promise<ChangelogEntry[]> {
  const current = info.currentVersion;
  const lastSeen = await getLastSeenChangelogVersion();

  if (!lastSeen) {
    // First launch ever on this device — don't pop a modal, just record.
    await setLastSeenChangelogVersion(current);
    return [];
  }

  // Already up to date with what the user has seen.
  if (compareSemver(lastSeen, current) >= 0) return [];

  return (info.changelog || [])
    .filter(
      (entry) =>
        compareSemver(entry.version, lastSeen) > 0 &&
        compareSemver(entry.version, current) <= 0,
    )
    .sort((a, b) => compareSemver(b.version, a.version));
}

export function shouldForceUpdate(info: AppVersionInfo): boolean {
  if (!info.minSupportedVersion) return Boolean(info.forceUpdate);
  return (
    Boolean(info.forceUpdate) ||
    compareSemver(info.currentVersion, info.minSupportedVersion) < 0
  );
}

export function shouldOfferOptionalUpdate(info: AppVersionInfo): boolean {
  if (!info.latestVersion) return false;
  if (shouldForceUpdate(info)) return false;
  return compareSemver(info.currentVersion, info.latestVersion) < 0;
}
