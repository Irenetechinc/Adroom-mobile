# Facebook App Configuration Guide for AdRoom

To enable AdRoom to manage ads, reply to comments, and handle messages for your users, you must configure your Facebook App correctly in the [Meta for Developers Dashboard](https://developers.facebook.com/).

## 1. App Basic Settings
1.  Go to **Settings > Basic**.
2.  **App ID**: Copy this and set it as `EXPO_PUBLIC_FACEBOOK_APP_ID` in your mobile app's `.env`.
3.  **App Secret**: Do not share this. It may be needed for backend verification if you enable "App Secret Proof".
4.  **Privacy Policy URL**: Required for "Live" mode. You can host a simple policy page.
5.  **Category**: Select "Business and Pages".

## 2. Add Products
Add the following products to your app from the "Add Product" menu:
1.  **Facebook Login for Business**
2.  **Webhooks**
3.  **Marketing API** (Usually enabled automatically when requesting ad permissions)

## 3. Configure Facebook Login
1.  Go to **Facebook Login > Settings**.
2.  **Valid OAuth Redirect URIs**: 
    *   For Expo development, you might not need to add anything if using `expo-auth-session` with a custom scheme.
    *   If you deploy a web version, add your domain here.
3.  **Login for Devices**: Disable if not needed.

## 4. Webhooks Setup (CRITICAL for Real-time)
1.  Go to **Webhooks**.
2.  Select **Page** from the dropdown menu.
3.  Click **Edit Subscription**.
    *   **Callback URL**: `https://<YOUR-RAILWAY-APP-URL>/webhooks/facebook`
        *   *Replace `<YOUR-RAILWAY-APP-URL>` with your actual deployed backend URL.*
    *   **Verify Token**: `adroom_verify_token` 
        *   *This MUST match the `FB_VERIFY_TOKEN` environment variable you set in Railway.*
4.  **Subscribe to Fields**:
    *   `feed`: For comments, posts, and likes.
    *   `messages`: For private messages.
    *   `messaging_postbacks`: For button clicks in chat.

## 5. Permissions (App Review)
For your app to work with **any user** (not just you), you must request "Advanced Access" for these permissions via **App Review > Permissions and Features**:

| Permission | Purpose |
| :--- | :--- |
| `public_profile` | Get user's name and ID. |
| `email` | Get user's email. |
| `pages_show_list` | List the Pages the user manages. |
| `pages_read_engagement` | Read content posted on the Page. |
| `pages_manage_posts` | Create posts and comments as the Page. |
| `pages_manage_ads` | Create and manage ads for the Page. |
| `pages_messaging` | Send and receive private messages as the Page. |
| `ads_management` | Create and manage ads. |
| `ads_read` | Read ad account data. |
| `read_insights` | Access ad performance metrics. |

*Note: While in "Development Mode", these permissions work automatically for any account listed in "Roles" (Admin, Developer, Tester). You only need App Review to go "Live" for the general public.*

## 6. Railway Deployment Settings (CRITICAL)
Since this project is a monorepo (Frontend + Backend), you **MUST** tell Railway to look in the `backend` folder.

1.  Go to your **Railway Project Dashboard**.
2.  Click on your service (AdRoom).
3.  Go to **Settings**.
4.  Find **Root Directory** (under "Service" or "Build" section).
5.  Change it from `/` to `/backend`.
6.  **Save** and let it redeploy.

**Without this step, Railway tries to run the Mobile App instead of the Backend Server, and Facebook Webhooks will fail.**

## 7. Railway Environment Variables
Ensure your Railway project has these variables set:
*   `FB_VERIFY_TOKEN`: `adroom_verify_token` (or whatever you chose)
*   `OPENAI_API_KEY`: Your OpenAI Key
*   `SUPABASE_URL`: Your Supabase Project URL
*   `SUPABASE_SERVICE_KEY`: Your Supabase Service Role Key (starts with `ey...`)

---
**Verification**
1.  Deploy your backend to Railway.
2.  Set up the Webhook as described in Step 4. If Facebook saves it successfully, your backend is verified!
3.  Log in to the mobile app with a Facebook account (added as a Tester in Step 5 if in Dev mode).
4.  Comment on a Page managed by that user. AdRoom should auto-like and reply!
