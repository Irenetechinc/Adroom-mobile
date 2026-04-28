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
