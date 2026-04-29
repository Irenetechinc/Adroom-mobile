# Android Push Notifications — Setup Guide

If push notifications work when the AdRoom app is **open** but **stop arriving once the app is closed** on your Android phone, you're hitting the most common Android push problem in 2025.

The cause is almost always the same: **Expo can't talk to Google's FCM service on your behalf**, because the FCM v1 service-account key hasn't been uploaded to your Expo project. Expo deprecated the legacy FCM key in mid-2024 — without the new one, Google silently drops every notification destined for a closed app.

This guide walks you through fixing it end to end. No code changes required after this — everything is already wired up on the AdRoom side.

---

## Step 1 — Create (or open) a Firebase project

1. Go to **https://console.firebase.google.com/**.
2. Click **Add project** (or open your existing AdRoom Firebase project if you already have one).
3. Give it a name like `AdRoom AI`. Google Analytics is optional — you can skip it.

## Step 2 — Add your Android app to Firebase

1. In the Firebase project, click the Android icon (**Add app → Android**).
2. **Android package name** must be exactly: `com.adroom.mobile`
3. Nickname / SHA‑1 are optional — leave blank.
4. Click **Register app**.
5. Click **Download `google-services.json`**.
6. Place that file in the **root of this project** (next to `app.json`). The file is now wired up automatically by `app.json` — you don't need to edit anything.

> Skip the "Add Firebase SDK" and "Verify installation" steps shown by Firebase — Expo handles all of that for you.

## Step 3 — Generate the FCM v1 service account key (the critical step)

This is the step that fixes the closed-app problem.

1. In the Firebase Console, click the gear icon (top left) → **Project settings**.
2. Go to the **Service accounts** tab.
3. Click **Generate new private key** → **Generate key**.
4. A JSON file downloads. Keep it somewhere safe — **treat it like a password**.

## Step 4 — Upload that key to your Expo project

1. Go to **https://expo.dev/** and sign in.
2. Open your `adroom-mobile` project.
3. In the left sidebar: **Credentials**.
4. Pick the Android section.
5. Find **FCM V1 service account key** → **Add a service account key**.
6. Upload the JSON file you just downloaded from Firebase.

That's it. Expo will now use the new FCM v1 protocol, and notifications will be delivered to your phone whether the app is open, in the background, or fully closed.

## Step 5 — Rebuild the Android app

The `google-services.json` file gets bundled into the Android binary at build time, so you need a fresh build:

```bash
eas build --platform android --profile production
```

(or `--profile preview` for an internal test build).

Install the new APK/AAB on your phone, sign in once so the app can register a push token, and you're done.

---

## How to verify it's working

Once the new build is installed and you've signed in:

1. Open the app, go to **Settings → Notifications**.
2. Tap the **paper-airplane icon** in the top right of the Notifications screen.
3. You'll see one of three results:

| Result | What it means |
|---|---|
| **"Test push sent ✓"** | All good — close the app and the notification will pop up within a few seconds. |
| **"No active push tokens registered"** | The phone hasn't registered yet. Make sure you allowed notifications when the app first asked, then reopen the app. |
| **"Expo cannot reach FCM…"** | Step 4 above wasn't completed (or the wrong key was uploaded). Re-do step 3 + step 4. |
| **"FCM Sender ID mismatch"** | The `google-services.json` in the project doesn't match the Firebase project whose key you uploaded. Re-download the file from the same Firebase project. |
| **"DeviceNotRegistered"** | The phone's token has been invalidated (app was uninstalled, data cleared, etc.). Open the app on the device — a fresh token registers automatically. |

---

## Common gotchas

- **Expo Go does NOT receive remote push notifications since SDK 53** — you must use a real EAS build (`eas build`) to test push.
- **The package name must match exactly.** Anything other than `com.adroom.mobile` in Firebase will silently fail.
- **Battery optimisation on Samsung / Xiaomi / Huawei phones** can also kill background push. After install, go to Android Settings → Apps → AdRoom AI → Battery → set to **Unrestricted**. This is a phone-vendor issue, not an Expo issue.
- **You only need to do steps 1–4 once.** Future code releases just need a normal `eas build` — the credentials stay attached to your Expo project.

---

## Reference — what was changed in the codebase

- `app.json` — Android section now references `./google-services.json`, requests `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, and enables the next-gen notifications API.
- `backend/src/services/pushService.ts` — every push now sends with `priority: 'high'` so Android wakes the device, and a new `sendTest()` diagnostic returns Expo's full response so failures are visible.
- `backend/src/server.ts` — new `POST /api/push/test` endpoint (auth required) that runs the diagnostic and returns a plain-English explanation of what's wrong.
- `src/screens/NotificationsScreen.tsx` — paper-airplane icon in the header runs the diagnostic and shows the result in an alert dialog.
