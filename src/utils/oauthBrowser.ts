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
 * Phase 2  (browser closed)  — poll every 1 s.
 *   • "Immediate close" (< 3 s) → up to 90 s — native Facebook/Instagram/
 *     WhatsApp app intercepted the URL and is handling OAuth natively.  The
 *     user may need to log in, which takes time.
 *   • Normal close (≥ 3 s) → up to 15 s — user manually closed the tab or
 *     the adroom:// redirect fired after normal Chrome Custom Tab usage.
 *
 * Any error response from the backend (access_denied, etc.) exits immediately
 * regardless of phase.
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
  const openedAt = Date.now();

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

  // Phase 2: browser is closed.
  // How long the browser was open tells us what happened:
  //   < 3 s  → native-app intercept (FB/IG/WA app handling OAuth in background)
  //             — give 90 s for the user to complete login in that app.
  //   ≥ 3 s  → normal close (manual dismiss or adroom:// redirect)
  //             — 15 s is plenty to pick up the code that was stored just
  //                before the redirect fired.
  const browserLifespanMs = Date.now() - openedAt;
  const phase2Limit = browserLifespanMs < 3000 ? 90 : 15;

  console.log(
    `[OAuthBrowser] Phase 2 — browser was open ${Math.round(browserLifespanMs / 1000)}s, ` +
    `polling for up to ${phase2Limit}s.`,
  );

  for (let i = 0; i < phase2Limit; i++) {
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
