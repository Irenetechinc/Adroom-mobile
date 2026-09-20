# Production provider setup

Apply `feature_strategy_logistics_migration.sql` and `feature_flags_migration.sql` in Supabase before enabling these flows.

## Twilio autonomous calling

Set these Railway variables on the backend service:

```text
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_COUNTRY=US
APP_URL=https://backend.adroomai.com
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_VOICE_IDS_BY_COUNTRY={"NG":"voice_id_for_nigeria","US":"voice_id_for_us","GB":"voice_id_for_uk"}
```

The app's canonical backend URL is `https://backend.adroomai.com`. The backend uses `PUBLIC_BASE_URL` if explicitly set, then `APP_URL`, then this canonical domain. `EXPO_PUBLIC_API_URL` is the mobile client's API URL and should also be set to `https://backend.adroomai.com`; it is not used as a provider webhook secret or credential.

`TWILIO_FROM_COUNTRY` must be an ISO country code where Twilio can purchase a voice-enabled local number for the account. Number purchase is automatic the first time a Pro/Pro+ user has an eligible, consented call. One number is stored per user in `user_phone_numbers`.

Configure these Twilio webhook URLs as a deployment fallback and for verification:

```text
POST https://backend.adroomai.com/api/webhooks/twilio/voice
POST https://backend.adroomai.com/api/webhooks/twilio/status
POST https://backend.adroomai.com/api/webhooks/twilio/recording
```

The application verifies `X-Twilio-Signature`. Calls are rejected unless the user is Pro/Pro+, active or trialing, has not opted out, and the lead has explicit call consent plus a phone number. Recording is enabled only on that consent-gated call path. Confirm local recording/automated-call laws before production use.

The backend scheduler must be running (`npm run start` runs the scheduler through the server startup) because queued calls are processed every minute.

ElevenLabs is optional for call audio. `ELEVENLABS_API_KEY` enables server-side speech generation. `ELEVENLABS_VOICE_ID` is the fallback voice. `ELEVENLABS_VOICE_IDS_BY_COUNTRY` is optional JSON; when present, Adirum selects the destination-country voice automatically. If it is omitted, Adirum queries the ElevenLabs voice catalog and selects a voice whose public labels match the destination country, then falls back to `ELEVENLABS_VOICE_ID`.

## Shipment provider

The current adapter is provider-neutral and expects a REST-compatible provider endpoint. Set:

```text
SHIPMENT_PROVIDER=gigl
SHIPMENT_API_URL=https://your-provider.example/api
SHIPMENT_API_KEY=...
SHIPMENT_WEBHOOK_SECRET=...
```

The adapter sends `POST {SHIPMENT_API_URL}/shipments` with `reference`, `pickup_address`, `delivery_address`, and `pickup_details`, and uses `Idempotency-Key: <shipment id>`.

Configure the provider webhook to:

```text
POST https://backend.adroomai.com/api/webhooks/shipments
```

Send the HMAC-SHA256 hex digest of the raw request body in `X-Shipment-Signature`. The provider must return one of `id`, `shipment_id`, or `reference`, and optionally `tracking_number` or `tracking_id`.

The current adapter is a contract adapter, not a claim that Travo, GIGL, Kwik, CourierPlus, Konga, Easyship, or another carrier shares this exact API. If your chosen carrier has a different schema, implement its mapping inside `shipmentService.ts` and test it in sandbox first.

## Required product/user setup

- Run both Supabase migrations.
- Ensure physical strategies have `dispatch_address`.
- Ensure lead records contain a verified `phone`/`phone_number`/`contact_phone` before calling can run.
- Set `call_consent = true` only after explicit consent is captured.
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
8. Confirm a physical payment confirmation creates and dispatches a shipment.
9. Confirm the carrier webhook appends tracking state.
10. Confirm a digital payment confirmation creates no shipment.
