# AdRoom — AI-Powered Autonomous Social Marketing Platform

## Project Overview
AdRoom is a **React Native (Expo) mobile app** with a Node.js/Express backend. It uses 4 specialized AI agents that autonomously execute organic social media marketing campaigns: post, reply, DM, edit, and delete — with no manual intervention needed.

## Architecture

### Mobile App (Expo / React Native)
- **Framework**: React Native with Expo SDK
- **Navigation**: React Navigation (Bottom Tabs + Stack)
- **State**: Zustand
- **Auth**: Supabase Auth
- **Platforms**: iOS, Android (run locally with Expo Go)
- **NOT a web app** — Replit hosts the backend only. Backend runs on Railway, DB on Supabase.

### Backend (Node.js / Express on Railway)
- **Framework**: Express.js on port 8000
- **Language**: TypeScript (ts-node)
- **AI**: OpenAI GPT-4o (strategy) + Google Gemini 2.0 Flash (text) + Imagen 3 (creative)
- **Database**: Supabase (PostgreSQL)
- **Scheduler**: Autonomous task execution every 5 min
- **Credit Management Agent (CMA)**: AI cost optimizer — runs before every AI operation, routes to economy model, persists state to DB

### Credit Management Agent (CMA)
- Intercepts all AI operations before they run (evaluate → route → deduct)
- Economy routing table: lower-tier users get Gemini Flash instead of GPT-4o
- Dynamic override: if system burns > 500 credits/hour, ALL users get economy routing
- Per-user cooldowns: prevents abuse on expensive operations
- Daily caps by tier (none=10, trial=20, starter=50, pro=250, pro_plus=∞)
- Saves to `cma_savings_log` + `cma_monitor_log` (Supabase)
- Restores economy_override state on server restart from DB
- Self-monitor loop every 10 min (scheduler) adjusts routing dynamically
- Admin stats: `GET /api/admin/cma/stats`
- Live status: `GET /api/cma/live-status`
- DB migration: `backend/cma_migration.sql`

## Autonomous Agent System

### 4 Specialized Agents
| Agent | Purpose |
|-------|---------|
| SALESMAN | Conversion, lead capture, direct sales DMs |
| AWARENESS | Viral reach, trending topics, shareability |
| PROMOTION | FOMO, scarcity, countdown urgency |
| LAUNCH | Product hype, announcements, narrative dominance |

### Intelligence Engines (run every 15 min)
- **IPE** — Platform Intelligence (algorithm shifts)
- **Social Listening** — Trending conversations
- **Emotional Intelligence** — Emotional ownership of categories
- **GEO Monitoring** — Geographic narrative shifts

### Autonomous Activities (all real API calls, no mocks)
- `publishToFacebook` — Feed posts + photo posts
- `publishToInstagram` — Image posts via Graph API
- `publishToTwitter` — Tweets
- `publishToLinkedIn` — UGC posts
- `publishToTikTok` — Video posts via Open API
- `editFacebookPost` — Update post text
- `replyToFacebookComment` / `replyToInstagramComment` / `replyToTwitterPost` / `replyToLinkedInComment` / `replyToTikTokComment`
- `sendFacebookDM` / `sendInstagramDM` / `sendTwitterDM` / `sendLinkedInMessage`
- `fetchFacebookPostMetrics` / `fetchTwitterPostMetrics` — Real performance data

## AI-Driven Scraper (no pre-listed paths)
1. Fetch homepage HTML
2. Extract all `href` links via regex
3. Use AI to classify which are product/collection/catalog pages
4. Scrape identified pages (max 8)
5. AI extracts product details from combined content

## Backend Workflows
- **Backend API** → `cd backend && ts-node src/server.ts` on port 8000
- **Start application** → `node status-server.js` on port 5000 (shows status dashboard)

## Key Backend Routes
| Route | Description |
|-------|------------|
| `POST /api/scrape` | AI-driven website scraping |
| `POST /api/ai/generate-strategy` | Full intelligence pipeline strategy |
| `POST /api/ai/activate-agents` | Start autonomous campaign execution |
| `GET /api/agents/status/:id` | Live agent status |
| `GET /api/platform-configs` | All connected platform statuses |
| `DELETE /api/platform-configs/:platform` | Disconnect a platform |
| `POST /api/auth/facebook/exchange` | Facebook OAuth token exchange |
| `POST /api/auth/twitter/exchange` | Twitter OAuth token exchange |
| `POST /api/auth/linkedin/exchange` | LinkedIn OAuth token exchange |
| `POST /api/auth/tiktok/exchange` | TikTok OAuth token exchange |

