---
name: Android OAuth browser function
description: Which WebBrowser function to use for OAuth on Android by platform, and the root cause of the instant-cancel bug.
---

## Rule — Facebook / Instagram / WhatsApp
Use `WebBrowser.openBrowserAsync(authUrl, { showInRecents: false })` (fire-and-forget) + background polling loop.
**Never use `openAuthSessionAsync` for these three platforms.**

**Why:** `openAuthSessionAsync(url, 'adroom://')` returns `{ type: 'cancel' }` immediately on Android when:
- the app runs in Expo Go (the `adroom://` scheme is not registered there), OR
- the Facebook app is installed (it intercepts the OAuth URL before Chrome Custom Tab can monitor it).
This caused the "connection was cancelled" message with no browser ever opening — the 5-poll loop ran against a server that hadn't received the callback yet.

**How to apply (FB / IG / WA):**
1. `openBrowserAsync(authUrl, { showInRecents: false })` — sets `browserClosed = true` in `.then()/.catch()`
2. Poll `/auth/poll?state=...` every 1 s for up to 120 s, stopping if `browserClosed`
3. If browser closed without code: wait 2 s grace period, poll once more
4. `await WebBrowser.dismissBrowser()` — closes browser after code found (no-op if already closed)
5. Exchange code → return token
Backend success callbacks show the `buildOAuthClosePage` HTML instead of `adroom://` redirect.

## Rule — Twitter / LinkedIn / TikTok
These platforms already work correctly. Leave them using `openAuthSessionAsync` + URL parsing — **do not change**.

## Platforms changed
Facebook (`facebook.ts`), Instagram (`instagram.ts`), WhatsApp (`whatsapp.ts`) — all rewritten.
Backend callbacks changed: facebook, instagram, whatsapp → show success HTML (no `adroom://` redirect).
Twitter, LinkedIn, TikTok callbacks — left unchanged, still redirect to `adroom://`.
