/**
 * Public Auth Pages
 * -----------------
 * Email links from Resend (signup verification, password reset) are opened in
 * whatever browser the user's mail client uses. On desktop, deep links like
 * `adroom://verified` either open nothing or fall back to Supabase's default
 * Site URL (often `localhost:3000`) which 404s.
 *
 * To fix this from the root, every email-action `redirectTo` now points at
 * one of the two HTML pages served here:
 *
 *   GET /auth/verified         — signup verified success page (with deep link)
 *   GET /auth/reset-password   — password-reset form (uses recovery token from
 *                                URL hash to set a new password via supabase-js
 *                                loaded from a CDN)
 *
 * These pages work on both desktop browsers AND mobile (the "Open in App"
 * button uses the `adroom://` scheme on mobile so users land back inside
 * their app).
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

const SHARED_HEAD = `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>AdRoom AI</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      background: radial-gradient(120% 80% at 50% 0%, #0F172A 0%, #0B0F19 60%, #020617 100%);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #E2E8F0; padding: 24px;
    }
    .card {
      width: 100%; max-width: 460px;
      background: linear-gradient(180deg, #0F172A 0%, #0B0F19 100%);
      border: 1px solid #1E293B; border-radius: 20px;
      padding: 36px 28px; text-align: center;
      box-shadow: 0 30px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,240,255,0.05);
    }
    .logo { font-size: 22px; font-weight: 800; color: #00F0FF; letter-spacing: 0.5px; }
    .tag { color: #94A3B8; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 6px; margin-bottom: 28px; }
    .icon-wrap {
      width: 64px; height: 64px; margin: 0 auto 20px;
      border-radius: 18px; display: flex; align-items: center; justify-content: center;
      background: rgba(0,240,255,0.08); border: 1px solid rgba(0,240,255,0.25);
    }
    .icon-wrap.error { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.3); }
    .icon-wrap.success { background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.3); }
    h1 { color: #F8FAFC; font-size: 22px; font-weight: 700; margin: 0 0 10px; }
    p { color: #CBD5E1; font-size: 14px; line-height: 1.6; margin: 0 0 18px; }
    .small { color: #64748B; font-size: 12px; margin-top: 18px; }
    label { display: block; text-align: left; color: #94A3B8; font-size: 12px; font-weight: 600; margin: 12px 0 6px; }
    input[type=password] {
      width: 100%; background: #0B0F19; border: 1px solid #1E293B; border-radius: 12px;
      padding: 14px 16px; color: #E2E8F0; font-size: 15px; outline: none;
      transition: border-color 0.15s ease;
    }
    input[type=password]:focus { border-color: #00F0FF; }
    .btn {
      display: inline-block; width: 100%; padding: 14px 22px;
      background: linear-gradient(135deg, #00F0FF 0%, #0EA5E9 100%);
      color: #020617; font-weight: 700; font-size: 15px;
      border: none; border-radius: 12px; cursor: pointer; text-decoration: none;
      transition: transform 0.1s ease, opacity 0.15s ease;
      margin-top: 18px;
    }
    .btn:hover { opacity: 0.92; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.secondary {
      background: transparent; color: #00F0FF;
      border: 1px solid rgba(0,240,255,0.3); margin-top: 10px;
    }
    .alert { padding: 12px 14px; border-radius: 10px; font-size: 13px; margin-top: 14px; text-align: left; }
    .alert.error { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); color: #FCA5A5; }
    .alert.success { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); color: #6EE7B7; }
    .hide { display: none !important; }
    svg { width: 30px; height: 30px; }
  </style>
`;

function shellHeader(): string {
  return `
    <div class="logo">AdRoom AI</div>
    <div class="tag">Intelligent Marketing Framework</div>
  `;
}

/**
 * GET /auth/verified
 * Landing page after Supabase confirms the signup token.
 * Supabase appends `#access_token=...&type=signup` (success) or
 * `?error=...&error_description=...` (failure) to this URL.
 */