## Platform OAuth Connection Flow
**Each platform connects in this order:**
1. User OAuth login (account-level access)
2. Page/Profile selection (if applicable)
3. Ad account linking (optional)

## Environment Variables Required
### Backend (set as Replit secrets)
- `OPENAI_API_KEY` — GPT-4o strategy generation
- `GEMINI_API_KEY` — Gemini 2.0 Flash text generation
- `SUPABASE_SERVICE_ROLE_KEY` — Service-level DB access
- `FB_APP_ID` + `FB_APP_SECRET` — Facebook OAuth
- `FB_VERIFY_TOKEN` — Facebook webhook verification
- `TWITTER_CLIENT_ID` + `TWITTER_CLIENT_SECRET` — Twitter OAuth
- `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` — LinkedIn OAuth
- `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` — TikTok Login Kit OAuth
- `RUNWAY_API_KEY` — (optional) Video generation

### Frontend (set in .env or Replit userenv)
- `EXPO_PUBLIC_API_URL` — Backend URL (e.g., https://your-replit.repl.co or localhost:8000)
- `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_FACEBOOK_APP_ID`
- `EXPO_PUBLIC_TWITTER_CLIENT_ID`
- `EXPO_PUBLIC_TIKTOK_CLIENT_KEY`

## Database (Supabase)
Key tables:
- `ad_configs` — Platform OAuth tokens + page IDs
- `strategies` — Generated campaign strategies
- `agent_tasks` — Autonomous task queue
- `agent_performance` — Real metrics from platforms
- `agent_leads` — SALESMAN lead pipeline
- `agent_interventions` — AI autonomous decisions log
- `product_memory` — Scraped product data
- `user_memory` — User context
- `platform_intelligence` — IPE data
- `social_conversations` — Social listening data
- `emotional_ownership` — Emotional category analysis
- `narrative_snapshots` — GEO monitoring data

## Recent Updates (v2.2.9 — 2026-04-28)
- **Cold app starts now also surface the restore prompt**: v2.2.8 only set the `pendingSessionPrompt` flag on a fresh `SIGNED_IN` event, so users who killed and reopened the app (cached session intact, no auth event fires) silently got their old chat re-hydrated. `authStore.initialize()` now sets the flag whenever there's an existing session at app launch, BEFORE the `onAuthStateChange` listener attaches — so the chat screen always wins the race and sees the flag on cold start.
- **"Restore previous session" actually restores ONE session, not 7 days**: v2.2.8's button restored every chat from the last 7 days as one giant scroll. New `splitIntoSessions(rows)` helper in `agentStore` groups chat_history into discrete sessions using two boundaries:
  1. The agent's greeting line (`/^Hello\b.*\bI am AdRoom AI\b/i`) — emitted by `startNewSession`, so it's an unambiguous session start.
  2. A >2-hour gap between consecutive messages — covers "I closed the app and came back later" without splitting on quick typing pauses.
  Sessions containing only a greeting (no real interaction) are filtered out as not worth restoring. The prompt's Restore button now calls new `restoreLastSession()`, which loads only the most recent meaningful session.
- **History icon now opens a session-picker modal**: replaced the v2.2.8 confirm-and-restore-everything Alert with a proper modal. Tapping the cyan History icon in the chat header now opens a card listing every session from the last 7 days, newest first, each showing date, time range, message count, and a 90-char preview (first user message). Tapping a row restores that specific session; the Close button dismisses without changes. Empty-state and loading-state are handled honestly. New agent-store functions: `fetchRecentSessions(days = 7): Promise<ChatSession[]>` (newest-first) and `applySession(session)` (replaces current chat with that session's messages).
- **API surface change in `agentStore`**: removed `restoreRecentHistory(days)` (only added in v2.2.8 — not used elsewhere). Replaced by `fetchRecentSessions` + `applySession` + `restoreLastSession`. New exported type `ChatSession` for callers building UIs around the session list.

## Recent Updates (v2.2.8 — 2026-04-28)
- **Email links no longer 404 on desktop browsers**: Sign-up verification and password-reset emails were redirecting to `adroom://verified` / `adroom://reset-password` deep links. These only work on a phone with the AdRoom app installed — on any desktop browser they silently fell back to Supabase's default Site URL (`localhost:3000`) and 404'd, even though the underlying auth action (verify or recover) had already succeeded server-side. Two real, public HTML pages are now served by the Express backend and used as the `redirectTo` target for all three flows (`/api/auth/register`, `/api/auth/reset-password`, `/api/auth/resend-verification`):
  - `GET /auth/verified` — branded success page with an "Open AdRoom AI" deep link button. Auto-fires the `adroom://verified` deep link once for users who have the app installed; renders an honest error view if Supabase appended `?error=...` (expired/used link).
  - `GET /auth/reset-password` — self-contained password-reset form that loads supabase-js from a CDN, parses the `#access_token` + `refresh_token` from the URL hash (Supabase recovery flow), calls `supabase.auth.updateUser({ password })` directly from the browser, then signs out the temporary recovery session so the token can't be reused. No backend endpoint required — the only secrets shipped to the page are the public `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the same values that ship in every mobile build). Service role is never exposed.
  - New `getPublicBaseUrl(req)` helper in `backend/src/server.ts`. Reads `PUBLIC_BASE_URL` env var first (set this on Railway to your custom domain, e.g. `https://api.adroomai.com`); otherwise infers `https://<host>` from the request via `X-Forwarded-Proto` / `X-Forwarded-Host`. `app.set('trust proxy', true)` was added so Express trusts those headers behind the Railway / Replit proxy.
  - New file: `backend/src/auth/authPagesRouter.ts`. Mounted in `server.ts` before the `/api` routes so the pages are reachable without an Authorization header.
- **Chat history no longer auto-loads on sign-in — user is asked**: `agentStore.loadMessages()` previously hydrated yesterday's full conversation onto the screen the moment the chat screen mounted. Now:
  - New `pendingSessionPrompt` state in `agentStore` (mirrored to AsyncStorage under `adroom-pending-session-prompt` so it survives the brief race between `onAuthStateChange` and the chat screen mount). Set to `true` by `authStore` on every fresh `SIGNED_IN` event (NOT on cold-start `INITIAL_SESSION` or `TOKEN_REFRESHED` — those just resume the existing chat as before).
  - When the flag is set, `loadMessages()` checks if any chat exists within the last 7 days. If yes, it renders ONE special card (`uiType: 'session_restore_prompt'` — new `SessionRestorePromptCard` component in `AgentChatScreen.tsx`) showing "Last activity X hours ago" with two buttons: **Restore previous session** (calls new `restoreRecentHistory(7)` action which loads only chats from the last 7 days) and **Start a new session** (calls `startNewSession({ keepServerHistory: true })` so the user can still hit the History icon later if they change their mind). The flag is cleared immediately so a refresh won't re-prompt.
  - If there's no recent history, the prompt is skipped and the agent goes straight to its normal greeting.
- **History icon in the chat header**: New `History` (lucide) icon in the `AgentChatScreen` header, next to the existing `RotateCcw` reset button. Tapping it pops a "Restore previous chat — replace current conversation with the last 7 days?" confirmation; on accept calls `restoreRecentHistory(7)`. Shows a spinner while loading and surfaces a friendly "no history found" message when the table is empty for that window. Available at any time during normal chat use, not just on sign-in.
- **`startNewSession` is now non-destructive by default**: Used to wipe the entire `chat_history` table for the user every time it ran (which would have killed the new 7-day restore feature). Now takes an `opts: { keepServerHistory?: boolean }` argument and defaults to `keepServerHistory: true` — server-side history is preserved unless something explicitly requests a hard wipe (no current call site does, and the option is documented in-line for future destructive flows). All existing call sites work as-is; the in-header reset button explicitly passes `{ keepServerHistory: true }`.

## Recent Updates (v2.2.7 — 2026-04-28)
- **Password reset & verify emails — actually delivered now**: The v2.2.6 implementation tried to "pre-check whether the email belongs to a real user" via `admin.listUsers({ perPage:1, filter:'email.eq.X' })`. `supabase-js` doesn't actually support that `filter` parameter — it returned the *first user in the system* and called every other email "not found", silently returning success without sending the email. Both `/api/auth/reset-password` and `/api/auth/resend-verification` now skip the broken pre-check and call `admin.generateLink` directly; "user not found" / "already confirmed" errors are mapped to silent success (so account existence still isn't leaked) and every real account now triggers a Resend send.
- **Push + inbox notification on admin credit grants**: The admin endpoint `POST /api/users/:id/credits` was only emitting an internal admin dashboard broadcast — users got no push and no inbox row when AdRoom topped them up. It now calls `pushService.notifyCreditsAwarded` for credits and a dedicated "Energy Credits Adjusted" push for deductions, so the change shows up on the user's device and in their Notifications screen in realtime.

## Recent Updates (v2.2.6 — 2026-04-28)
- **Email delivery rewritten — Resend direct API**: Switching to the anon-key client in v2.2.5 still relied on Supabase's broken SMTP relay. We now bypass Supabase email entirely. New `backend/src/services/resendEmailService.ts` POSTs branded HTML emails straight to Resend's `/emails` endpoint. `/api/auth/register` now uses `admin.createUser({email_confirm:false})` + `admin.generateLink({type:'signup'})` to mint a verification link, then sends via Resend. Same pattern for `/api/auth/reset-password` (admin.generateLink type 'recovery') and `/api/auth/resend-verification`. **Required Railway env vars: `RESEND_API_KEY` and `RESEND_FROM_EMAIL`** (verified sender, e.g. `AdRoom AI <noreply@adroomai.com>`).
- **Connected accounts persist across signOut→signIn**: `authStore.signOut()` no longer calls `agentStore.clearAll()` — connected platforms / tokens / chat history stay in memory + AsyncStorage so the same user signing back in keeps their state. `lastUserId` is now persisted to AsyncStorage (`adroom-auth-last-user-id`) so we can detect a *genuine* identity change (different user logging in on same device) across app restarts and wipe stale state only then. `loadConnectedPlatforms()` is still re-called on every sign-in / token-refresh as defense-in-depth.
- **Trial-grant push notification**: `energyService.grantTrial()` now fires `pushService.notifyTrialStarted()` so users get a device push when their 14-day trial begins. New generic `pushService.notifyCreditsAwarded()` helper for any future credit grant without a dedicated notifier.
- **Settings → Notifications unread badge (realtime)**: `SettingsScreen` now subscribes to `user_notifications` via Supabase Realtime and shows a red unread badge + "N unread" sublabel on the Notifications row. Updates the moment a push arrives or a notification is marked read.
- **Notification detail modal cleanup**: Removed the "Details" metadata block (raw key/value dump of `notification.data`) from `NotificationsScreen` modal. Modal now shows only the title, timestamp, and body.

## Recent Updates (v2.2.5 — 2026-04-27)
- **Email delivery (anon-key attempt)**: Sign-up confirmation and password-reset emails were silently never being sent because `/api/auth/register`, `/api/auth/reset-password` and `/api/auth/resend-verification` were calling Supabase Auth using the **service-role** client. Service role bypasses Supabase's email-sending pipeline (it's meant for admin ops), so `signUp()` / `resetPasswordForEmail()` / `resend()` returned success but the configured SMTP provider was never invoked. New `getAnonSupabaseClient()` helper in `backend/src/config/supabase.ts` returns an anon-key client with no auth header, and all three endpoints now use it. Errors mentioning "smtp"/"sending"/"email" are now surfaced to the client as HTTP 502 with a clear message + `code: 'EMAIL_DELIVERY_FAILED'` (instead of the previous silent success). **Superseded by v2.2.6** which bypasses Supabase email entirely.
- **Connected accounts persist across login/logout**: `signOut()` still wipes the in-memory `agentStore` (so account-A data never bleeds into account-B), but `authStore.initialize()` now calls `loadConnectedPlatforms()` on initial session restore, and the `onAuthStateChange` handler calls it on every `SIGNED_IN` / `TOKEN_REFRESHED` / `USER_UPDATED` event. This re-hydrates `connectedPlatforms` from the user's `ad_configs` rows in Supabase via `GET /api/platform-configs`, so the Connected Accounts screen always reflects the database truth — connected platforms stay connected after logout + login until the user explicitly disconnects them.

