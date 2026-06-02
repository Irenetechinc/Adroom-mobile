---
name: Android OAuth browser function
description: Which WebBrowser function to use for OAuth on Android + Expo SDK 54, and why openBrowserAsync fails.
---

## Rule
Always use `WebBrowser.openAuthSessionAsync(authUrl, 'adroom://')` for OAuth on Android.
Never use `openBrowserAsync` for OAuth flows.

**Why:** `openAuthSessionAsync` configures Chrome Custom Tab to monitor for the `adroom://` scheme and close automatically when the backend redirects there. `openBrowserAsync` does NOT do this — on Android it may show "Can't open link" inside the Custom Tab, leaving the browser open indefinitely, which makes the typing indicator appear frozen.

**Why return value is ignored:** On newer Android + Expo SDK 54, `openAuthSessionAsync` may return `{ type: 'cancel' }` even on successful auth (the OS handles the `adroom://` deep link separately). We store the code server-side via `/auth/poll?state=...` so we don't need the code from the URL. We just wait for the tab to close, then poll immediately.

**How to apply:** 
1. `await WebBrowser.openAuthSessionAsync(authUrl, 'adroom://')` — waits for tab to close
2. Poll `/auth/poll?state=...` up to 5 times (1 s apart) — app is foregrounded now, timers are reliable
3. On code found: exchange with backend → return token
4. Backend OAuth callbacks MUST redirect to `adroom://auth/<platform>/callback` on success

## Platforms confirmed
Facebook, Instagram, WhatsApp — all use Facebook's OAuth dialog with `adroom://` redirect.