router.get('/auth/verified', (_req: Request, res: Response) => {
  const html = `<!doctype html>
<html lang="en">
<head>${SHARED_HEAD}</head>
<body>
  <div class="card">
    ${shellHeader()}

    <div id="success-view">
      <div class="icon-wrap success">
        <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h1>Email verified</h1>
      <p>Your AdRoom AI account is now active. Open the app to sign in and start strategizing.</p>
      <a id="open-app" href="adroom://verified" class="btn">Open AdRoom AI</a>
      <p class="small">If nothing happens, you can simply open the AdRoom AI app on your phone — your account is already verified.</p>
    </div>

    <div id="error-view" class="hide">
      <div class="icon-wrap error">
        <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h1>Verification problem</h1>
      <p id="error-msg">This verification link is no longer valid. It may have expired or already been used.</p>
      <a href="adroom://login" class="btn">Open AdRoom AI</a>
      <p class="small">If your email is already verified, just open the app and sign in. Otherwise, request a new verification email from the sign-in screen.</p>
    </div>
  </div>

  <script>
    (function () {
      try {
        var url = new URL(window.location.href);
        var hash = (window.location.hash || '').replace(/^#/, '');
        var hashParams = new URLSearchParams(hash);
        var errFromQuery = url.searchParams.get('error') || url.searchParams.get('error_code');
        var errFromHash = hashParams.get('error') || hashParams.get('error_code');
        var errDescription = url.searchParams.get('error_description') || hashParams.get('error_description');

        if (errFromQuery || errFromHash) {
          document.getElementById('success-view').classList.add('hide');
          document.getElementById('error-view').classList.remove('hide');
          if (errDescription) {
            document.getElementById('error-msg').textContent = decodeURIComponent(errDescription.replace(/\\+/g, ' '));
          }
          return;
        }

        // Success — try the deep link automatically once for installed-app users.
        setTimeout(function () {
          try { window.location.href = 'adroom://verified'; } catch (_) {}
        }, 600);
      } catch (_) { /* leave default success view */ }
    })();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * GET /auth/reset-password
 * Form to set a new password. Supabase appends `#access_token=...&type=recovery`
 * to this URL after the user clicks the email link. We load supabase-js from a
 * CDN, set the session from the hash, then call updateUser with the new
 * password. No server-side handling required — keeps the recovery token client
 * side and means the page is fully self-contained.
 */
router.get('/auth/reset-password', (_req: Request, res: Response) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(`<!doctype html><html><head>${SHARED_HEAD}</head><body><div class="card">${shellHeader()}<div class="icon-wrap error"></div><h1>Service unavailable</h1><p>Password reset is temporarily unavailable. Please contact support.</p></div></body></html>`);
    return;
  }

  // Safe to expose: anon key + project URL are PUBLIC (they ship in every
  // mobile build and every Supabase JS browser app). Service role is NEVER
  // sent to the page.
  const safeUrl = JSON.stringify(supabaseUrl);
  const safeKey = JSON.stringify(supabaseAnonKey);

  const html = `<!doctype html>
<html lang="en">
<head>${SHARED_HEAD}</head>
<body>
  <div class="card">
    ${shellHeader()}

    <div id="form-view">
      <div class="icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      </div>
      <h1>Reset your password</h1>
      <p>Choose a new password for your AdRoom AI account. You'll be signed in automatically once it's saved.</p>

      <form id="reset-form" autocomplete="off">
        <label for="password">New password</label>
        <input type="password" id="password" name="password" minlength="8" placeholder="At least 8 characters" required />
        <label for="confirm">Confirm new password</label>
        <input type="password" id="confirm" name="confirm" minlength="8" placeholder="Repeat your new password" required />
        <div id="alert-box"></div>
        <button id="submit-btn" type="submit" class="btn">Save new password</button>
      </form>
    </div>

    <div id="success-view" class="hide">
      <div class="icon-wrap success">
        <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h1>Password updated</h1>
      <p>Your password has been changed. You can now sign in to AdRoom AI with your new password.</p>
      <a href="adroom://login" class="btn">Open AdRoom AI</a>
    </div>

    <div id="error-view" class="hide">
      <div class="icon-wrap error">
        <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      </div>
      <h1>Reset link problem</h1>
      <p id="link-error-msg">This password-reset link is no longer valid. It may have expired or already been used.</p>
      <a href="adroom://login" class="btn">Open AdRoom AI</a>
      <p class="small">Open the app and tap "Forgot password" to request a fresh link.</p>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    (async function () {
      var SB_URL = ${safeUrl};
      var SB_KEY = ${safeKey};
      var formView = document.getElementById('form-view');
      var successView = document.getElementById('success-view');
      var errorView = document.getElementById('error-view');
      var linkErrorMsg = document.getElementById('link-error-msg');
      var alertBox = document.getElementById('alert-box');
      var submitBtn = document.getElementById('submit-btn');

      function showLinkError(msg) {
        formView.classList.add('hide');
        errorView.classList.remove('hide');
        if (msg) linkErrorMsg.textContent = msg;
      }

      function showAlert(kind, msg) {
        alertBox.innerHTML = '<div class="alert ' + kind + '">' + msg + '</div>';
      }

      // Parse hash + query for tokens / errors.
      var hash = (window.location.hash || '').replace(/^#/, '');
      var hashParams = new URLSearchParams(hash);
      var queryParams = new URLSearchParams(window.location.search);
      var errCode = queryParams.get('error') || queryParams.get('error_code') || hashParams.get('error') || hashParams.get('error_code');
      var errDesc = queryParams.get('error_description') || hashParams.get('error_description');
      if (errCode) {
        showLinkError(errDesc ? decodeURIComponent(errDesc.replace(/\\+/g, ' ')) : undefined);
        return;
      }

      var accessToken = hashParams.get('access_token');
      var refreshToken = hashParams.get('refresh_token');
      var type = hashParams.get('type');
      if (!accessToken || type !== 'recovery') {
        showLinkError('This page can only be opened from a password-reset email. Request a new link from the AdRoom AI app.');
        return;
      }

      var supabase = window.supabase.createClient(SB_URL, SB_KEY);
      try {
        var setRes = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' });
        if (setRes.error) {
          showLinkError(setRes.error.message);
          return;
        }
      } catch (e) {
        showLinkError('We couldn\\'t verify your reset link. Please request a new one.');
        return;
      }

      document.getElementById('reset-form').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        alertBox.innerHTML = '';
        var pwd = document.getElementById('password').value;
        var confirm = document.getElementById('confirm').value;
        if (pwd.length < 8) { showAlert('error', 'Password must be at least 8 characters.'); return; }
        if (pwd !== confirm) { showAlert('error', 'Passwords do not match.'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
        try {
          var res = await supabase.auth.updateUser({ password: pwd });
          if (res.error) {
            showAlert('error', res.error.message || 'We couldn\\'t update your password. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save new password';
            return;
          }
          // Success — sign out the temporary recovery session so it can't be
          // reused, then show the success view.
          try { await supabase.auth.signOut(); } catch (_) {}
          formView.classList.add('hide');
          successView.classList.remove('hide');
        } catch (e) {
          showAlert('error', 'Network error — please try again.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save new password';
        }
      });
    })();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