## Recent Updates (v2.2.4 — 2026-04-26)
- **Custom Alerts (UX)**: New `src/components/InlineAlert.tsx` reusable modal (success/error/warning/info variants). `LoginScreen` no longer uses native `Alert.alert` — sign-in errors are mapped to friendly titles ("Incorrect email or password", "Verify your email first", "Too many attempts", "Connection problem") shown via InlineAlert. Forgot-password errors and validation also routed through InlineAlert.
- **Onboarding/Auth nav**: `OnboardingScreen` uses `navigation.navigate(...)` (not `replace`) so back-stack works on Login/Signup. `SignupScreen`'s "Sign In" link routes via `navigation.navigate('Login')`.
- **AboutScreen**: Hero retitled "Intelligent Marketing Framework". The four agent cards (Salesman / Lead Capture / Promotion / Brand Awareness) now describe each as **intelligence** (not "agent").
- **SideMenu name resolution**: Fetches `profiles.username` and `profiles.full_name` and falls back to `user_metadata` so signed-in users see their real name instead of "User".
- **Credits banner**: `AgentChatScreen` credits-exhausted banner uses `paddingBottom: Math.max(12, insets.bottom + 8)` so it clears the home indicator on iPhone X+.
- **Per-user state isolation**: `agentStore` now exposes `clearAll()` (resets in-memory state + AsyncStorage `adroom-agent-store`). `authStore` tracks `lastUserId` and calls `useAgentStore.getState().clearAll()` on `signOut()` and on user-identity change in `onAuthStateChange` so account-A's chat history, strategy, and tokens never bleed into account-B.
- **Plan downgrade enforcement (admin)**: `PUT /admin/api/users/:id/plan` now (a) deletes excess `ad_configs` keeping only the most-recent N allowed by the new plan, (b) broadcasts `platform_disconnected` per removed platform via `adminBroadcast`, (c) sends a push notification via `pushService.send` with smart copy (welcome / upgrade / downgrade / ended), and (d) returns `removed_platforms` in the JSON response. `GET /admin/api/users` now exposes `email_confirmed_at` + `email_verified`.
- **Platform-config tier guard**: New `GET /api/platform-configs/check?platform=X` returns `{allowed, plan, limit, used, already_connected, reason}` based on `SUBSCRIPTION_PLAN_LIMITS.platforms` (starter=1, pro=2, pro_plus=99). New `POST /api/platform-configs/notify` lets the client tell the admin SSE stream that an OAuth-completed platform was just connected. `DELETE /api/platform-configs/:platform` now also broadcasts `platform_disconnected`.
- **agentStore.handleAccountSelection**: Calls `/api/platform-configs/check` *before* invoking `<Service>.saveConfig(...)` and surfaces the server's friendly upgrade message in chat instead of silently failing on RLS. After a successful save, fires `/api/platform-configs/notify` (fire-and-forget) so the admin dashboard sees the new connection in realtime.

