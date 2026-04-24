import { Resend } from 'resend';
import { getServiceSupabaseClient } from '../config/supabase';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'AdRoom AI <noreply@adroomai.com>';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!resend) {
  console.warn('[EmailService] RESEND_API_KEY not set — falling back to Supabase default mailer (unreliable).');
} else {
  console.log('[EmailService] Resend client initialized — branded emails active.');
}

const LOGO_URL = 'https://adroom.adroomai.com/wp-content/uploads/2026/04/CompressJPEG.Online_img512x512.jpg';

function brandedEmail(opts: { headline: string; preview: string; body: string; ctaText: string; ctaUrl: string; footerNote?: string }) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${opts.headline}</title></head>
<body style="margin:0;padding:0;background-color:#07090F;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#07090F;">${opts.preview}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#07090F;">
<tr><td align="center" style="padding:36px 16px 52px;">
  <table cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">
    <tr><td align="center" style="padding-bottom:32px;">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:10px;"><img src="${LOGO_URL}" alt="AdRoom AI" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:9px;"/></td>
        <td><span style="font-size:17px;font-weight:800;color:#FFFFFF;letter-spacing:-0.4px;">AdRoom <span style="color:#00F0FF;">AI</span></span></td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#0D1321;border:1px solid rgba(0,240,255,0.18);border-radius:24px;overflow:hidden;">
      <div style="height:3px;background:linear-gradient(90deg,#0E7490,#00F0FF,#A5F3FC,#00F0FF,#0E7490);"></div>
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td align="center" style="padding:44px 48px 0;">
          <img src="${LOGO_URL}" alt="AdRoom AI" width="80" height="80" style="display:block;width:80px;height:80px;border-radius:22px;border:2px solid rgba(0,240,255,0.3);"/>
        </td></tr></table>
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="padding:28px 48px 36px;" align="center">
          <h1 style="margin:0 0 16px;font-size:27px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;line-height:1.25;">${opts.headline}</h1>
          <div style="font-size:15px;color:#94A3B8;line-height:1.75;max-width:400px;margin-bottom:32px;">${opts.body}</div>
          <a href="${opts.ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#00F0FF 0%,#0891B2 100%);color:#0B0F19;font-size:16px;font-weight:800;text-decoration:none;border-radius:50px;padding:16px 44px;line-height:1;box-shadow:0 4px 20px rgba(0,240,255,0.25);">${opts.ctaText} →</a>
          <div style="border-top:1px solid rgba(255,255,255,0.07);margin:36px 0 26px;"></div>
          <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#4B5563;letter-spacing:0.8px;text-transform:uppercase;">Button not working? Copy this link</p>
          <div style="background:#080C16;border:1px solid rgba(0,240,255,0.12);border-radius:10px;padding:11px 14px;word-break:break-all;max-width:440px;margin:0 auto;">
            <a href="${opts.ctaUrl}" style="font-family:'Courier New',monospace;font-size:11px;color:#00F0FF;text-decoration:none;line-height:1.6;word-break:break-all;">${opts.ctaUrl}</a>
          </div>
        </td></tr></table>
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="padding:24px 48px 30px;">
          <p style="margin:0 0 6px;font-size:14px;color:#94A3B8;line-height:1.7;">${opts.footerNote || 'If you ever have questions, just reply — a real person reads every email.'}</p>
          <p style="margin:0;font-size:14px;color:#64748B;">— The AdRoom AI Team</p>
        </td></tr></table>
    </td></tr>
    <tr><td style="padding:20px 4px 0;">
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:14px 18px;">
        <p style="margin:0;font-size:12px;color:#64748B;line-height:1.65;"><strong style="color:#94A3B8;">🔒 Heads up:</strong> This link expires in 1 hour and works only once. If you didn't request this, just ignore this email.</p>
      </div>
    </td></tr>
    <tr><td align="center" style="padding:28px 8px 0;">
      <p style="margin:0;font-size:11px;color:#1E293B;line-height:1.7;">© ${new Date().getFullYear()} AdRoom AI · You received this because you have an account at adroomai.com</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export class EmailService {
  private async send(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
    if (!resend) {
      console.warn(`[EmailService] Skipping send to ${to} — Resend not configured.`);
      return { ok: false, error: 'Email service not configured (RESEND_API_KEY missing).' };
    }
    try {
      const { error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
      if (error) {
        console.error('[EmailService] Resend error:', error);
        return { ok: false, error: error.message };
      }
      console.log(`[EmailService] Sent "${subject}" to ${to}`);
      return { ok: true };
    } catch (e: any) {
      console.error('[EmailService] Exception:', e.message);
      return { ok: false, error: e.message };
    }
  }

  async sendVerificationEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    const svc = getServiceSupabaseClient();
    const { data, error } = await svc.auth.admin.generateLink({
      type: 'signup',
      email,
      options: { redirectTo: 'adroom://verified' },
    });
    if (error || !data?.properties?.action_link) {
      return { ok: false, error: error?.message || 'Could not generate verification link.' };
    }
    const html = brandedEmail({
      headline: "You're almost in 👋",
      preview: 'One quick tap and your AdRoom AI account is ready.',
      body: 'Thanks for signing up. Tap the button below to confirm your email and unlock your AI marketing engine.<br/><br/>Your first autonomous campaign is one confirmation away.',
      ctaText: 'Confirm My Email',
      ctaUrl: data.properties.action_link,
    });
    return this.send(email, 'Confirm your AdRoom AI account', html);
  }

  async sendPasswordResetEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    const svc = getServiceSupabaseClient();
    const { data, error } = await svc.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: 'adroom://reset-password' },
    });
    if (error || !data?.properties?.action_link) {
      return { ok: false, error: error?.message || 'Could not generate reset link.' };
    }
    const html = brandedEmail({
      headline: 'Reset your password',
      preview: 'Tap the link to choose a new password for AdRoom AI.',
      body: "We received a request to reset your AdRoom AI password.<br/><br/>Tap the button below to choose a new one. The link opens directly in the AdRoom AI app.",
      ctaText: 'Choose New Password',
      ctaUrl: data.properties.action_link,
      footerNote: 'Stay safe — never share this link with anyone.',
    });
    return this.send(email, 'Reset your AdRoom AI password', html);
  }
}

export const emailService = new EmailService();
