---
name: OAuth deep-link redirect requirement
description: Why Facebook/Instagram callbacks must redirect to adroom:// and WhatsApp must NOT use window.close()
---

## Rule
`/auth/facebook/callback` and `/auth/instagram/callback` MUST issue a 302 redirect to `adroom://auth/facebook/callback?code=...` (not HTML) on success.
`/auth/whatsapp/callback` MUST show static HTML with NO `window.close()`.

## Why
- `facebook.ts` / `instagram.ts` use `WebBrowser.openAuthSessionAsync(authUrl, redirectUri)` where `redirectUri = adroom://...`. That function only resolves `{type:'success'}` when the browser navigates to a URL matching the `adroom://` scheme. If the backend returns HTML with `window.close()` instead, modern Android Chrome closes the Custom Tab, causing `{type:'dismiss'}` → null → "Connection Cancelled".
- `whatsapp.ts` uses `openBrowserAsync` (fire-and-forget) + polling every 2 s via `/auth/poll?state=...`. `window.close()` in the callback HTML can close Chrome Custom Tabs before the first poll fires, triggering the 5-second grace-period timer and resolving null. The app calls `WebBrowser.dismissBrowser()` itself after the poll succeeds.

## How to apply
- `authPagesRouter.ts` callbacks (mounted first at server.ts line 138, they shadow the direct server.ts routes):
  - Facebook/Instagram success path: `res.redirect(\`adroom://auth/<platform>/callback?code=...\`)`
  - Error path: show `buildOAuthClosePage(true, platform)` HTML
  - WhatsApp: store code, return `buildWhatsAppClosePage(isError)` (no window.close script)
- The `buildOAuthClosePage` function retains `window.close()` — it is still used for Twitter, LinkedIn, TikTok (polling-based with state; window.close is harmless there because the first poll fires within the grace period).
