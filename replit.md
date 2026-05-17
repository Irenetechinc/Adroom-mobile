# AdRoom — AI-Powered Autonomous Social Marketing Platform

## Project Overview
AdRoom is a **React Native (Expo) mobile app** with a Node.js/Express backend. It uses 4 specialized AI agents that autonomously execute organic social media marketing campaigns: post, reply, DM, edit, and delete — with no manual intervention needed.

## Architecture

### Mobile App (Expo / React Native)
- **Framework**: React Native with Expo SDK
- **Navigation**: React Navigation (Bottom Tabs + Stack)
- **State**: Zustand
- **Auth**: Supabase Auth
- **NOT a web app** — Replit hosts the backend only. Mobile app runs locally via Expo Go.

### Backend (Node.js / Express — Replit dev, Railway prod)
- **Port**: 8000
- **Language**: TypeScript (ts-node)
- **AI**: OpenAI GPT-4o (strategy) + Google Gemini 2.0 Flash (text) + Imagen 3 (creative)
- **Database**: Supabase (PostgreSQL)
- **Scheduler**: Autonomous task execution every 5 min

## Credit Management Agent (CMA)
- Intercepts all AI operations (evaluate → route → deduct) before execution
- Economy routing: lower-tier users get Gemini Flash instead of GPT-4o
- Dynamic override: if system burns >500 credits/hr, all users get economy routing
- Daily caps by tier: none=10, trial=20, starter=50, pro=250, pro_plus=∞
- Persists to `cma_savings_log` + `cma_monitor_log`; restores state on restart
- Admin: `GET /api/admin/cma/stats` | Live: `GET /api/cma/live-status`
- DB migration: `backend/cma_migration.sql`

## Autonomous Agent System

### 4 Agents
| Agent | Purpose |
|-------|---------|
| SALESMAN | Conversion, lead capture, DMs, Google Maps business outreach |
| AWARENESS | Viral reach, trending topics, shareability |
| PROMOTION | FOMO, scarcity, countdown urgency |
| LAUNCH | Product hype, announcements, narrative dominance |

### Intelligence Engines (every 15 min)
- **IPE** — Platform Intelligence, **Social Listening**, **Emotional Intelligence**, **GEO Monitoring**

### Autonomous Activities (all real API calls)
- Publish to Facebook / Instagram / Twitter / LinkedIn / TikTok
- Edit posts, reply to comments, send DMs on all platforms
- Fetch real performance metrics

## Key Backend Routes
| Route | Description |
|-------|------------|
| `POST /api/scrape` | AI-driven website scraping |
| `POST /api/ai/generate-strategy` | Full intelligence pipeline strategy |
| `POST /api/ai/activate-agents` | Start autonomous campaign execution |
| `GET /api/agents/status/:id` | Live agent status |
| `GET /api/platform-configs` | All connected platform statuses |
| `DELETE /api/platform-configs/:platform` | Disconnect a platform |
| `GET /api/notifications/unread-count` | Unread notification count |
| `GET /api/referrals/my-code` | Get/generate user's referral code |
| `GET /api/referrals/stats` | Referral statistics |
| `POST /api/referrals/apply-code` | Link a referral code to a new user |
| `GET /api/app/version` | Force-update / changelog check (public) |
| `POST /api/auth/facebook/exchange` | Facebook OAuth token exchange |

## Referral System (May 2026)
- Each user has a unique 8-char code in `profiles.referral_code`
- New user enters code at signup → stored in `referrals` table (status=pending)
- When referred user activates first plan → referrer earns 25 energy credits instantly
- Push notification sent to referrer on reward
- **DB migration**: `backend/referral_migration.sql` — run in Supabase SQL editor
- UI: Settings → "Refer & Earn" → `ReferralScreen` (share code, stats, how-it-works)

## Trial Modal (May 2026)
- `TrialPromoModal` shown on Dashboard for new users (<48 hr old, no prior plan)
- 3-plan radio selector (Starter / Pro / Pro+) with 48hr countdown
- Navigates to `SubscriptionScreen` with `autoStartTrial: planId` param
- `SubscriptionScreen` auto-fires `handleStartTrial(planId)` once `trialEligible` confirms

## Subscriptions / Billing
- Flutterwave payment links (WebView in-app) for all plans
- $2 card hold during trial to verify card; auto-charges on day 15
- `subscriptions_migration.sql` — adds missing columns; run in Supabase SQL editor

## Push Notifications
- Android: FCM v1 service-account key required at expo.dev → Credentials → Android
- Backend sends all pushes with `priority: 'high'`
- See `ANDROID_PUSH_SETUP.md` for full setup guide

## Environment Variables
### Backend (Replit secrets)
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `FB_APP_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`
- `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `GOOGLE_MAPS_API_KEY` (optional — Sales Agent Google Maps outreach)
- `PUBLIC_BASE_URL` (Railway — e.g. `https://api.adroomai.com`)

### Frontend (.env or Replit userenv)
- `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_FACEBOOK_APP_ID`, `EXPO_PUBLIC_TWITTER_CLIENT_ID`, `EXPO_PUBLIC_TIKTOK_CLIENT_KEY`

## Database (Supabase) — Key Tables
`ad_configs`, `strategies`, `agent_tasks`, `agent_performance`, `agent_leads`,
`agent_interventions`, `product_memory`, `user_memory`, `platform_intelligence`,
`social_conversations`, `emotional_ownership`, `narrative_snapshots`,
`subscriptions`, `payment_methods`, `energy_transactions`, `user_notifications`,
`referrals`, `profiles` (+ `referral_code` column), `app_releases`

## DB Migrations to Apply (Supabase SQL editor)
1. `backend/cma_migration.sql` — CMA tables
2. `backend/subscriptions_migration.sql` — subscription columns
3. `backend/referral_migration.sql` — profiles table (creates if missing) + referrals table + referral_code
4. `backend/ad_configs_migration.sql` — ad_configs missing columns (open_id, refresh_token, page_name, person_urn, org_urn, instagram_account_id)
5. `supabase/migrations/20260429000000_app_releases.sql` — force-update / changelog

## Backend Workflows
- **Backend API** → `cd backend && ts-node src/server.ts` on port 8000
- **Start application** → `node status-server.js` on port 5000 (status dashboard)

## Running the Mobile App Locally
```bash
npm install
npx expo start
# Open Expo Go on device → scan QR code
# Ensure EXPO_PUBLIC_API_URL points to your Replit/Railway backend URL
```

## User Preferences
- All code in TypeScript
- No placeholder/mock data — always real API calls
- Errors are surfaced explicitly, never silently swallowed
- SideMenu has paddingBottom: 120 to keep Energy item clear of Sign Out on small screens
