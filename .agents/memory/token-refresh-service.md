---
name: OAuth Token Refresh Service
description: Background service that proactively refreshes expiring platform OAuth tokens in ad_configs — design decisions and platform-specific quirks.
---

## Rule
`TokenRefreshService` (`backend/src/services/tokenRefreshService.ts`) runs every 6 hours via `SCHED_TOKEN_REFRESH_CRON`. It uses `token_expires_at` if set; falls back to `updated_at` age heuristics if null.

## Platform refresh mechanics
| Platform | Flow | Token lifetime | Refresh trigger |
|---|---|---|---|
| Facebook / Instagram / WhatsApp | `fb_exchange_token` grant (no refresh_token needed) | 60 days | `updated_at > 45d` or `token_expires_at < 7d` |
| LinkedIn | `refresh_token` grant | 60d access / 365d refresh | `updated_at > 50d` or `token_expires_at < 7d` |
| Twitter | `refresh_token` grant | 2h access / indefinite refresh | `updated_at > 1.5h` (needs refresh_token in DB) |
| TikTok | `refresh_token` grant | 24h access / 365d refresh | `updated_at > 20h` (needs refresh_token in DB) |

## DB migration
`backend/token_refresh_migration.sql` — adds `token_expires_at TIMESTAMPTZ` + index to `ad_configs`. Run in Supabase SQL editor.

## Why updated_at heuristic
The mobile app writes tokens to ad_configs directly (client-side RLS); the backend exchange endpoints don't know user_id and can't populate token_expires_at at connection time. After the first backend-side refresh, token_expires_at is populated and the explicit path is used forever after.

## Admin endpoints
- `GET /api/admin/tokens/status` — per-row expiry status + summary counts
- `POST /api/admin/tokens/refresh` — fire-and-forget manual trigger (responds immediately, runs async)

## Forbidden files (never modify)
`src/services/facebook.ts`, `src/services/instagram.ts`, `src/services/whatsapp.ts`
