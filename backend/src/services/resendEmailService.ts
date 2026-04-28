/**
 * Resend Email Service
 * --------------------
 * Sends transactional emails (signup confirmation, password reset, verification
 * resend) DIRECTLY via Resend's HTTP API — bypassing Supabase's built-in email
 * pipeline entirely.
 *
 * Why we bypass Supabase's email pipeline:
 *   Supabase's SMTP relay to Resend was silently failing in production. The
 *   `signUp()` / `resetPasswordForEmail()` / `resend()` calls would either
 *   throw "error sending confirmation email" (and abort the whole user
 *   creation transaction) or return success with no email actually sent.
 *
 * The fix:
 *   1. Use Supabase's admin API to mint the user record + a signed action
 *      link (`admin.createUser`, `admin.generateLink`). These endpoints
 *      DON'T touch SMTP — they just return the link.
 *   2. Build a clean HTML email template and POST it to Resend's `/emails`
 *      endpoint with the API key. This guarantees delivery as long as the
 *      Resend domain is verified.
 *
 * Required env vars (set in Railway dashboard):
 *   - RESEND_API_KEY        Your Resend API key (re_…). https://resend.com/api-keys
 *   - RESEND_FROM_EMAIL     Verified sender address (e.g. "AdRoom AI <noreply@adroomai.com>")
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
  status?: number;
}

function getResendConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error(
      '[ResendEmail] Missing required env: ' +
        (!apiKey ? 'RESEND_API_KEY ' : '') +
        (!from ? 'RESEND_FROM_EMAIL' : ''),
    );
    return null;
  }
  return { apiKey, from };
}

/**
 * Low-level send via Resend HTTP API.
 */
export async function sendEmailViaResend(params: SendEmailParams): Promise<SendEmailResult> {
  const cfg = getResendConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        'Email service not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the Railway backend.',
    };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    const body: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = body?.message || body?.error || `Resend API ${res.status}`;
      console.error(`[ResendEmail] Send failed for ${params.to}:`, res.status, msg);
      return { ok: false, status: res.status, error: msg };
    }

    console.log(`[ResendEmail] Sent "${params.subject}" → ${params.to} (id: ${body?.id})`);
    return { ok: true, id: body?.id, status: res.status };
  } catch (e: any) {
    console.error('[ResendEmail] Network error:', e?.message);
    return { ok: false, error: e?.message || 'Unknown network error sending email.' };
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Branded HTML templates                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

const baseStyles = `
  <style>
    body { margin:0; padding:0; background:#0B0F19; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#E2E8F0; }
    .wrapper { max-width:560px; margin:0 auto; padding:32px 24px; }
    .card { background:linear-gradient(180deg,#0F172A 0%,#0B0F19 100%); border:1px solid #1E293B; border-radius:16px; padding:32px; }
    .logo { font-size:20px; font-weight:800; color:#00F0FF; letter-spacing:0.5px; margin-bottom:8px; }
    .tag { color:#94A3B8; font-size:12px; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:24px; }
    h1 { color:#F8FAFC; font-size:22px; font-weight:700; margin:0 0 12px; }
    p { color:#CBD5E1; font-size:14px; line-height:1.6; margin:0 0 16px; }
    .btn { display:inline-block; background:linear-gradient(135deg,#00F0FF 0%,#0EA5E9 100%); color:#020617 !important; font-weight:700; font-size:15px; padding:14px 28px; border-radius:10px; text-decoration:none; margin:8px 0 20px; }
    .small { color:#64748B; font-size:12px; line-height:1.5; }
    .footer { text-align:center; color:#475569; font-size:11px; margin-top:24px; }
    .link { color:#00F0FF; word-break:break-all; font-size:12px; }
  </style>
`;

function buildEmailShell(opts: {
  preview: string;
  heading: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  outro: string;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${opts.heading}</title>${baseStyles}</head>
<body>
  <span style="display:none;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${opts.preview}</span>
  <div class="wrapper">
    <div class="card">
      <div class="logo">AdRoom AI</div>
      <div class="tag">Intelligent Autonomus Marketing Framework</div>
      <h1>${opts.heading}</h1>
      <p>${opts.intro}</p>
      <a href="${opts.ctaUrl}" class="btn">${opts.ctaLabel}</a>
      <p class="small">${opts.outro}</p>
      <p class="small">If the button doesn't work, copy and paste this link into your browser:</p>
      <p class="link"><a href="${opts.ctaUrl}" style="color:#00F0FF;">${opts.ctaUrl}</a></p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} AdRoom AI · This email was sent because someone used your address to interact with AdRoom AI. If that wasn't you, ignore this email.</div>
  </div>
</body></html>`;
}

/**
 * Send signup-confirmation email. `actionLink` is what Supabase admin
 * generated via generateLink({type: 'signup'}).
 */
export async function sendSignupConfirmationEmail(
  to: string,
  actionLink: string,
): Promise<SendEmailResult> {
  return sendEmailViaResend({
    to,
    subject: 'Confirm your AdRoom AI account',
    html: buildEmailShell({
      preview: 'One tap to verify your email and unlock AdRoom AI.',
      heading: 'Confirm your email',
      intro:
        'Welcome to AdRoom AI. Tap the button below to verify your email address and finish setting up your account.',
      ctaLabel: 'Verify Email',
      ctaUrl: actionLink,
      outro: 'This verification link expires in 24 hours.',
    }),
    text: `Welcome to AdRoom AI.\n\nVerify your email address by visiting:\n${actionLink}\n\nThis link expires in 24 hours. If you didn't create an account, ignore this email.`,
  });
}

/**
 * Send password-reset email. `actionLink` is what Supabase admin
 * generated via generateLink({type: 'recovery'}).
 */
export async function sendPasswordResetEmail(
  to: string,
  actionLink: string,
): Promise<SendEmailResult> {
  return sendEmailViaResend({
    to,
    subject: 'Reset your AdRoom AI password',
    html: buildEmailShell({
      preview: 'Reset your AdRoom AI password — link valid for 1 hour.',
      heading: 'Reset your password',
      intro:
        'We received a request to reset the password on your AdRoom AI account. Tap the button below to choose a new password.',
      ctaLabel: 'Reset Password',
      ctaUrl: actionLink,
      outro:
        "This password-reset link expires in 1 hour. If you didn't request a reset, you can safely ignore this email — your password will stay the same.",
    }),
    text: `Reset your AdRoom AI password by visiting:\n${actionLink}\n\nThis link expires in 1 hour. If you didn't request a reset, ignore this email.`,
  });
}
