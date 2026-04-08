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
