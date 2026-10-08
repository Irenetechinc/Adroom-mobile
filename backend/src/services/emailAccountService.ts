import crypto from 'crypto';
import dns from 'dns/promises';
import { isIP } from 'net';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { getServiceSupabaseClient } from '../config/supabase';
import { cleanReplyWithTalon } from './emailReplyCleaner';
import {
  hasDkimKey,
  hasEnforcedDmarcPolicy,
  hasValidSpf,
  isProviderManagedSenderDomain,
} from './emailDnsPolicy';

type MailTransport = {
  provider: 'gmail' | 'yahoo' | 'icloud' | 'aol' | 'imap' | 'microsoft365';
  imapHost?: string;
  smtpHost?: string;
  imapPort?: number;
  smtpPort?: number;
  imapSecure?: boolean;
  secure?: boolean;
};

export interface CleanEmailReply {
  externalId: string;
  providerMessageId: string;
  internetMessageId?: string;
  sender: string;
  subject: string;
  text: string;
  receivedAt: string;
  inReplyTo?: string;
}

export interface EmailConnectionStatus {
  connected: boolean;
  status: string;
  address?: string;
  displayName?: string;
  provider?: string;
  lastError?: string;
}

export interface EmailProviderDetection {
  provider: string;
  authMethod: 'oauth' | 'app_password' | 'password';
}

export interface EmailDnsDiagnostics {
  domain: string;
  spf: 'configured' | 'missing' | 'unavailable';
  dmarc: 'configured' | 'missing' | 'unavailable';
  dkim: 'detected' | 'not_detected' | 'unavailable';
  providerManaged: boolean;
  checkedAt: string;
}

export class EmailSendPolicyError extends Error {}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const MICROSOFT_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'office365.com']);
const CLIENT_ID_ENV = 'EMAIL_MICROSOFT_CLIENT_ID';
const CLIENT_SECRET_ENV = 'EMAIL_MICROSOFT_CLIENT_SECRET';
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const OAUTH_ROOT = 'https://login.microsoftonline.com/common/oauth2/v2.0';
function normalizeAddress(value: unknown): string {
  const address = String(value || '').trim().toLowerCase();
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error('Enter a valid email address.');
  }
  return address;
}

function stableEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('Email connections require a stable SESSION_SECRET or ENCRYPTION_KEY.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value: unknown): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', stableEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(row: any): any {
  if (!row?.credential_ciphertext || !row?.credential_iv || !row?.credential_tag) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', stableEncryptionKey(), Buffer.from(row.credential_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.credential_tag, 'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(row.credential_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
}

function normalizedMx(mxRows: Array<{ exchange: string }> = []): string[] {
  return mxRows.map((row) => row.exchange.toLowerCase().replace(/\.$/, ''));
}

async function settingsForAddress(address: string): Promise<MailTransport> {
  const domain = address.split('@')[1];
  if (GMAIL_DOMAINS.has(domain)) {
    return { provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, secure: true };
  }
  if (MICROSOFT_DOMAINS.has(domain)) return { provider: 'microsoft365' };
  if (domain === 'yahoo.com' || domain.endsWith('.yahoo.com')) {
    return { provider: 'yahoo', imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, secure: true };
  }
  if (domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com') {
    return { provider: 'icloud', imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587, secure: false };
  }
  if (domain === 'aol.com') {
    return { provider: 'aol', imapHost: 'imap.aol.com', imapPort: 993, smtpHost: 'smtp.aol.com', smtpPort: 465, secure: true };
  }
  if (domain === 'zoho.com' || domain.endsWith('.zoho.com') || domain === 'zoho.eu') {
    return { provider: 'imap', imapHost: 'imap.zoho.com', imapPort: 993, smtpHost: 'smtp.zoho.com', smtpPort: 465, secure: true };
  }
  if (domain === 'fastmail.com' || domain === 'fastmail.fm') {
    return { provider: 'imap', imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 465, secure: true };
  }
  if (domain === 'gmx.com' || domain === 'gmx.net' || domain === 'gmx.de') {
    return { provider: 'imap', imapHost: 'imap.gmx.com', imapPort: 993, smtpHost: 'mail.gmx.com', smtpPort: 465, secure: true };
  }
  if (domain === 'proton.me' || domain === 'protonmail.com' || domain === 'pm.me') {
    throw new Error('Proton Mail requires Proton Bridge and is not available through a standard mailbox password.');
  }

  try {
    const mx = normalizedMx(await dns.resolveMx(domain));
    if (mx.some((host) => host.includes('.mail.protection.outlook.com'))) return { provider: 'microsoft365' };
    if (mx.some((host) => host.includes('google.com') || host.includes('googlemail.com'))) {
      return { provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, secure: true };
    }
    if (mx.some((host) => host.includes('yahoodns.net'))) {
      return { provider: 'yahoo', imapHost: 'imap.mail.yahoo.com', imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, secure: true };
    }
  } catch {
    // MX discovery is advisory. Generic providers are still tested against
    // standard hostnames before credentials are persisted.
  }

  const resolveSrv = async (name: string) => {
    try {
      return (await dns.resolveSrv(name)).sort((a, b) => a.priority - b.priority);
    } catch {
      return [];
    }
  };
  const [imaps, imap, submissions, submission, smtps] = await Promise.all([
    resolveSrv(`_imaps._tcp.${domain}`),
    resolveSrv(`_imap._tcp.${domain}`),
    resolveSrv(`_submissions._tcp.${domain}`),
    resolveSrv(`_submission._tcp.${domain}`),
    resolveSrv(`_smtps._tcp.${domain}`),
  ]);
  const imapRecord = imaps[0] || imap[0];
  const smtpRecord = submissions[0] || smtps[0] || submission[0];
  if (imapRecord && smtpRecord && imapRecord.name !== '.' && smtpRecord.name !== '.') {
    return {
      provider: 'imap',
      imapHost: imapRecord.name.replace(/\.$/, ''),
      imapPort: imapRecord.port,
      imapSecure: Boolean(imaps[0]),
      smtpHost: smtpRecord.name.replace(/\.$/, ''),
      smtpPort: smtpRecord.port,
      secure: Boolean(submissions[0] || smtps[0]),
    };
  }

  return {
    provider: 'imap',
    imapHost: `imap.${domain}`,
    imapPort: 993,
    smtpHost: `smtp.${domain}`,
    smtpPort: 465,
    secure: true,
  };
}

function publicStatus(row: any): EmailConnectionStatus {
  const metadata = row?.metadata || {};
  return {
    connected: row?.status === 'connected',
    status: row?.status || 'disconnected',
    address: row?.account_id || undefined,
    displayName: row?.display_name || undefined,
    provider: metadata.mail_provider || undefined,
    lastError: row?.last_error || undefined,
  };
}

function graphErrorText(payload: any): string {
  return String(payload?.error?.message || payload?.error_description || payload?.message || 'Microsoft email request failed.').slice(0, 240);
}

function isNonPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    return normalized === '::' || normalized === '::1'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized) || normalized.startsWith('::ffff:');
  }
  return true;
}

function extractHeader(headers: any[], name: string): string | undefined {
  const target = name.toLowerCase();
  const header = headers.find((entry) => String(entry?.name || '').toLowerCase() === target);
  return header?.value ? String(header.value) : undefined;
}

