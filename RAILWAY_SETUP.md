# Railway production checklist

This project keeps the backend on Railway and the database on Supabase. The
production image is self-contained and must not depend on editor-hosted
services.

## Required Railway variables

Set these in the Railway service environment. Values are managed in Railway;
never commit them or print them in logs.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or the legacy `SUPABASE_KEY`, used for authenticated user requests)
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` and `SUPABASE_DB_PASSWORD` for the optional migration runner
- `SESSION_SECRET` or `ENCRYPTION_KEY`
- `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`
- `SIGNAL_CLI_PATH` if `signal-cli` is not available on `PATH` (defaults to `signal-cli`)
- `DELTA_CHAT_BRIDGE_URL`; optionally `DELTA_CHAT_BRIDGE_TOKEN`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` if admin controls are enabled
- `PUBLIC_BASE_URL`
- `EXPO_PUBLIC_API_URL` for the mobile build, pointing to the Railway API
- `DEEPKRAK3N_BASE_URL` (optional until the separate Deepkrak3n Railway service
  is deployed; use that service's public HTTPS URL, not this API URL)
- `JARVIS_BASE_URL` (optional until the separate J.A.R.V.I.S. Railway service
  is deployed; use that service's public HTTPS URL, not this API URL)
- `PROFILE_BUILDER_ENABLE_OSINTGRAPH=true` only after Osintgraph's vendored
  runtime has been installed and its Instagram/Neo4j credentials have been
  configured. The adapter is enabled by default in code, but remains
  unavailable until those credentials and dependencies are present.
- Configure Osintgraph through Railway variables
  `PROFILE_BUILDER_OSINTGRAPH_CREDENTIALS_JSON` or the individual
  `PROFILE_BUILDER_OSINTGRAPH_NEO4J_URI`,
  `PROFILE_BUILDER_OSINTGRAPH_NEO4J_USERNAME`,
  `PROFILE_BUILDER_OSINTGRAPH_NEO4J_PASSWORD`,
  `PROFILE_BUILDER_OSINTGRAPH_INSTAGRAM_USERNAME`, and optional
  `PROFILE_BUILDER_OSINTGRAPH_INSTAGRAM_USER_AGENT`. These are used only to
  create a short-lived mode-0600 runtime file for the upstream process; the
  file is removed immediately after each invocation and the values are never
  sent to the profile-builder adapters or target accounts.
- All existing AI, media, storage, OAuth, and payment variables used by the
  selected application features

## Public-profile service URLs

Deepkrak3n and J.A.R.V.I.S. are separate FastAPI services. In Railway, create
one service for each service directory, deploy the service's backend with a
start command such as `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
(Deepkrak3n) or `uvicorn main:app --host 0.0.0.0 --port $PORT`
(J.A.R.V.I.S.), then use Railway's generated public domain from that service's
Networking/Domains panel. Set:

```text
DEEPKRAK3N_BASE_URL=https://<deepkrak3n-service-domain>
JARVIS_BASE_URL=https://<jarvis-service-domain>
```

Verify the domains before adding them to the AdRoom API:

```bash
curl -fsS https://<deepkrak3n-service-domain>/health
curl -fsS https://<jarvis-service-domain>/api/health
curl -fsS https://<adroom-api-domain>/api/public-profile-tools/status?refresh=1
```

Do not use the AdRoom API domain for either variable. The backend only calls
these services over their public HTTPS endpoints and reports them unavailable
until the health checks pass.

## Runtime requirements

- Use `backend/Dockerfile` or the equivalent Railway Docker service.
- Keep one long-running process bound to Railway's `PORT` (the application
  defaults to 8000 locally).
- Ensure outbound HTTPS access, temporary filesystem access, and enough memory
  for Baileys, media work, and the retained WhatsApp socket.
- Install `signal-cli` in the final image when Signal is enabled. If it is not
  installed, the API must report Signal as unavailable rather than accepting a
  connection request.
- Configure safe restart behavior. The encrypted Supabase auth bundle restores
  provider sessions; WhatsApp still needs a live socket after restart for
  realtime inbound events.

## Verification still required in Railway

After variables and Supabase migrations are configured, verify `/api/health`,
each enabled connection flow, disconnect/reconnect, a selected personal
message, an inbound event, and push delivery from a current mobile build.
This repository has not performed those live provider checks, so local build
success must not be treated as production readiness.