## Recent Updates (v2.2.3 — 2026-04-26)
- **Backend URL**: Switched from Railway to `https://backend.adroomai.com` in `eas.json` (3 envs) and `app.json` extra.apiUrl. Bumped version to 2.2.3.
- **strategies.status column**: Added migration `supabase/migrations/20260426000000_strategies_status_column.sql` (DEFAULT 'active' + index). Run via `supabase db push` to apply remotely.
- **Splash & Routing**: New `AuthLoadingSkeleton` (animated logo, glow, pulse dots) shown for ≥2.2s on auth resolve. After login, `AppNavigator` initialRouteName='Main' and DrawerNavigator opens `Dashboard` if `hasActiveStrategy`, otherwise `AgentChat`. Reset-password screen self-redirects to Main if URL lacks reset payload (no more "Verifying" hang).
- **Active strategy check**: `authStore.checkActiveStrategy()` runs on session restore + sign-in to query `strategies?status=eq.active`.
- **Onboarding**: 6 features inspired by AboutScreen, new tagline + stats, "Get Started" routes to Signup.
- **Auth screens**: Removed "AdRoom AI" hero text from Login & Signup, softened Signup title to `#E2E8F0`. Signup uses BACKEND_URL with `Constants.expoConfig.extra.apiUrl` fallback. LoginScreen "Forgot password" first calls backend `/api/auth/reset-password` (service-role) before falling back to client SDK.
- **Backend auth hardening**: `/api/auth/register` now does `admin.listUsers({filter})` pre-check and treats `identities=[]` as duplicate (prevents re-registering an existing email). Added `/api/auth/reset-password` using service role.
- **Rebrand**: "Agent" → "Intelligence" in AgentChatScreen header, SideMenu label, and CampaignList empty-state CTA. AgentChatScreen now renders `AgentChatSkeleton` until message history finishes loading.

