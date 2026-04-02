# AdRoom Mobile - Replit Setup

## Project Overview
AdRoom is a mobile-first AI-powered digital marketing platform built with React Native (Expo). It helps businesses create, manage, and optimize advertising campaigns across platforms like Facebook using AI automation.

## Architecture

### Frontend (Expo / React Native Web)
- **Framework**: React Native 0.81.5 with Expo SDK 54
- **Styling**: NativeWind (Tailwind CSS for React Native)
- **Navigation**: React Navigation (Bottom Tabs + Drawer + Stack)
- **State**: Zustand
- **Web**: Served as static export via `npx serve web-build -l 5000` on port 5000

### Backend (Node.js / Express)
- **Framework**: Express.js running on port 8000
- **Language**: TypeScript (compiled to `backend/dist/`)
- **AI**: OpenAI + Google Generative AI
- **Database**: Supabase (PostgreSQL)
- **Payments**: Flutterwave

## Workflows
- **Start application** - Serves static Expo web build on port 5000 (webview)
- **Backend API** - Node.js Express backend on port 8000 (console)

## Key Files
- `App.tsx` - Root component
- `app.json` - Expo configuration
- `metro.config.js` - Metro bundler config (NativeWind enabled)
- `src/` - React Native source code
  - `screens/` - App screens (Dashboard, Wallet, Agent Chat, etc.)
  - `navigation/` - Navigation structure
  - `services/` - API integrations (Facebook, Supabase)
  - `store/` - Zustand state stores
  - `types/` - TypeScript types
- `backend/src/` - Node.js backend source
  - `server.ts` - Express server entry point
  - `services/` - Business logic (AI, wallet, engagement)
  - `config/` - Supabase + AI model config

## Environment Variables
Defined in `.env` (frontend) and `backend/.env` (backend):
- `EXPO_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_URL` - Railway backend URL (production)
- `EXPO_PUBLIC_FACEBOOK_APP_ID`
- `OPENAI_API_KEY`
- `FB_VERIFY_TOKEN` / `FB_APP_ID`

## Build Commands
- **Web export**: `npx expo export --platform web --output-dir web-build`
- **Backend build**: `cd backend && npx tsc`
- **Frontend dev**: `npm run web` (dev server)

## Deployment
- Configured as **static** deployment
- Build: `npx expo export --platform web --output-dir web-build`
- Public dir: `web-build`
