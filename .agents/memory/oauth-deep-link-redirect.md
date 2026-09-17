---
name: OAuth deep-link redirect requirement
description: All openAuthSessionAsync platforms must redirect to adroom:// scheme; WhatsApp must NOT use window.close()
---

## Rule
Every platform that uses `openAuthSessionAsync` in the mobile app must have its backend callback issue a **302 redirect to `adroom://auth/<platform>/callback?code=...`** on success — NOT HTML with `window.close()`.

Platforms using `openAuthSessionAsync` (all fixed):
- Facebook → `adroom://auth/facebook/callback?code=...` (authPagesRouter.ts — mounted first)
- Instagram → `adroom://auth/instagram/callback?code=...` (authPagesRouter.ts — mounted first)
- Twitter → `adroom://auth/twitter/callback?code=...&state=...` (server.ts direct)
- LinkedIn → `adroom://auth/linkedin/callback?code=...&state=...` (server.ts direct)
- TikTok → `adroom://auth/tiktok/callback?code=...` (server.ts direct; TikTok may send `auth_code` instead of `code` — use `finalCode = code || auth_code`)

WhatsApp uses `openBrowserAsync` + polling — its callback shows static HTML with **NO** `window.close()`.

## Why
`openAuthSessionAsync` only resolves `{type:'success'}` when the browser navigates to a URL matching the `adroom://` scheme. If the backend returns HTML with `window.close()` instead, modern Android Chrome closes the Custom Tab, causing `{type:'dismiss'}` → null → "Connection Cancelled". User sees it as "browser barely opened."

WhatsApp: 2-second poll / 5-second grace period. `window.close()` can close the browser before the first poll fires. The app's own `dismissBrowser()` call closes the tab after poll success.

## How to apply
- `authPagesRouter.ts` callbacks run FIRST (mounted at server.ts line 138) — Facebook and Instagram are fixed here.
- `server.ts` direct routes handle Twitter, LinkedIn, TikTok, WhatsApp.
- Twitter/LinkedIn: include `state=` in redirect URL (services parse it from `result.url`).
- Error paths: return `buildOAuthClosePage(platform, false, message)` HTML (no deep link to return to).
