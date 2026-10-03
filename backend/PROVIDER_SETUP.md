# Production provider setup

Apply `feature_strategy_logistics_migration.sql` and `feature_flags_migration.sql` in Supabase before enabling these flows. The logistics migration adds per-lead call-consent fields and the call/shipment tables; the flag migration controls the mobile calling and shipping screens.

## Core runtime configuration

Set backend values on the Railway backend service, not in the mobile app:

| Variable | Required for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Backend APIs | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Calls and shipments | Server-only key; never add an `EXPO_PUBLIC_` prefix or expose it to the app. |
| `SUPABASE_ANON_KEY` or `SUPABASE_KEY` | Authenticated API routes | Public/anon Supabase key used with the signed-in user token. |
| `PUBLIC_BASE_URL` or `APP_URL` | Provider webhooks | Public HTTPS backend URL. The code falls back to `https://backend.adroomai.com`; explicitly set this if using another domain. |
| `EXPO_PUBLIC_API_URL` | Mobile app | Set to the same public backend URL; it defaults to `https://backend.adroomai.com`. |

`GET /api/health/config` reports whether provider credentials are present and which variable names are missing. It never returns credential values. A healthy core API does not mean calling or shipping is configured.

For mobile authentication, also configure the app's public Supabase URL and anon key using its existing `EXPO_PUBLIC_` Supabase settings. Do not put the service-role key or any provider secret in mobile configuration. Enable the `calling_ui` and `shipping_ui` feature flags for the test user; subscription checks still apply to calling.

## Twilio autonomous calling

Set these Railway variables on the backend service. The first two are required for calls:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_COUNTRY=US
PUBLIC_BASE_URL=https://backend.adroomai.com
```

The app's canonical backend URL is `https://backend.adroomai.com`. The backend uses `PUBLIC_BASE_URL` if explicitly set, then `APP_URL`, then this canonical domain. `EXPO_PUBLIC_API_URL` is the mobile client's API URL and should also be set to `https://backend.adroomai.com`; it is not used as a provider webhook secret or credential.

## Public profile discovery services

The public-profile queue accepts usernames by default and uses the working public
web-search adapter whenever an optional tool is unavailable. On Railway, provide
the externally reachable base URLs for the separately managed services:

```text
DEEPKRAK3N_BASE_URL=https://<your-deepkrak3n-service>
JARVIS_BASE_URL=https://<your-jarvis-service>
```

These must be service URLs, not the AdRoom backend URL. The backend checks
`/health` for Deepkrak3n and `/api/health` for J.A.R.V.I.S with bounded timeouts.
The URLs are never sent to the mobile app, and upstream response bodies are not
included in status output.

Osintgraph is disabled unless `PROFILE_BUILDER_ENABLE_OSINTGRAPH=true` is set
after its public Instagram/Neo4j runtime is configured. Public email or phone
lookup is separately disabled unless
`PROFILE_BUILDER_ENABLE_PUBLIC_CONTACT_ENUMERATION=true` is explicitly set;
that mode accepts only explicit public contact identifiers and does not access
private or authenticated data.

`TWILIO_FROM_COUNTRY` must be an ISO country code where Twilio can purchase a voice-enabled local number for the account. Number purchase is automatic the first time a Pro/Pro+ user has an eligible, consented call. One number is stored per user in `user_phone_numbers`.

Configure these Twilio webhook URLs as a deployment fallback and for verification:

```text
POST https://backend.adroomai.com/api/webhooks/twilio/voice
POST https://backend.adroomai.com/api/webhooks/twilio/status
POST https://backend.adroomai.com/api/webhooks/twilio/recording
```

The application verifies `X-Twilio-Signature`. Calls are rejected unless the user is Pro/Pro+, active or trialing, has not opted out, and the lead has explicit call consent plus an E.164-formatted phone number. Record consent from the lead’s conversation screen only after the lead explicitly agrees to automated calls that may be recorded; public business listings do not count. Consent is checked again immediately before Twilio is called, so revocation blocks queued calls.