## Android Push Notifications (April 2026)
Root cause of "works when open, silent when closed": Expo deprecated legacy FCM in mid-2024; without an FCM v1 service-account key uploaded at expo.dev → Credentials → Android, Google silently drops every notification to a closed Android app. **See `ANDROID_PUSH_SETUP.md` for the full 5-step user-facing fix.**

Codebase pieces wired up:
- `app.json` android section references `./google-services.json`, declares `POST_NOTIFICATIONS`/`WAKE_LOCK`/`RECEIVE_BOOT_COMPLETED`/`VIBRATE`, sets `useNextNotificationsApi: true`.
- `backend/src/services/pushService.ts` sends every push with `priority: 'high'`; `sendTest(userId)` returns full Expo response including ticket details, error summary and raw body.
- `backend/src/server.ts` exposes `POST /api/push/test` (auth required) → returns `{ success, diagnosis, actionable, tokensFound, devices, expo:{…} }`. Diagnoses MismatchSenderId, InvalidCredentials (no FCM v1 key), DeviceNotRegistered, and "no token registered" with a plain-English next step.
- `src/screens/NotificationsScreen.tsx` — paper-airplane icon in header runs the diagnostic and shows the result in `Alert.alert`.

## Landing-page Forms (April 2026)
- `landing/submit-bug.php` and `landing/submit-feature.php` — drop-in PHP for cPanel (no Composer / no installs). Uses cURL → Resend HTTPS API. JSON file logging (`bug-reports.json`, `feature-requests.json`), per-IP rate limit (5/10 min), branded HTML emails. Configurable via env vars or hard-coded constants at the top of the file.
- `landing/help.html`, `landing/request-feature.html`, `landing/report-bug.html` — fully responsive (1024/900/768/600/380 breakpoints, `clamp()` typography, safe-area insets, ≥46px tap targets, proper mobile select/input styling, autocomplete attributes). Feature/Bug pages POST JSON to their PHP endpoints with proper error handling and reference-ID success messages.

