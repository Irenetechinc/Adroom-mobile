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
- All existing AI, media, storage, OAuth, and payment variables used by the
  selected application features

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