Twilio must have voice-enabled local number purchasing enabled for the selected country. The app purchases and stores one number per user on the first eligible call. Ensure the backend's public URL and Twilio callback URLs agree exactly so webhook signature verification succeeds.

The backend scheduler must be running (`npm run start` runs the scheduler through server startup) because queued calls are processed every minute. `SCHED_CALLS_CRON` can override the default call-processing schedule; it is not needed for the default setup.

The current call plays one generated prompt and records the lead's response; it does not yet conduct a two-way AI voice conversation.

ElevenLabs is optional. Without it, calls use Twilio speech. To enable generated speech, set `ELEVENLABS_API_KEY`; optionally set `ELEVENLABS_VOICE_ID` as a fallback and `ELEVENLABS_VOICE_IDS_BY_COUNTRY` as valid JSON, for example `{"NG":"voice_id_for_nigeria","US":"voice_id_for_us"}`. The `call-audio` Supabase Storage bucket must exist for generated audio.

## Shipment provider

The current adapter is provider-neutral and expects a REST-compatible provider endpoint. `SHIPMENT_PROVIDER`, `SHIPMENT_API_URL`, and `SHIPMENT_API_KEY` are required to dispatch. `SHIPMENT_WEBHOOK_SECRET` is required for authenticated tracking updates:

```text
SHIPMENT_PROVIDER=gigl
SHIPMENT_API_URL=https://your-provider.example/api
SHIPMENT_API_KEY=...
SHIPMENT_WEBHOOK_SECRET=...
```

The adapter sends `POST {SHIPMENT_API_URL}/shipments` with `reference`, `pickup_address`, `delivery_address`, and `pickup_details`, and uses `Idempotency-Key: <shipment id>`. Both addresses must be complete. If the buyer's delivery address was not captured earlier, the order remains pending and the owner can enter it in Orders & Shipping; dispatch starts only after it is saved.

Configure the provider webhook to:

```text
POST https://backend.adroomai.com/api/webhooks/shipments
```

Send the HMAC-SHA256 hex digest of the exact raw JSON request body in `X-Shipment-Signature`. The provider must return one of `id`, `shipment_id`, or `reference`, and optionally `tracking_number` or `tracking_id`. Include the local shipment `reference` (or the returned provider ID) in callbacks so the backend can match the shipment. Tracking events are appended rather than replaced.

The current adapter is a contract adapter, not a claim that Travo, GIGL, Kwik, CourierPlus, Konga, Easyship, or another carrier shares this exact API. If your chosen carrier has a different schema, implement its mapping inside `shipmentService.ts` and test it in sandbox first.

## Required product/user setup

- Run both Supabase migrations.
- Ensure physical strategies have `dispatch_address`.
- Ensure lead records contain a phone number in E.164 format (for example `+234...`) before calling can run.
- Record per-lead consent in the conversation screen only after explicit consent is captured.
- Keep `do_not_call = true` for users who disable calling.
- Use a real HTTPS `PUBLIC_BASE_URL`; localhost cannot receive provider webhooks.
- Test with Twilio and carrier sandbox accounts before enabling production credentials.

## End-to-end smoke tests

1. Create a Pro or Pro+ test user.
2. Set an eligible lead phone and explicit call consent.
3. Trigger an inbound lead reply with a call-worthy request.
4. Confirm a `queued` row appears in `call_logs`.
5. Confirm a per-user number appears in `user_phone_numbers`.
6. Confirm Twilio status callbacks update the call row.
7. Confirm the recording callback stores the recording URL.
8. Confirm a physical payment confirmation creates a shipment; without a buyer address it must remain pending rather than dispatch to a guessed address.
9. Enter the buyer’s address in Orders & Shipping and confirm dispatch; then confirm a signed carrier webhook appends tracking state.
10. Confirm a digital payment confirmation creates no shipment.
