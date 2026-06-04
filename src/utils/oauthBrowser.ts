import * as WebBrowser from 'expo-web-browser';

/**
 * Opens the OAuth browser and polls the backend until the authorisation code
 * arrives.  Works reliably on both iOS and Android physical devices.
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * The backend stores the code in an in-memory poll store and then issues a
 *   302  →  adroom://oauth-done
 * redirect.  On Android this redirect closes the Chrome Custom Tab naturally
 * and brings AdRoom back to the foreground.  openBrowserAsync() resolves,
 * browserClosed becomes true, and Phase 2 finds the code in the next poll.
 *
 * Phase 1  (browser open)    — poll every 1 s, up to 120 s.
 * Phase 2  (browser closed)  — poll every 1 s, up to 10 more seconds.
 *
 * The 10-second Phase-2 grace period handles the Android "Facebook / Instagram
 * app intercept" case: when that app is installed it can intercept the Chrome
 * Custom Tab before it even opens, causing openBrowserAsync() to resolve
 * immediately.  The OAuth still completes inside the platform app and the
 * backend fires a few seconds later — Phase 2 catches it.
 *
 * dismissBrowser() is called at the end as iOS cleanup (it is a no-op on
 * Android — the tab was already closed by the adroom:// redirect).
 *
 * @param authUrl  Full OAuth URL to open in the browser.
 * @param pollUrl  Full URL including the ?state=… query string.
 * @returns        The authorisation code string, or null on cancel / timeout.
 */
export async function runOAuthBrowserFlow(
  authUrl: string,
  pollUrl: string,
): Promise<string | null> {
  let browserClosed = false;

  WebBrowser.openBrowserAsync(authUrl, { showInRecents: false })
    .then(() => { browserClosed = true; })
    .catch(() => { browserClosed = true; });

  const pollOnce = async (): Promise<string | 'error' | null> => {
    try {
      const res = await fetch(pollUrl);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code)  return data.code as string;
      if (data.error) return 'error';
    } catch { /* network hiccup — will retry */ }
    return null;
  };

  // Phase 1: poll every second while the browser is open (up to 2 minutes).
  for (let i = 0; i < 120 && !browserClosed; i++) {
    await new Promise<void>(r => setTimeout(r, 1000));
    if (browserClosed) break;
    const result = await pollOnce();
    if (result === 'error') {
      try { await WebBrowser.dismissBrowser(); } catch { /* ignore */ }
      return null;
    }
    if (result) {
      try { await WebBrowser.dismissBrowser(); } catch { /* ignore */ }
      return result;
    }
  }

  // Phase 2: browser closed — keep polling for up to 10 more seconds.
  // Covers (a) adroom://oauth-done just closed the tab and code is already
  // stored, and (b) the Facebook / Instagram / WhatsApp app intercepted the
  // OAuth URL and completes a few seconds after the tab was dismissed.
  for (let i = 0; i < 10; i++) {
    await new Promise<void>(r => setTimeout(r, 1000));
    const result = await pollOnce();
    if (result === 'error') break;
    if (result) {
      try { await WebBrowser.dismissBrowser(); } catch { /* ignore */ }
      return result;
    }
  }

  // iOS cleanup — dismissBrowser is a no-op on Android.
  try { await WebBrowser.dismissBrowser(); } catch { /* ignore */ }
  return null;
}
