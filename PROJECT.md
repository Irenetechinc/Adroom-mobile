# AdRoom — AI-Powered Autonomous Social Marketing Platform

AdRoom is a React Native/Expo mobile application with a Node.js/Express backend.
The mobile app uses Supabase Auth and Supabase PostgreSQL. The backend runs as a
long-lived Railway service and owns all provider credentials, scheduled jobs,
webhooks, AI calls, media processing, and autonomous campaign execution.

## Runtime layout

- Mobile app: Expo / React Native
- Backend: TypeScript, Express, port `8000` or Railway's `PORT`
- Database and authentication: Supabase
- Production API: configured with `EXPO_PUBLIC_API_URL`
- Production base URL: configured with `PUBLIC_BASE_URL`
- Delta Chat runtime: `backend/bin/deltachat-rpc-server`

## Local development

```bash
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_URL` to the deployed API URL for a device build. Do not
use a loopback URL in a production build.

To run the backend:

```bash
cd backend
npm ci --include=dev
npm run build
npm start
```

## Production deployment

The root `Dockerfile` builds the backend and copies the compiled application,
vendored tools, and Delta Chat RPC binary into the runtime image. The backend
Dockerfile provides the same standalone backend image for a service configured
from the `backend` directory.

Required production configuration is supplied through the Railway service
environment. Secrets must not be committed or printed. The database migrations
under `backend/` and `supabase/migrations/` are applied to the project's
Supabase database.

## Project conventions

- Use real provider APIs and real persisted state; do not add demo or mocked
  success paths.
- Keep provider credentials and opaque session material server-side.
- Surface errors explicitly.
- Keep mobile API calls pointed at `EXPO_PUBLIC_API_URL`.