export function isEmailOptOut(value: string): boolean {
  const message = String(value || '').trim().toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ');
  return /\b(?:unsubscribe|opt[ -]?out)\b/.test(message)
    || /\bremove me(?: from (?:this )?(?:mailing )?list)?\b/.test(message)
    || /^\s*(?:please )?stop\s*$/.test(message)
    || /\b(?:stop|cease) (?:emailing|contacting|messaging|sending (?:me )?emails?)\b/.test(message)
    || /\b(?:do not|don't) (?:email|contact|message) (?:me|us)\b/.test(message);
}

function isUnsubscribeSubject(value: string): boolean {
  return /^\s*(?:unsubscribe|stop|opt[ -]?out)\s*[.!]?\s*$/i.test(String(value || ''));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class EmailAccountService {
  private readonly supabase = getServiceSupabaseClient();
  private readonly dnsDiagnosticCache = new Map<string, { result: EmailDnsDiagnostics; cachedAt: number }>();

  async detectProvider(rawAddress: unknown): Promise<EmailProviderDetection> {
    const address = normalizeAddress(rawAddress);
    const settings = await settingsForAddress(address);
    return {
      provider: settings.provider,
      authMethod: settings.provider === 'microsoft365'
        ? 'oauth'
        : settings.provider === 'gmail'
          ? 'app_password'
          : 'password',
    };
  }

  private async accountRow(userId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('social_account_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'email')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  }

  private async resumeExpiredCooldown(userId: string): Promise<any | null> {
    const row = await this.accountRow(userId);
    if (!row) return null;
    const cooldownAt = row.cooldown_until ? new Date(row.cooldown_until).getTime() : NaN;
    const cooldownExpired = Number.isFinite(cooldownAt) && cooldownAt <= Date.now();
    const legacyTransientError = row.status === 'error'
      && !row.cooldown_until
      && Number(row.consecutive_errors || 0) < 3;
    if (!((row.status === 'paused' && cooldownExpired)
      || (row.status === 'error' && cooldownExpired)
      || legacyTransientError)) return row;

    const { error } = await this.supabase
      .from('social_account_connections')
      .update({
        status: 'connected',
        cooldown_until: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', 'email');
    if (error) throw new Error(`Email account recovery failed: ${error.message}`);
    return { ...row, status: 'connected', cooldown_until: null, last_error: null };
  }

  async status(userId: string): Promise<EmailConnectionStatus> {
    return publicStatus(await this.accountRow(userId));
  }

  async diagnoseDomain(userId: string): Promise<EmailDnsDiagnostics | null> {
    const row = await this.resumeExpiredCooldown(userId);
    if (!row || row.status !== 'connected' || !row.account_id) return null;
    const domain = normalizeAddress(row.account_id).split('@')[1];
    const cached = this.dnsDiagnosticCache.get(domain);
    if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) return cached.result;
    const readTxt = async (host: string): Promise<{ records: string[]; available: boolean }> => {
      try {
        const result = await dns.resolveTxt(host);
        return { records: result.map((parts) => parts.join('')), available: true };
      } catch {
        return { records: [], available: false };
      }
    };
    const [root, dmarc, ...dkim] = await Promise.all([
      readTxt(domain),
      readTxt(`_dmarc.${domain}`),
      ...['google', 'selector1', 'selector2', 'default', 's1', 's2', 'k1', 'dkim', 'zoho', 'mail', 's1024', 's2048'].map((selector) =>
        readTxt(`${selector}._domainkey.${domain}`)),
    ]);
    const anyDkim = dkim.some((result) => hasDkimKey(result.records));
    const providerManaged = isProviderManagedSenderDomain(domain);
    const result: EmailDnsDiagnostics = {
      domain,
      spf: hasValidSpf(root.records) ? 'configured' : root.available ? 'missing' : 'unavailable',
      dmarc: hasEnforcedDmarcPolicy(dmarc.records) ? 'configured' : dmarc.available ? 'missing' : 'unavailable',
      dkim: anyDkim ? 'detected' : dkim.some((result) => result.available) ? 'not_detected' : 'unavailable',
      providerManaged,
      checkedAt: new Date().toISOString(),
    };
    this.dnsDiagnosticCache.set(domain, { result, cachedAt: Date.now() });
    return result;
  }

  async assertSenderDomainReady(userId: string): Promise<void> {
    const diagnostics = await this.diagnoseDomain(userId);
    if (!diagnostics) {
      const row = await this.accountRow(userId);
      if (!row) throw new Error('Connect an email account before sending.');
      if (row.status === 'needs_reconnect') throw new Error('Reconnect the email account before sending.');
      if (row.status === 'paused') {
        if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) {
          throw new Error('Email sending is temporarily paused while the mailbox cools down.');
        }
        throw new Error('Email sending is paused. Reconfigure the mailbox before sending again.');
      }
      if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) {
        throw new Error('Email sending is temporarily paused while the mailbox cools down.');
      }
      throw new Error('The email account is not ready to send.');
    }
    if (diagnostics.providerManaged) return;

    const missing: string[] = [];
    if (diagnostics.spf !== 'configured') missing.push('a valid SPF record');
    if (diagnostics.dkim !== 'detected') missing.push('a detected DKIM key');
    if (diagnostics.dmarc !== 'configured') missing.push('a DMARC quarantine or reject policy');
    if (missing.length) {
      throw new Error(
        `Email sending is paused for ${diagnostics.domain}. Configure ${missing.join(', ')} with your mail or DNS provider, then refresh the account checks.`,
      );
    }
  }

  private async saveAccount(userId: string, address: string, provider: string, credential: any): Promise<EmailConnectionStatus> {
    const encrypted = encrypt(credential);
    const now = new Date().toISOString();
    const { data: previousConnection, error: previousConnectionError } = await this.supabase
      .from('social_account_connections')
      .select('account_id,warmup_started_at')
      .eq('user_id', userId)
      .eq('provider', 'email')
      .maybeSingle();
    if (previousConnectionError) throw new Error(previousConnectionError.message);
    const warmupStartedAt = previousConnection?.account_id === address
      ? previousConnection.warmup_started_at || now
      : now;
    const { error } = await this.supabase.from('social_account_connections').upsert({
      user_id: userId,
      provider: 'email',
      account_id: address,
      display_name: address,
      handle: address,
      status: 'connected',
      credential_ciphertext: encrypted.ciphertext,
      credential_iv: encrypted.iv,
      credential_tag: encrypted.tag,
      metadata: { mail_provider: provider },
      // `reserve_social_action` applies the progressive email warm-up below.
      // Keep the mature per-mailbox ceiling here so the counter can grow after
      // the six-week ramp without changing this row again.
      daily_limit: 45,
      actions_today: 0,
      action_day: new Date().toISOString().slice(0, 10),
      consecutive_errors: 0,
      cooldown_until: null,
      warmup_started_at: warmupStartedAt,
      last_error: null,
      updated_at: now,
    }, { onConflict: 'user_id,provider' });
    if (error) throw new Error(error.message);
    const { error: configError } = await this.supabase.from('ad_configs').upsert({
      user_id: userId,
      platform: 'email',
      access_token: 'connected',
      connection_type: 'personal',
      account_id: address,
      page_name: address,
      updated_at: now,
    }, { onConflict: 'user_id,platform' });
    if (configError) throw new Error(configError.message);
    return this.status(userId);
  }

  async connectWithPassword(userId: string, rawAddress: unknown, rawPassword: unknown): Promise<{
    connection?: EmailConnectionStatus;
    requiresOAuth?: boolean;
    authUrl?: string;
  }> {
    const address = normalizeAddress(rawAddress);
    const password = String(rawPassword || '');
    const settings = await settingsForAddress(address);
    if (settings.provider === 'microsoft365') return { requiresOAuth: true };
    if (!password || password.length > 512) throw new Error('Enter your email password or provider app password.');
    for (const host of [settings.imapHost, settings.smtpHost].filter(Boolean) as string[]) {
      try {
        const resolved = await dns.lookup(host, { all: true, verbatim: true });
        if (!resolved.length || resolved.some((item) => isNonPublicIp(item.address))) {
          throw new Error('non_public_mail_host');
        }
      } catch {
        throw new Error('Automatic email server discovery could not verify this provider. Contact support to confirm provider compatibility.');
      }
    }

    const imap = new ImapFlow({
      host: settings.imapHost!,
      port: settings.imapPort!,
      secure: settings.imapSecure ?? true,
      doSTARTTLS: !(settings.imapSecure ?? true),
      auth: { user: address, pass: password },
      logger: false,
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 15000,
    });
    let transporter: any;
    try {
      transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.secure,
        requireTLS: !settings.secure,
        auth: { user: address, pass: password },
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 15000,
      });
      await Promise.all([imap.connect(), transporter.verify()]);
      await imap.logout();
      await transporter.close();
    } catch {
      await imap.logout().catch(() => {});
      transporter?.close?.();
      if (settings.provider === 'gmail') {
        throw new Error('Gmail rejected the connection. Use a Google App Password; your regular Google password will not work.');
      }
      throw new Error('Email sign-in failed. Check the address and password, or use the provider’s app password if required.');
    }

    const connection = await this.saveAccount(userId, address, settings.provider, {
      type: 'imap_smtp',
      address,
      password,
      settings,
    });
    return { connection };
  }

  async createMicrosoftOAuthUrl(userId: string, rawAddress: unknown, redirectUri: string): Promise<string> {
    const address = normalizeAddress(rawAddress);
    const clientId = String(process.env[CLIENT_ID_ENV] || '').trim();
    if (!clientId || !process.env[CLIENT_SECRET_ENV]) {
      throw new Error('Microsoft email sign-in is not configured on this server yet.');
    }
    const state = crypto.randomBytes(32).toString('hex');
    const { error } = await this.supabase.from('email_oauth_states').insert({
      state,
      user_id: userId,
      email: address,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error('Could not start Microsoft email sign-in.');
    const url = new URL(`${OAUTH_ROOT}/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', 'openid profile offline_access User.Read Mail.ReadWrite Mail.Send');
    url.searchParams.set('state', state);
    url.searchParams.set('login_hint', address);
    return url.toString();
  }

  async finishMicrosoftOAuth(state: string, code: string, redirectUri: string): Promise<void> {
    const { data: pending, error: lookupError } = await this.supabase
      .from('email_oauth_states')
      .select('state,user_id,email,expires_at')
      .eq('state', state)
      .maybeSingle();
    if (lookupError || !pending || new Date(pending.expires_at).getTime() < Date.now()) {
      throw new Error('Microsoft email sign-in expired. Please connect again.');
    }
    await this.supabase.from('email_oauth_states').delete().eq('state', state);

    const body = new URLSearchParams({
      client_id: String(process.env[CLIENT_ID_ENV]),
      client_secret: String(process.env[CLIENT_SECRET_ENV]),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: 'openid profile offline_access User.Read Mail.ReadWrite Mail.Send',
    });
    const tokenResponse = await fetch(`${OAUTH_ROOT}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const token: any = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
      throw new Error(graphErrorText(token));
    }
    const profileResponse = await fetch(`${GRAPH_ROOT}/me?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(12000),
    });
    const profile: any = await profileResponse.json().catch(() => ({}));
    if (!profileResponse.ok) throw new Error(graphErrorText(profile));
    const address = normalizeAddress(profile.mail || profile.userPrincipalName || pending.email);
    await this.saveAccount(pending.user_id, address, 'microsoft365', {
      type: 'microsoft_graph',
      address,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    });
  }

  async disconnect(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('social_account_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'email');
    if (error) throw new Error(error.message);
    await this.supabase.from('ad_configs').delete().eq('user_id', userId).eq('platform', 'email');
  }

  async setWarmupLimit(userId: string): Promise<void> {
    const row = await this.accountRow(userId);
    if (!row || row.status !== 'connected') return;
    const started = new Date(row.warmup_started_at || row.connected_at).getTime();
    const days = Math.max(0, Math.floor((Date.now() - started) / 86400000));
    const limit = days < 7 ? 5
      : days < 14 ? 10
        : days < 21 ? 15
          : days < 28 ? 20
            : days < 35 ? 25
              : days < 42 ? 35
                : 45;
    if (Number(row.daily_limit) !== limit) {
      await this.supabase.from('social_account_connections').update({ daily_limit: limit })
        .eq('user_id', userId).eq('provider', 'email');
    }
  }

  private async saveRefreshedCredential(userId: string, credential: any): Promise<void> {
    const encrypted = encrypt(credential);
    await this.supabase.from('social_account_connections').update({
      credential_ciphertext: encrypted.ciphertext,
      credential_iv: encrypted.iv,
      credential_tag: encrypted.tag,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', 'email');
  }

  private async refreshedGraphToken(userId: string, credential: any): Promise<string> {
    if (Number(credential.expiresAt || 0) > Date.now() + 2 * 60 * 1000) return credential.accessToken;
    const body = new URLSearchParams({
      client_id: String(process.env[CLIENT_ID_ENV]),
      client_secret: String(process.env[CLIENT_SECRET_ENV]),
      grant_type: 'refresh_token',
      refresh_token: String(credential.refreshToken || ''),
      scope: 'openid profile offline_access User.Read Mail.ReadWrite Mail.Send',
    });
    const response = await fetch(`${OAUTH_ROOT}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const token: any = await response.json().catch(() => ({}));
    if (!response.ok || !token.access_token) throw new Error('Microsoft email authorization expired. Reconnect the account.');
    credential.accessToken = token.access_token;
    credential.refreshToken = token.refresh_token || credential.refreshToken;
    credential.expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000;
    await this.saveRefreshedCredential(userId, credential);
    return credential.accessToken;
  }

  private async graphRequest(userId: string, credential: any, url: string, init: RequestInit = {}): Promise<any> {
    const accessToken = await this.refreshedGraphToken(userId, credential);
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: init.signal || AbortSignal.timeout(15000),
    });
    const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: any = new Error(graphErrorText(result));
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async pollReplies(userId: string, onReply: (reply: CleanEmailReply) => Promise<boolean>): Promise<void> {
    const row = await this.resumeExpiredCooldown(userId);
    if (!row || row.status !== 'connected') return;
    if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) return;
    const credential = decrypt(row);
    if (!credential) {
      await this.supabase.from('social_account_connections').update({
        status: 'needs_reconnect',
        last_error: 'Email credentials could not be decrypted. Reconnect this account.',
      }).eq('user_id', userId).eq('provider', 'email');
      return;
    }
    try {
      if (credential.type === 'microsoft_graph') {
        await this.pollMicrosoft(userId, credential, onReply);
      } else {
        await this.pollImap(credential, onReply);
      }
      if (Number(row.consecutive_errors || 0) > 0 || row.cooldown_until) {
        await this.supabase.from('social_account_connections').update({
          consecutive_errors: 0,
          cooldown_until: null,
          last_error: null,
          status: 'connected',
        }).eq('user_id', userId).eq('provider', 'email');
      }
    } catch (error: any) {
      const count = Number(row.consecutive_errors || 0) + 1;
      const requiresReconnect = Number(error?.status) === 401 || Number(error?.status) === 403
        || /authentication|credentials|invalid grant|authorization expired/i.test(String(error?.message || ''));
      const cooldownUntil = requiresReconnect
        ? null
        : new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * Math.pow(2, Math.min(count - 1, 4)))).toISOString();
      await this.supabase.from('social_account_connections').update({
        status: requiresReconnect ? 'needs_reconnect' : count >= 3 ? 'paused' : 'connected',
        consecutive_errors: count,
        cooldown_until: cooldownUntil,
        last_error: requiresReconnect
          ? 'Email authorization expired. Reconnect this account.'
          : 'Email inbox polling failed; retrying after a cooldown.',
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('provider', 'email');
      throw new Error(requiresReconnect
        ? 'Email authorization expired. Reconnect this account.'
        : 'Email inbox check failed; the account is cooling down before another attempt.');
    }
  }

  private async pollImap(credential: any, onReply: (reply: CleanEmailReply) => Promise<boolean>): Promise<void> {
    const settings = credential.settings as MailTransport;
    const client = new ImapFlow({
      host: settings.imapHost!,
      port: settings.imapPort!,
      secure: settings.imapSecure ?? true,
      doSTARTTLS: !(settings.imapSecure ?? true),
      auth: { user: credential.address, pass: credential.password },
      logger: false,
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const unseen = await client.search({ seen: false }, { uid: true });
        const uids = Array.isArray(unseen) ? unseen.slice(-20) : [];
        if (!uids.length) return;
        for await (const item of client.fetch(uids.join(','), {
          uid: true,
          source: true,
          internalDate: true,
        }, { uid: true })) {
          if (!item.source) continue;
          const parsed = await simpleParser(item.source);
          const from = parsed.from?.value?.[0]?.address?.toLowerCase();
          if (!from) continue;
          const cleaned = await cleanReplyWithTalon(String(parsed.text || ''), String(parsed.html || ''));
          const replyText = cleaned || (isUnsubscribeSubject(String(parsed.subject || '')) ? 'unsubscribe' : '');
          if (!replyText) continue;
          const headers = parsed.headers;
          const reply: CleanEmailReply = {
            externalId: String(parsed.messageId || `imap:${item.uid}`),
            providerMessageId: String(item.uid),
            internetMessageId: parsed.messageId ? String(parsed.messageId) : undefined,
            sender: from,
            subject: String(parsed.subject || '').slice(0, 300),
            text: replyText.slice(0, 12000),
            receivedAt: new Date(item.internalDate || Date.now()).toISOString(),
            inReplyTo: String(headers.get('in-reply-to') || '') || undefined,
          };
          if (await onReply(reply)) {
            await sleep(900 + Math.floor(Math.random() * 2100));
            await client.messageFlagsAdd(item.uid, ['\\Seen'], { uid: true });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }

  private async pollMicrosoft(userId: string, credential: any, onReply: (reply: CleanEmailReply) => Promise<boolean>): Promise<void> {
    const url = `${GRAPH_ROOT}/me/mailFolders/inbox/messages?$top=20&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,body,internetMessageId,internetMessageHeaders,isRead`;
    const result = await this.graphRequest(userId, credential, url);
    for (const item of (result.value || []).reverse()) {
      if (item.isRead || !item.id) continue;
      const sender = String(item.from?.emailAddress?.address || '').toLowerCase();
      if (!sender) continue;
      const contentType = String(item.body?.contentType || '').toLowerCase();
      const clean = await cleanReplyWithTalon(
        contentType === 'text' ? String(item.body?.content || '') : '',
        contentType === 'html' ? String(item.body?.content || '') : '',
      );
      const replyText = clean || (isUnsubscribeSubject(String(item.subject || '')) ? 'unsubscribe' : '');
      if (!replyText) continue;
      const headers = item.internetMessageHeaders || [];
      const reply: CleanEmailReply = {
        externalId: String(item.internetMessageId || item.id),
        providerMessageId: String(item.id),
        internetMessageId: item.internetMessageId ? String(item.internetMessageId) : undefined,
        sender,
        subject: String(item.subject || '').slice(0, 300),
        text: replyText.slice(0, 12000),
        receivedAt: String(item.receivedDateTime || new Date().toISOString()),
        inReplyTo: extractHeader(headers, 'in-reply-to'),
      };
      if (await onReply(reply)) {
        await sleep(900 + Math.floor(Math.random() * 2100));
        await this.graphRequest(userId, credential, `${GRAPH_ROOT}/me/messages/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ isRead: true }),
        });
      }
    }
  }

  async sendForLead(
    userId: string,
    recipientValue: string,
    bodyValue: string,
    credential: any,
    leadId?: string,
    emailSubject?: string,
  ): Promise<void> {
    let recipient: string;
    try {
      recipient = normalizeAddress(recipientValue);
    } catch (error: any) {
      throw new EmailSendPolicyError(error?.message || 'Enter a valid email address.');
    }
    let leadQuery = this.supabase
      .from('agent_leads')
      .select('id,stage')
      .eq('user_id', userId)
      .eq('platform', 'email')
      .eq('platform_user_id', recipient)
      .order('last_contacted_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (leadId) leadQuery = leadQuery.eq('id', leadId);
    const { data: lead, error: leadError } = await leadQuery.maybeSingle();
    if (leadError || !lead) throw new EmailSendPolicyError('Email can only be sent to a lead in this account’s email conversation list.');
    if (['lost', 'won'].includes(String(lead.stage || '').toLowerCase())) {
      throw new EmailSendPolicyError('This email conversation is closed and cannot be contacted.');
    }
    const { data: history } = await this.supabase
      .from('lead_dm_messages')
      .select('direction,created_at,meta')
      .eq('lead_id', lead.id)
      .eq('user_id', userId)
      .eq('platform', 'email')
      .order('created_at', { ascending: false })
      .limit(30);
    const latestInbound = (history || []).find((message: any) => message.direction === 'inbound');
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const recentOutbound = (history || []).filter((message: any) =>
      message.direction === 'outbound' && String(message.created_at || '') >= dayAgo,
    );
    if (recentOutbound.length >= 1) throw new EmailSendPolicyError('The daily limit for this email recipient has been reached.');

    let text = String(bodyValue || '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw new EmailSendPolicyError('Email message is empty.');
    const words = text.split(/\s+/);
    if (words.length > 80) text = `${words.slice(0, 79).join(' ')}…`;
    const linkScanText = text.replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' ');
    const links = linkScanText.match(/(?:https?:\/\/|www\.)\S+|\b(?:[\da-z-]+\.)+[a-z]{2,}(?:\/\S*)?/gi) || [];
    if (links.length > 1) throw new EmailSendPolicyError('Email messages may contain no more than one link.');
    const firstOutbound = recentOutbound.length === 0;
    if (firstOutbound && links.length > 0) throw new EmailSendPolicyError('The first email to a new contact cannot include a link.');
    const lastInboundMeta = latestInbound?.meta || {};
    const safePreviousSubject = String(lastInboundMeta.email_subject || 'A quick question')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 140);
    const generatedSubject = String(emailSubject || '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 8)
      .join(' ')
      .slice(0, 100);
    const subject = latestInbound
      ? (safePreviousSubject.toLowerCase().startsWith('re:')
        ? safePreviousSubject
        : `Re: ${safePreviousSubject}`)
      : generatedSubject || this.subjectFromMessage(text);

    if (credential.type === 'microsoft_graph') {
      if (lastInboundMeta.microsoft_message_id) {
        await this.graphRequest(userId, credential, `${GRAPH_ROOT}/me/messages/${encodeURIComponent(String(lastInboundMeta.microsoft_message_id))}/reply`, {
          method: 'POST',
          body: JSON.stringify({ comment: text }),
        });
      } else {
        await this.graphRequest(userId, credential, `${GRAPH_ROOT}/me/sendMail`, {
          method: 'POST',
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'Text', content: text },
              toRecipients: [{ emailAddress: { address: recipient } }],
            },
            saveToSentItems: true,
          }),
        });
      }
      return;
    }

    const settings = credential.settings as MailTransport;
    const transport: any = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.secure,
      requireTLS: !settings.secure,
      auth: { user: credential.address, pass: credential.password },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
    try {
      const messageId = `<${crypto.randomUUID()}@${credential.address.split('@')[1]}>`;
      const sent = await transport.sendMail({
        from: credential.address,
        to: recipient,
        subject,
        text,
        messageId,
        ...(lastInboundMeta.internet_message_id ? {
          inReplyTo: String(lastInboundMeta.internet_message_id),
          references: String(lastInboundMeta.internet_message_id),
        } : {}),
        headers: {
          'Auto-Submitted': 'auto-generated',
          'List-Unsubscribe': `<mailto:${credential.address}?subject=unsubscribe>`,
        },
      });
      if (settings.provider === 'imap') {
        await this.saveSmtpCopyToSent(
          credential,
          String(sent?.messageId || messageId),
          recipient,
          subject,
          text,
          lastInboundMeta.internet_message_id ? String(lastInboundMeta.internet_message_id) : undefined,
        );
      }
    } finally {
      transport.close();
    }
  }

  private subjectFromMessage(body: string): string {
    const firstLine = String(body || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    const withoutGreeting = firstLine.replace(/^(?:hi|hello|dear)\s+[^,!]+[,!]?\s*/i, '').trim();
    const sentenceEnd = withoutGreeting.search(/[.!?](?:\s|$)/);
    const sentence = sentenceEnd >= 0 ? withoutGreeting.slice(0, sentenceEnd) : withoutGreeting;
    const subject = sentence.split(/\s+/).filter(Boolean).slice(0, 9).join(' ').replace(/[.!?]+$/g, '').trim();
    return (subject || 'A quick question').slice(0, 100);
  }

  private async saveSmtpCopyToSent(
    credential: any,
    messageId: string,
    recipient: string,
    subject: string,
    text: string,
    inReplyTo?: string,
  ): Promise<void> {
    const settings = credential.settings as MailTransport;
    const client = new ImapFlow({
      host: settings.imapHost!,
      port: settings.imapPort!,
      secure: settings.imapSecure ?? true,
      doSTARTTLS: !(settings.imapSecure ?? true),
      auth: { user: credential.address, pass: credential.password },
      logger: false,
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 20000,
    });
    try {
      await client.connect();
      const folders = await client.list();
      const sentFolder = folders.find((folder: any) => String(folder.specialUse || '').toLowerCase() === '\\sent')
        || folders.find((folder: any) => /(?:^|[./ ])sent(?: items)?$/i.test(String(folder.path || '')));
      if (!sentFolder?.path) return;

      const lock = await client.getMailboxLock(sentFolder.path);
      try {
        const alreadyStored = await client.search({ header: { 'message-id': messageId } }, { uid: true });
        if (Array.isArray(alreadyStored) && alreadyStored.length > 0) return;

        const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
        const encodedBody = Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
        const headers = [
          `From: <${credential.address}>`,
          `To: <${recipient}>`,
          `Subject: ${encodedSubject}`,
          `Date: ${new Date().toUTCString()}`,
          `Message-ID: ${messageId}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          'Auto-Submitted: auto-generated',
          `List-Unsubscribe: <mailto:${credential.address}?subject=unsubscribe>`,
          ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
          '',
          encodedBody,
          '',
        ].join('\r\n');
        await client.append(sentFolder.path, headers, ['\\Seen']);
      } finally {
        lock.release();
      }
    } catch {
      // SMTP delivery has already succeeded. Some IMAP servers reject
      // appending to Sent; do not report a delivered email as a failed send.
      console.warn('[Email] Could not save an SMTP-sent message to the provider Sent folder.');
    } finally {
      await client.logout().catch(() => {});
    }
  }
}

export const emailAccountService = new EmailAccountService();