## Recent Feature Additions
- **Plan Gating**: "Sales" and "Leads" goals are Pro-only; "Connect Website" in ProductIntakeCard is Pro-only — shows dimmed UPGRADE TO PRO label and routes to Subscription screen
- **MemPalace Integration**: `agentStore` saves every chat message to backend `/api/chat/history` (POST with `role`/`content`/`metadata`) and loads history from backend first, falling back to Supabase. Messages are mapped between agent format (text/sender/ui_type/ui_data) and backend format (content/role/metadata)
- **Currency Sync**: `handleProductIntake` and `handleServiceIntake` in agentStore sync `currency`/`name`/`price` to `strategyCreationStore` so PaidEquivalentValue displays the correct currency symbol
- **Admin Panel**: `/api/users` fetches `platform_configs` count per user (exposed as `connected_accounts`); admin HTML table now shows a "Connected" column in the user list (both thead and tbody row)
- **First-launch Permissions**: `OnboardingScreen` requests notification and location permissions on first mount (iOS: alert/badge/sound/announcements; both platforms: foreground location). `expo-notifications` and `expo-location` added to dependencies and configured in `app.json` plugins with custom permission strings

## Running the Mobile App Locally
```bash
# Install dependencies
npm install

# Start Expo (connects to Replit backend)
npx expo start

# On your device: open Expo Go → scan QR code
# Make sure EXPO_PUBLIC_API_URL points to your Replit backend URL
```
