import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServiceSupabaseClient } from '../config/supabase';

export type PersonalProvider = 'telegram' | 'whatsapp_personal' | 'signal_personal' | 'bluesky';

export interface SocialConnectionPublic {
  id: string;
  provider: PersonalProvider;
  account_id: string | null;
  display_name: string | null;
  handle: string | null;
  status: string;
  daily_limit: number;
  actions_today: number;
  last_action_at: string | null;
  last_error: string | null;
  connected_at: string;
  updated_at: string;
}

interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('Server encryption is not configured.');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value: unknown): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(row: any): any {
  if (!row?.credential_ciphertext || !row?.credential_iv || !row?.credential_tag) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.credential_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.credential_tag, 'base64'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(row.credential_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
}

function publicConnection(row: any): SocialConnectionPublic {
  return {
    id: row.id,
    provider: row.provider,
    account_id: row.account_id || null,
    display_name: row.display_name || null,
    handle: row.handle || null,
    status: row.status,
    daily_limit: Number(row.daily_limit || 20),
    actions_today: Number(row.actions_today || 0),
    last_action_at: row.last_action_at || null,
    last_error: row.last_error || null,
    connected_at: row.connected_at,
    updated_at: row.updated_at,
  };
}

export class SocialAccountService {
  private readonly supabase = getServiceSupabaseClient();
  private readonly pendingTelegram = new Map<string, any>();
  private readonly pendingSignal = new Map<string, { userId: string; phone: string }>();
  private readonly pendingWhatsApp = new Map<string, { userId: string; phone: string; sock: any; authDir: string }>();

  async list(userId: string): Promise<SocialConnectionPublic[]> {
    const { data, error } = await this.supabase
      .from('social_account_connections')
      .select('id,provider,account_id,display_name,handle,status,daily_limit,actions_today,last_action_at,last_error,connected_at,updated_at')
      .eq('user_id', userId)
      .order('provider');
    if (error) {
      if (/relation .* does not exist|column .* does not exist/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return (data || []).map(publicConnection);
  }

  async get(userId: string, provider: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('social_account_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  }

  async save(params: {
    userId: string;
    provider: PersonalProvider;
    accountId?: string;
    displayName?: string;
    handle?: string;
    credential: unknown;
    metadata?: Record<string, unknown>;
    dailyLimit?: number;
  }): Promise<SocialConnectionPublic> {
    const encrypted = encrypt(params.credential);
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('social_account_connections')
      .upsert({
        user_id: params.userId,
        provider: params.provider,
        account_id: params.accountId || null,
        display_name: params.displayName || null,
        handle: params.handle || null,
        status: 'connected',
        credential_ciphertext: encrypted.ciphertext,
        credential_iv: encrypted.iv,
        credential_tag: encrypted.tag,
        metadata: params.metadata || {},
        daily_limit: Math.max(1, Math.min(200, Number(params.dailyLimit || 20))),
        last_error: null,
        updated_at: now,
      }, { onConflict: 'user_id,provider' })
      .select('id,provider,account_id,display_name,handle,status,daily_limit,actions_today,last_action_at,last_error,connected_at,updated_at')
      .single();
    if (error) throw new Error(error.message);

    // Keep the existing platform/strategy contract in sync. The placeholder
    // access token prevents legacy connection checks from treating the account
    // as missing; secret material stays in the encrypted table above.
    await this.supabase.from('ad_configs').upsert({
      user_id: params.userId,
      platform: params.provider,
      account_id: params.accountId || params.handle || params.provider,
      page_id: params.accountId || params.handle || params.provider,
      page_name: params.displayName || params.handle || params.provider,
      access_token: 'managed_social_connection',
      connection_type: 'personal',
      updated_at: now,
    }, { onConflict: 'user_id,platform' });

    return publicConnection(data);
  }

  async credentials(userId: string, provider: string): Promise<any | null> {
    const row = await this.get(userId, provider);
    return row ? decrypt(row) : null;
  }

  async remove(userId: string, provider: string): Promise<void> {
    const { error } = await this.supabase
      .from('social_account_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);
    if (error) throw new Error(error.message);
    await this.supabase.from('ad_configs').delete()
      .eq('user_id', userId)
      .eq('platform', provider);
  }

  async reserveAction(userId: string, provider: string): Promise<boolean> {
    const row = await this.get(userId, provider);
    if (!row || row.status !== 'connected') return false;
    const today = new Date().toISOString().slice(0, 10);
    const actionsToday = row.action_day === today ? Number(row.actions_today || 0) : 0;
    if (actionsToday >= Number(row.daily_limit || 20)) return false;
    const { error } = await this.supabase.from('social_account_connections').update({
      action_day: today,
      actions_today: actionsToday + 1,
      last_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    return !error;
  }

  async recordError(userId: string, provider: string, message: string): Promise<void> {
    await this.supabase.from('social_account_connections').update({
      status: /ban|rate.limit|unauthoriz|expired/i.test(message) ? 'needs_reconnect' : 'error',
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', provider);
  }

  async startTelegram(userId: string, phone: string): Promise<{ requestId: string; status: string }> {
    const apiId = Number(process.env.TELEGRAM_API_ID || 0);
    const apiHash = process.env.TELEGRAM_API_HASH;
    if (!apiId || !apiHash) throw new Error('Telegram connection is not configured on the server.');
    let telegram: any;
    try { telegram = require('telegram'); } catch { throw new Error('Telegram connection service is not installed.'); }
    const client = new telegram.TelegramClient(new telegram.sessions.StringSession(''), apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    const result = await client.invoke(new telegram.Api.auth.SendCode({
      phoneNumber: phone,
      apiId,
      apiHash,
      settings: new telegram.Api.auth.CodeSettings({}),
    }));
    const requestId = crypto.randomUUID();
    this.pendingTelegram.set(requestId, { userId, client, phone, phoneCodeHash: result.phoneCodeHash, apiId, apiHash });
    return { requestId, status: 'verification_code_sent' };
  }

  async verifyTelegram(requestId: string, code: string, password?: string): Promise<SocialConnectionPublic> {
    const pending = this.pendingTelegram.get(requestId);
    if (!pending) throw new Error('Telegram verification has expired. Start again.');
    const telegram = require('telegram');
    try {
      await pending.client.invoke(new telegram.Api.auth.SignIn({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code,
      }));
    } catch (error: any) {
      if (/SESSION_PASSWORD_NEEDED/i.test(String(error?.message || error))) {
        if (!password) throw new Error('TELEGRAM_2FA_REQUIRED');
        const passwordModule = require('telegram/password');
        const passwordInfo = await pending.client.invoke(new telegram.Api.account.GetPassword());
        const srp = await passwordModule.computeCheck(passwordInfo, password);
        await pending.client.invoke(new telegram.Api.auth.CheckPassword({ password: srp }));
      } else {
        throw error;
      }
    }
    const me = await pending.client.getMe();
    const session = pending.client.session.save();
    this.pendingTelegram.delete(requestId);
    return this.save({
      userId: pending.userId,
      provider: 'telegram',
      accountId: String(me?.id || pending.phone),
      displayName: [me?.firstName, me?.lastName].filter(Boolean).join(' ') || pending.phone,
      handle: me?.username ? `@${me.username}` : pending.phone,
      credential: { session, phone: pending.phone, apiId: pending.apiId, apiHash: pending.apiHash },
    });
  }

  async startWhatsAppPairing(userId: string, phone: string): Promise<{ requestId: string; pairingCode: string }> {
    let baileys: any;
    try { baileys = require('@whiskeysockets/baileys'); } catch { throw new Error('WhatsApp pairing service is not installed.'); }
    const requestId = crypto.randomUUID();
    const authDir = path.join(os.tmpdir(), 'adroom-whatsapp', requestId);
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const sock = baileys.default({ auth: state, printQRInTerminal: false, browser: ['Adirum AI', 'Chrome', '1.0.0'] });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update: any) => {
      if (update.connection !== 'open') return;
      try {
        const files = await fs.readdir(authDir);
        const bundle: Record<string, string> = {};
        for (const file of files) bundle[file] = (await fs.readFile(path.join(authDir, file))).toString('base64');
        await this.save({
          userId,
          provider: 'whatsapp_personal',
          accountId: phone,
          displayName: phone,
          handle: phone,
          credential: { bundle },
        });
        await fs.rm(authDir, { recursive: true, force: true });
      } catch (error: any) {
        await this.recordError(userId, 'whatsapp_personal', error.message);
      }
      this.pendingWhatsApp.delete(requestId);
    });
    const pairingCode = await sock.requestPairingCode(phone.replace(/\D/g, ''));
    this.pendingWhatsApp.set(requestId, { userId, phone, sock, authDir });
    return { requestId, pairingCode };
  }

  async startSignalVerification(userId: string, phone: string): Promise<{ requestId: string; status: string }> {
    const exec = promisify(execFile);
    try {
      await exec('signal-cli', ['-u', phone, 'register'], { timeout: 30000 });
    } catch (error: any) {
      throw new Error(error?.code === 'ENOENT' ? 'Signal registration service is not installed.' : 'Signal could not send a verification code.');
    }
    const requestId = crypto.randomUUID();
    this.pendingSignal.set(requestId, { userId, phone });
    return { requestId, status: 'verification_code_sent' };
  }

  async verifySignal(requestId: string, code: string): Promise<SocialConnectionPublic> {
    const pending = this.pendingSignal.get(requestId);
    if (!pending) throw new Error('Signal verification has expired. Start again.');
    const exec = promisify(execFile);
    await exec('signal-cli', ['-u', pending.phone, 'verify', code], { timeout: 30000 });
    this.pendingSignal.delete(requestId);
    return this.save({
      userId: pending.userId,
      provider: 'signal_personal',
      accountId: pending.phone,
      displayName: pending.phone,
      handle: pending.phone,
      credential: { phone: pending.phone },
    });
  }

  async publish(provider: string, userId: string, text: string, mediaUrl?: string): Promise<{ id: string; url?: string }> {
    if (provider === 'bluesky') {
      const credential = await this.credentials(userId, provider);
      if (!credential?.accessJwt || !credential?.did) throw new Error('Bluesky credentials are unavailable.');
      const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: credential.did,
          collection: 'app.bsky.feed.post',
          record: { $type: 'app.bsky.feed.post', text: text.slice(0, 3000), createdAt: new Date().toISOString() },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || !data.uri) throw new Error(data.message || 'Bluesky publication failed.');
      await this.reserveAction(userId, provider);
      return { id: data.uri, url: credential.handle ? `https://bsky.app/profile/${credential.handle}` : undefined };
    }
    throw new Error(`Publishing is not supported for ${provider} yet.`);
  }

  async sendMessage(provider: string, userId: string, recipient: string, text: string): Promise<void> {
    if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
    const credential = await this.credentials(userId, provider);
    if (!credential) throw new Error(`${provider} credentials are unavailable.`);
    const exec = promisify(execFile);

    if (provider === 'signal_personal') {
      await exec('signal-cli', ['-u', credential.phone, 'send', '-m', text.slice(0, 2000), recipient], { timeout: 30000 });
      return;
    }

    if (provider === 'telegram') {
      const telegram = require('telegram');
      const client = new telegram.TelegramClient(
        new telegram.sessions.StringSession(credential.session),
        Number(credential.apiId),
        credential.apiHash,
        { connectionRetries: 3 },
      );
      await client.connect();
      await client.sendMessage(recipient, { message: text.slice(0, 4000) });
      await client.disconnect();
      return;
    }

    if (provider === 'whatsapp_personal') {
      let baileys: any;
      try { baileys = require('@whiskeysockets/baileys'); } catch { throw new Error('WhatsApp pairing service is not installed.'); }
      const tempDir = path.join(os.tmpdir(), 'adroom-whatsapp-send', crypto.randomUUID());
      await fs.mkdir(tempDir, { recursive: true });
      try {
        for (const [file, encoded] of Object.entries(credential.bundle || {})) {
          await fs.writeFile(path.join(tempDir, file), Buffer.from(String(encoded), 'base64'));
        }
        const { state, saveCreds } = await baileys.useMultiFileAuthState(tempDir);
        const sock = baileys.default({ auth: state, printQRInTerminal: false });
        sock.ev.on('creds.update', saveCreds);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('WhatsApp connection timed out.')), 30000);
          sock.ev.on('connection.update', (update: any) => {
            if (update.connection === 'open') { clearTimeout(timer); resolve(); }
            if (update.connection === 'close') { clearTimeout(timer); reject(new Error('WhatsApp connection closed.')); }
          });
        });
        const jid = recipient.includes('@') ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: text.slice(0, 4000) });
        sock.end(undefined);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      return;
    }

    throw new Error(`Messaging is not supported for ${provider} yet.`);
  }
}

export const socialAccountService = new SocialAccountService();