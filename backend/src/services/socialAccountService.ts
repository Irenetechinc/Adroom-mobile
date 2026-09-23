import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServiceSupabaseClient } from '../config/supabase';
import { normalizePlatform } from './platformIdentity';
import { isEnabled as isFeatureEnabled } from './featureFlagService';

export type PersonalProvider = 'telegram' | 'whatsapp_personal' | 'signal_personal' | 'bluesky' | 'delta_chat';

export interface PersonalInboundMessage {
  externalId: string;
  senderId: string;
  text: string;
  timestamp: string;
}

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
  private readonly pendingSignal = new Map<string, { userId: string; phone: string; createdAt: number; authDir: string }>();
  private readonly pendingWhatsApp = new Map<string, { userId: string; phone: string; sock: any; authDir: string }>();
  // Keep one live Baileys socket per connected user while the backend process
  // is running. WhatsApp does not expose reliable history from a freshly
  // materialized auth bundle, so inbound events must be buffered as they arrive
  // and then consumed by the shared inbound-DM pipeline.
  private readonly whatsappSockets = new Map<string, any>();
  private readonly whatsappAuthDirs = new Map<string, string>();
  private readonly whatsappPersistTimers = new Map<string, NodeJS.Timeout>();
  private readonly whatsappInbound = new Map<string, PersonalInboundMessage[]>();

  private whatsappMessageText(message: any): string {
    const content = message?.message || {};
    return String(
      content.conversation
      || content.extendedTextMessage?.text
      || content.imageMessage?.caption
      || content.videoMessage?.caption
      || content.documentMessage?.caption
      || content.buttonsResponseMessage?.selectedDisplayText
      || content.listResponseMessage?.title
      || '',
    ).trim();
  }

  private normalizeWhatsAppRecipient(value: string): string {
    const raw = String(value || '').trim();
    return raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  private attachWhatsAppInbound(userId: string, sock: any): void {
    sock.ev.on('messages.upsert', (event: any) => {
      for (const message of event?.messages || []) {
        if (message?.key?.fromMe) continue;
        const text = this.whatsappMessageText(message);
        const senderId = String(message?.key?.remoteJid || '').trim();
        if (!text || !senderId) continue;
        const timestampValue = Number(message?.messageTimestamp || 0);
        const inbound: PersonalInboundMessage = {
          externalId: `whatsapp:${String(message?.key?.id || crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0, 24))}`,
          senderId,
          text,
          timestamp: new Date(timestampValue > 1e12 ? timestampValue : (timestampValue * 1000 || Date.now())).toISOString(),
        };
        const current = this.whatsappInbound.get(userId) || [];
        if (!current.some((item) => item.externalId === inbound.externalId)) {
          current.push(inbound);
          this.whatsappInbound.set(userId, current.slice(-200));
          // Persist before the bounded in-memory buffer can age out. This
          // keeps inbound events recoverable across Railway restarts.
          void this.persistWhatsAppInbound(userId, inbound);
        }
      }
    });
  }

  private async persistWhatsAppInbound(userId: string, message: PersonalInboundMessage): Promise<void> {
    const { error } = await this.supabase
      .from('personal_inbound_messages')
      .upsert({
        user_id: userId,
        provider: 'whatsapp_personal',
        external_id: message.externalId,
        sender_id: message.senderId,
        message: message.text,
        received_at: message.timestamp,
      }, { onConflict: 'user_id,provider,external_id' });
    if (error && !/relation .* does not exist|column .* does not exist/i.test(error.message)) {
      console.error(`[SocialAccountService] WhatsApp inbound persistence failed: ${error.message}`);
    }
  }

  private scheduleWhatsAppCredentialPersist(userId: string, authDir: string): void {
    const existing = this.whatsappPersistTimers.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.whatsappPersistTimers.delete(userId);
      this.persistWhatsAppCredentials(userId, authDir).catch((error: any) => {
        console.error(`[SocialAccountService] WhatsApp credential persistence failed: ${error.message}`);
      });
    }, 1000);
    this.whatsappPersistTimers.set(userId, timer);
  }

  private async persistWhatsAppCredentials(userId: string, authDir: string): Promise<void> {
    const row = await this.get(userId, 'whatsapp_personal');
    if (!row) return;
    const bundle: Record<string, string> = {};
    for (const file of await fs.readdir(authDir)) {
      const fullPath = path.join(authDir, file);
      if ((await fs.stat(fullPath)).isFile()) {
        bundle[file] = (await fs.readFile(fullPath)).toString('base64');
      }
    }
    const encrypted = encrypt({ bundle });
    await this.supabase.from('social_account_connections').update({
      credential_ciphertext: encrypted.ciphertext,
      credential_iv: encrypted.iv,
      credential_tag: encrypted.tag,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
  }

  private async restoreWhatsAppSocket(userId: string, credential: any): Promise<any | null> {
    const current = this.whatsappSockets.get(userId);
    if (current) return current;
    let baileys: any;
    try { baileys = require('@whiskeysockets/baileys'); } catch { return null; }
    if (!credential?.bundle || typeof credential.bundle !== 'object') return null;

    const authDir = path.join(os.tmpdir(), 'adroom-whatsapp-live', crypto.randomUUID());
    await fs.mkdir(authDir, { recursive: true });
    for (const [file, encoded] of Object.entries(credential.bundle)) {
      await fs.writeFile(path.join(authDir, file), Buffer.from(String(encoded), 'base64'));
    }
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const sock = baileys.default({ auth: state, printQRInTerminal: false, browser: ['Adirum AI', 'Chrome', '1.0.0'] });
    sock.ev.on('creds.update', (update: any) => {
      void saveCreds(update);
      this.scheduleWhatsAppCredentialPersist(userId, authDir);
    });
    this.attachWhatsAppInbound(userId, sock);
    this.whatsappAuthDirs.set(userId, authDir);
    sock.ev.on('connection.update', async (update: any) => {
      if (update.connection !== 'close') return;
      if (this.whatsappSockets.get(userId) === sock) this.whatsappSockets.delete(userId);
      if (this.whatsappAuthDirs.get(userId) === authDir) this.whatsappAuthDirs.delete(userId);
      await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WhatsApp connection timed out.')), 30000);
        sock.ev.on('connection.update', (update: any) => {
          if (update.connection === 'open') {
            clearTimeout(timer);
            this.whatsappSockets.set(userId, sock);
            resolve();
          }
          if (update.connection === 'close') {
            clearTimeout(timer);
            reject(new Error('WhatsApp connection closed.'));
          }
        });
      });
      return sock;
    } catch (error) {
      try { sock.end(error); } catch {}
      this.whatsappAuthDirs.delete(userId);
      await fs.rm(authDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async assertProviderEnabled(userId: string, provider: string): Promise<void> {
    const normalized = normalizePlatform(provider);
    if (!(await isFeatureEnabled(`social_${normalized}_connections`, userId))) {
      throw new Error(`${normalized} connections are temporarily unavailable.`);
    }
  }

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
    provider = normalizePlatform(provider);
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
    const provider = normalizePlatform(params.provider) as PersonalProvider;
    const encrypted = encrypt(params.credential);
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('social_account_connections')
      .upsert({
        user_id: params.userId,
        provider,
        account_id: params.accountId || null,
        display_name: params.displayName || null,
        handle: params.handle || null,
        status: 'connected',
        credential_ciphertext: encrypted.ciphertext,
        credential_iv: encrypted.iv,
        credential_tag: encrypted.tag,
        metadata: params.metadata || {},
      daily_limit: Math.max(1, Math.min(200, Number(params.dailyLimit || 20))),
      warmup_started_at: now,
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
      platform: provider,
      account_id: params.accountId || params.handle || provider,
      page_id: params.accountId || params.handle || provider,
      page_name: params.displayName || params.handle || provider,
      access_token: 'managed_social_connection',
      connection_type: 'personal',
      updated_at: now,
    }, { onConflict: 'user_id,platform' });

    return publicConnection(data);
  }

  async credentials(userId: string, provider: string): Promise<any | null> {
    const row = await this.get(userId, normalizePlatform(provider));
    return row ? decrypt(row) : null;
  }

  async remove(userId: string, provider: string): Promise<void> {
    provider = normalizePlatform(provider);
    const { error } = await this.supabase
      .from('social_account_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);
    if (error) throw new Error(error.message);
    await this.supabase.from('ad_configs').delete()
      .eq('user_id', userId)
      .eq('platform', provider);
    if (provider === 'whatsapp_personal') {
      const socket = this.whatsappSockets.get(userId);
      try { socket?.end(undefined); } catch {}
      this.whatsappSockets.delete(userId);
      const authDir = this.whatsappAuthDirs.get(userId);
      this.whatsappAuthDirs.delete(userId);
      if (authDir) await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
      this.whatsappInbound.delete(userId);
    }
  }

  async reserveAction(userId: string, provider: string, recipient?: string): Promise<boolean> {
    provider = normalizePlatform(provider);
    if (!(await isFeatureEnabled(`social_${provider}_connections`, userId))) return false;
    const row = await this.get(userId, provider);
    if (!row || !['connected', 'error', 'paused'].includes(String(row.status))) return false;
    if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) return false;
    // A transient error or an expired circuit-breaker cooldown is recoverable.
    // Do not leave an account permanently unusable after one failed send.
    if (row.status !== 'connected') {
      await this.supabase.from('social_account_connections').update({
        status: 'connected',
        consecutive_errors: 0,
        cooldown_until: null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }
    const today = new Date().toISOString().slice(0, 10);
    const actionsToday = row.action_day === today ? Number(row.actions_today || 0) : 0;
    const configuredLimit = Number(row.daily_limit || 20);
    // New accounts ramp up slowly. Existing rows without a warmup timestamp
    // keep their configured limit so reconnects do not unexpectedly throttle
    // established accounts.
    const warmupDays = row.warmup_started_at
      ? Math.max(0, Math.floor((Date.now() - new Date(row.warmup_started_at).getTime()) / 86400000))
      : 999;
    const warmupLimit = warmupDays < 1 ? 3 : warmupDays < 3 ? 8 : warmupDays < 7 ? 15 : configuredLimit;
    if (actionsToday >= Math.min(configuredLimit, warmupLimit)) return false;
    const recipientKey = recipient
      ? crypto.createHash('sha256').update(String(recipient)).digest('hex').slice(0, 24)
      : null;
    const recipientActions = row.recipient_action_day === today && row.recipient_actions && typeof row.recipient_actions === 'object'
      ? { ...row.recipient_actions }
      : {};
    const recipientLimit = Math.max(1, Math.min(5, Math.floor(Number(row.daily_limit || 20) / 4)));
    if (recipientKey && Number(recipientActions[recipientKey] || 0) >= recipientLimit) return false;
    if (recipientKey) recipientActions[recipientKey] = Number(recipientActions[recipientKey] || 0) + 1;
    const { error } = await this.supabase.from('social_account_connections').update({
      action_day: today,
      actions_today: actionsToday + 1,
      recipient_action_day: today,
      recipient_actions: recipientActions,
      last_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).eq('actions_today', Number(row.actions_today || 0));
    return !error;
  }

  async recordError(userId: string, provider: string, message: string): Promise<void> {
    provider = normalizePlatform(provider);
    const row = await this.get(userId, provider);
    const consecutiveErrors = Number(row?.consecutive_errors || 0) + 1;
    const shouldPause = consecutiveErrors >= 3 || /floodwait|rate.limit|too many requests|ban/i.test(message);
    const cooldownUntil = shouldPause
      ? new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * Math.pow(2, Math.min(consecutiveErrors - 3, 4)))).toISOString()
      : null;
    await this.supabase.from('social_account_connections').update({
      status: /ban|unauthoriz|expired/i.test(message) ? 'needs_reconnect' : shouldPause ? 'paused' : 'error',
      last_error: message.slice(0, 500),
      consecutive_errors: consecutiveErrors,
      cooldown_until: cooldownUntil,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', provider);
  }

  async recordSuccess(userId: string, provider: string): Promise<void> {
    await this.supabase.from('social_account_connections').update({
      consecutive_errors: 0,
      cooldown_until: null,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', normalizePlatform(provider));
  }

  private async safetyDelay(provider: string): Promise<void> {
    const normalized = normalizePlatform(provider);
    const min = normalized === 'signal_personal' ? 5000 : normalized === 'telegram' ? 1200 : 800;
    const max = normalized === 'signal_personal' ? 12000 : normalized === 'telegram' ? 5000 : 3500;
    await new Promise((resolve) => setTimeout(resolve, min + Math.floor(Math.random() * (max - min + 1))));
  }

  private async personalSelfRecipient(userId: string, provider: string, credential: any): Promise<string> {
    const row = await this.get(userId, provider);
    return String(row?.account_id || credential?.phone || credential?.handle || '');
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
    sock.ev.on('creds.update', (update: any) => {
      void saveCreds(update);
      this.scheduleWhatsAppCredentialPersist(userId, authDir);
    });
    this.attachWhatsAppInbound(userId, sock);
    this.pendingWhatsApp.set(requestId, { userId, phone, sock, authDir });
    sock.ev.on('connection.update', async (update: any) => {
      if (update.connection === 'close') {
        this.pendingWhatsApp.delete(requestId);
        if (this.whatsappSockets.get(userId) === sock) this.whatsappSockets.delete(userId);
        this.whatsappAuthDirs.delete(userId);
        await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
        return;
      }
      if (update.connection !== 'open') return;
      try {
        // Baileys writes credentials asynchronously in response to the open
        // event. Give the final creds.update event time to finish before the
        // encrypted bundle is copied to Supabase.
        await new Promise((resolve) => setTimeout(resolve, 300));
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
        this.whatsappSockets.set(userId, sock);
        this.whatsappAuthDirs.set(userId, authDir);
      } catch (error: any) {
        await this.recordError(userId, 'whatsapp_personal', error.message);
      }
      this.pendingWhatsApp.delete(requestId);
    });
    try {
      const pairingCode = await sock.requestPairingCode(phone.replace(/\D/g, ''));
      return { requestId, pairingCode };
    } catch (error) {
      this.pendingWhatsApp.delete(requestId);
      try { sock.end(error); } catch {}
      await fs.rm(authDir, { recursive: true, force: true });
      throw error;
    }
  }

  async startSignalVerification(userId: string, phone: string): Promise<{ requestId: string; status: string }> {
    const exec = promisify(execFile);
    const requestId = crypto.randomUUID();
    const authDir = path.join(os.tmpdir(), 'adroom-signal', requestId);
    await fs.mkdir(authDir, { recursive: true });
    try {
      await exec('signal-cli', ['--config', authDir, '-u', phone, 'register'], { timeout: 30000 });
    } catch (error: any) {
      await fs.rm(authDir, { recursive: true, force: true });
      throw new Error(error?.code === 'ENOENT' ? 'Signal registration service is not installed.' : 'Signal could not send a verification code.');
    }
    this.pendingSignal.set(requestId, { userId, phone, createdAt: Date.now(), authDir });
    return { requestId, status: 'verification_code_sent' };
  }

  async verifySignal(requestId: string, code: string): Promise<SocialConnectionPublic> {
    const pending = this.pendingSignal.get(requestId);
    if (!pending) throw new Error('Signal verification has expired. Start again.');
    const exec = promisify(execFile);
    try {
      await exec('signal-cli', ['--config', pending.authDir, '-u', pending.phone, 'verify', code], { timeout: 30000 });
      const bundle: Record<string, string> = {};
      for (const file of await fs.readdir(pending.authDir)) {
        const stat = await fs.stat(path.join(pending.authDir, file));
        if (stat.isFile()) bundle[file] = (await fs.readFile(path.join(pending.authDir, file))).toString('base64');
      }
      this.pendingSignal.delete(requestId);
      return this.save({
        userId: pending.userId,
        provider: 'signal_personal',
        accountId: pending.phone,
        displayName: pending.phone,
        handle: pending.phone,
        credential: { phone: pending.phone, bundle },
      });
    } finally {
      await fs.rm(pending.authDir, { recursive: true, force: true });
    }
  }

  async publish(provider: string, userId: string, text: string, mediaUrl?: string, destination?: string): Promise<{ id: string; url?: string }> {
    provider = normalizePlatform(provider);
    await this.assertProviderEnabled(userId, provider);
    if (provider === 'delta_chat') {
      if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
      await this.safetyDelay(provider);
      try {
        const result = await this.deltaChatRequest(userId, 'publish', { text, mediaUrl });
        await this.recordSuccess(userId, provider);
        return { id: String(result?.id || `delta-chat:${Date.now()}`), url: result?.url };
      } catch (error: any) {
        await this.recordError(userId, provider, error.message);
        throw error;
      }
    }
    if (['telegram', 'whatsapp_personal', 'signal_personal'].includes(provider)) {
      const requestedRecipient = String(destination || '').trim();
      if (!requestedRecipient) {
        throw new Error(`${provider} personal accounts are messaging destinations, not public feeds. A recipient is required.`);
      }
      if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
      await this.safetyDelay(provider);
      const credential = await this.credentials(userId, provider);
      if (!credential) throw new Error(`${provider} credentials are unavailable.`);
      try {
        if (provider === 'telegram') {
          const telegram = require('telegram');
          const client = new telegram.TelegramClient(
            new telegram.sessions.StringSession(credential.session),
            Number(credential.apiId),
            credential.apiHash,
            { connectionRetries: 3 },
          );
          await client.connect();
          const me = await client.getMe();
          const result = mediaUrl
            ? await client.sendFile(me, { file: mediaUrl, caption: text.slice(0, 4000) })
            : await client.sendMessage(me, { message: text.slice(0, 4000) });
          await client.disconnect();
          await this.recordSuccess(userId, provider);
          return { id: String(result?.id || `telegram:${Date.now()}`), url: credential.handle ? `https://t.me/${String(credential.handle).replace(/^@/, '')}` : undefined };
        }

        if (provider === 'whatsapp_personal') {
          let baileys: any;
          try { baileys = require('@whiskeysockets/baileys'); } catch { throw new Error('WhatsApp pairing service is not installed.'); }
          const tempDir = path.join(os.tmpdir(), 'adroom-whatsapp-publish', crypto.randomUUID());
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
            const phone = requestedRecipient;
            const jid = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
            await sock.sendPresenceUpdate?.('composing', jid);
            await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 1200)));
            const message = mediaUrl
              ? { document: { url: mediaUrl }, fileName: 'adirum-creative', caption: text.slice(0, 4000) }
              : { text: text.slice(0, 4000) };
            const result = await sock.sendMessage(jid, message);
            sock.end(undefined);
            await this.recordSuccess(userId, provider);
            return { id: String(result?.key?.id || `whatsapp:${Date.now()}`) };
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        }

        const exec = promisify(execFile);
        const phone = requestedRecipient;
        const configDir = await this.materializeSignalBundle(credential);
        try {
          await exec('signal-cli', ['--config', configDir, '-u', credential.phone, 'send', '-m', text.slice(0, 2000), phone], { timeout: 30000 });
        } finally {
          await fs.rm(configDir, { recursive: true, force: true });
        }
        await this.recordSuccess(userId, provider);
        return { id: `signal:${Date.now()}` };
      } catch (error: any) {
        await this.recordError(userId, provider, error.message);
        throw error;
      }
    }
    if (provider === 'bluesky') {
      if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
      await this.safetyDelay(provider);
      const credential = await this.credentials(userId, provider);
      if (!credential?.accessJwt || !credential?.did) throw new Error('Bluesky credentials are unavailable.');
      try {
        let embed: any;
        if (mediaUrl) {
          const media = await this.fetchMediaForUpload(mediaUrl);
          const uploadResponse = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${credential.accessJwt}`,
              'Content-Type': media.mimeType,
            },
            body: media.bytes as any,
          });
          const uploadData: any = await uploadResponse.json().catch(() => ({}));
          if (!uploadResponse.ok || !uploadData.blob) {
            throw new Error(uploadData.message || 'Bluesky media upload failed.');
          }
          if (media.mimeType.startsWith('image/')) {
            embed = {
              $type: 'app.bsky.embed.images',
              images: [{ alt: text.slice(0, 300), image: uploadData.blob }],
            };
          } else if (media.mimeType.startsWith('video/')) {
            embed = {
              $type: 'app.bsky.embed.video',
              video: uploadData.blob,
              alt: text.slice(0, 300),
            };
          }
        }

        const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
          method: 'POST',
          headers: { Authorization: `Bearer ${credential.accessJwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: credential.did,
            collection: 'app.bsky.feed.post',
            record: {
              $type: 'app.bsky.feed.post',
              text: text.slice(0, 3000),
              createdAt: new Date().toISOString(),
              ...(embed ? { embed } : {}),
            },
          }),
        });
        const data: any = await response.json().catch(() => ({}));
        if (!response.ok || !data.uri) throw new Error(data.message || 'Bluesky publication failed.');
        await this.recordSuccess(userId, provider);
        return { id: data.uri, url: credential.handle ? `https://bsky.app/profile/${credential.handle}` : undefined };
      } catch (error: any) {
        await this.recordError(userId, provider, error.message);
        throw error;
      }
    }
    throw new Error(`Publishing is not supported for ${provider} yet.`);
  }

  private async materializeSignalBundle(credential: any): Promise<string> {
    const tempDir = path.join(os.tmpdir(), 'adroom-signal-publish', crypto.randomUUID());
    await fs.mkdir(tempDir, { recursive: true });
    for (const [file, encoded] of Object.entries(credential?.bundle || {})) {
      await fs.writeFile(path.join(tempDir, file), Buffer.from(String(encoded), 'base64'));
    }
    return tempDir;
  }

  private async fetchMediaForUpload(mediaUrl: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const value = String(mediaUrl || '').trim();
    if (value.startsWith('data:')) {
      const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
      if (!match) throw new Error('Generated media data is not a valid base64 data URI.');
      return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
    }

    const response = await fetch(value);
    if (!response.ok) throw new Error(`Media download failed with HTTP ${response.status}.`);
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim() || '';
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      throw new Error(`Media URL returned unsupported content type: ${mimeType || 'unknown'}.`);
    }
    return { mimeType, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  async replyBluesky(userId: string, postUri: string, text: string): Promise<void> {
    if (!(await this.reserveAction(userId, 'bluesky'))) throw new Error('Bluesky daily safety limit reached or account is not ready.');
    await this.safetyDelay('bluesky');
    const credential = await this.credentials(userId, 'bluesky');
    if (!credential?.accessJwt || !credential?.did) throw new Error('Bluesky credentials are unavailable.');
    try {
      const threadResponse = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}`);
      const thread: any = await threadResponse.json().catch(() => ({}));
      const post = thread?.thread?.post;
      if (!threadResponse.ok || !post?.cid || !post?.uri) throw new Error('Bluesky post could not be resolved for reply.');
      const parent = { uri: post.uri, cid: post.cid };
      const root = post.record?.reply?.root || parent;
      const response = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: credential.did,
          collection: 'app.bsky.feed.post',
          record: {
            $type: 'app.bsky.feed.post',
            text: text.slice(0, 3000),
            createdAt: new Date().toISOString(),
            reply: { root, parent },
          },
        }),
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok || !data.uri) throw new Error(data.message || 'Bluesky reply failed.');
      await this.recordSuccess(userId, 'bluesky');
    } catch (error: any) {
      await this.recordError(userId, 'bluesky', error.message);
      throw error;
    }
  }

  async sendMessage(provider: string, userId: string, recipient: string, text: string): Promise<void> {
    provider = normalizePlatform(provider);
    await this.assertProviderEnabled(userId, provider);
    if (!(await this.reserveAction(userId, provider, recipient))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
    await this.safetyDelay(provider);
    const credential = await this.credentials(userId, provider);
    if (!credential) throw new Error(`${provider} credentials are unavailable.`);
    const exec = promisify(execFile);

    try {
      if (provider === 'delta_chat') {
        await this.deltaChatRequest(userId, 'send', { recipient, text });
        await this.recordSuccess(userId, provider);
        return;
      }

      if (provider === 'signal_personal') {
        const tempDir = path.join(os.tmpdir(), 'adroom-signal-send', crypto.randomUUID());
        await fs.mkdir(tempDir, { recursive: true });
        try {
          for (const [file, encoded] of Object.entries(credential.bundle || {})) {
            await fs.writeFile(path.join(tempDir, file), Buffer.from(String(encoded), 'base64'));
          }
          await exec('signal-cli', ['--config', tempDir, '-u', credential.phone, 'send', '-m', text.slice(0, 2000), recipient], { timeout: 30000 });
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
        await this.recordSuccess(userId, provider);
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
        await this.recordSuccess(userId, provider);
        return;
      }

      if (provider === 'whatsapp_personal') {
        let baileys: any;
        try { baileys = require('@whiskeysockets/baileys'); } catch { throw new Error('WhatsApp pairing service is not installed.'); }
        const liveSocket = await this.restoreWhatsAppSocket(userId, credential);
        if (liveSocket) {
          const jid = recipient.includes('@') ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
          await liveSocket.sendMessage(jid, { text: text.slice(0, 4000) });
          await this.recordSuccess(userId, provider);
          return;
        }
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
        await this.recordSuccess(userId, provider);
        return;
      }

      if (provider === 'bluesky') {
        const didResponse = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(recipient.replace(/^@/, ''))}`);
        const didData: any = await didResponse.json().catch(() => ({}));
        if (!didResponse.ok || !didData.did) throw new Error('Bluesky recipient could not be resolved.');
        const headers = { Authorization: `Bearer ${credential.accessJwt}`, 'Content-Type': 'application/json' };
        const convoResponse = await fetch('https://bsky.social/xrpc/chat.bsky.convo.getConvoForMembers', {
          method: 'POST', headers, body: JSON.stringify({ members: [credential.did, didData.did] }),
        });
        const convo: any = await convoResponse.json().catch(() => ({}));
        if (!convoResponse.ok || !convo.convo?.id) throw new Error(convo.message || 'Bluesky conversation could not be opened.');
        const messageResponse = await fetch('https://bsky.social/xrpc/chat.bsky.convo.sendMessage', {
          method: 'POST', headers, body: JSON.stringify({ convoId: convo.convo.id, message: { text: text.slice(0, 1000) } }),
        });
        const message: any = await messageResponse.json().catch(() => ({}));
        if (!messageResponse.ok) throw new Error(message.message || 'Bluesky message failed.');
        await this.recordSuccess(userId, provider);
        return;
      }
    } catch (error: any) {
      await this.recordError(userId, provider, error.message);
      throw error;
    }

    throw new Error(`Messaging is not supported for ${provider} yet.`);
  }

  /**
   * Read recent inbound messages for the personal providers that expose a
   * server-side history API. The caller owns lead matching, deduplication,
   * scoring, and notifications so all channels share the existing pipeline.
   */
  async receiveMessages(
    userId: string,
    provider: string,
    recipient: string,
    limit = 25,
  ): Promise<PersonalInboundMessage[]> {
    provider = normalizePlatform(provider);
    const credential = await this.credentials(userId, provider);
    if (!credential) throw new Error(`${provider} credentials are unavailable.`);

    if (provider === 'telegram') {
      const telegram = require('telegram');
      const client = new telegram.TelegramClient(
        new telegram.sessions.StringSession(credential.session),
        Number(credential.apiId),
        credential.apiHash,
        { connectionRetries: 3 },
      );
      await client.connect();
      try {
        const messages = await client.getMessages(recipient, { limit: Math.min(50, Math.max(1, limit)) });
        return (messages || [])
          .filter((message: any) => !message?.out && String(message?.message || '').trim())
          .map((message: any) => ({
            externalId: `telegram:${message.id}`,
            senderId: String(message.senderId?.value || message.senderId || recipient),
            text: String(message.message).trim(),
            timestamp: new Date(Number(message.date || 0) * 1000 || Date.now()).toISOString(),
          }));
      } finally {
        await client.disconnect();
      }
    }

    if (provider === 'signal_personal') {
      const exec = promisify(execFile);
      const configDir = await this.materializeSignalBundle(credential);
      try {
        const result = await exec('signal-cli', [
          '--config', configDir,
          '-u', credential.phone,
          'receive',
          '--timeout', '1',
          '--max-messages', String(Math.min(100, Math.max(1, limit))),
          '--json',
        ], { timeout: 15000 });
        return result.stdout
          .split(/\r?\n/)
          .map((line) => {
            try { return JSON.parse(line); } catch { return null; }
          })
          .filter(Boolean)
          .map((event: any) => {
            const envelope = event?.envelope || event;
            const text = String(envelope?.dataMessage?.message || '').trim();
            const senderId = String(envelope?.sourceNumber || envelope?.source || '');
            const timestamp = Number(envelope?.timestamp || Date.now());
            return {
              externalId: `signal:${timestamp}:${senderId}`,
              senderId,
              text,
              timestamp: new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString(),
            };
          })
          .filter((message: PersonalInboundMessage) =>
            message.text && (!recipient || message.senderId === recipient),
          );
      } finally {
        await fs.rm(configDir, { recursive: true, force: true });
      }
    }

    if (provider === 'bluesky') {
      const didResponse = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(recipient.replace(/^@/, ''))}`);
      const didData: any = await didResponse.json().catch(() => ({}));
      if (!didResponse.ok || !didData.did) return [];
      const headers = { Authorization: `Bearer ${credential.accessJwt}`, 'Content-Type': 'application/json' };
      const convoResponse = await fetch('https://bsky.social/xrpc/chat.bsky.convo.getConvoForMembers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ members: [credential.did, didData.did] }),
      });
      const convo: any = await convoResponse.json().catch(() => ({}));
      if (!convoResponse.ok || !convo.convo?.id) return [];
      const messagesResponse = await fetch(`https://bsky.social/xrpc/chat.bsky.convo.getMessages?convoId=${encodeURIComponent(convo.convo.id)}&limit=${Math.min(50, Math.max(1, limit))}`, { headers });
      const messages: any = await messagesResponse.json().catch(() => ({}));
      return (messages?.messages || [])
        .filter((message: any) => message?.sender?.did !== credential.did && String(message?.message?.text || '').trim())
        .map((message: any) => ({
          externalId: `bluesky:${message.id}`,
          senderId: String(message.sender?.did || recipient),
          text: String(message.message.text).trim(),
          timestamp: message.sentAt || new Date().toISOString(),
        }));
    }

    if (provider === 'delta_chat') {
      const result = await this.deltaChatRequest(userId, 'receive', { recipient, limit });
      const messages = Array.isArray(result) ? result : (result?.messages || []);
      return messages
        .map((message: any) => ({
          externalId: `delta-chat:${message.id || message.messageId || crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0, 20)}`,
          senderId: String(message.senderId || message.sender || recipient),
          text: String(message.text || message.message || '').trim(),
          timestamp: message.timestamp || message.createdAt || new Date().toISOString(),
        }))
        .filter((message: PersonalInboundMessage) => Boolean(message.text));
    }

    // Baileys does not expose reliable historical message retrieval for a
    // freshly materialized auth bundle. Live WhatsApp events are handled by
    // the connection listener; do not fabricate an empty successful poll.
    if (provider === 'whatsapp_personal') {
      await this.restoreWhatsAppSocket(userId, credential);
      const persisted = await this.supabase
        .from('personal_inbound_messages')
        .select('external_id, sender_id, message, received_at')
        .eq('user_id', userId)
        .eq('provider', 'whatsapp_personal')
        .order('received_at', { ascending: false })
        .limit(Math.min(100, Math.max(1, limit)));
      const persistedMessages: PersonalInboundMessage[] = (persisted.data || []).map((message: any) => ({
        externalId: String(message.external_id),
        senderId: String(message.sender_id),
        text: String(message.message || ''),
        timestamp: String(message.received_at),
      }));
      const messages = [...persistedMessages, ...(this.whatsappInbound.get(userId) || [])]
        .filter((message, index, all) => all.findIndex((candidate) => candidate.externalId === message.externalId) === index);
      const wanted = this.normalizeWhatsAppRecipient(recipient);
      return messages
        .filter((message) => !recipient || message.senderId === wanted || message.senderId.replace(/\D/g, '') === String(recipient).replace(/\D/g, ''))
        .slice(-Math.min(50, Math.max(1, limit)));
    }

    return [];
  }

  /**
   * Delta Chat deliberately uses an operator-provided Delta Chat Core bridge.
   * There is no stable Node-native account runtime to embed in Railway. The
   * bridge receives credentials only during connect and keeps them on its own
   * encrypted account store; Adirum stores only the returned opaque account
   * credential. All bridge calls are server-to-server and fail explicitly when
   * the runtime is not configured.
   */
  async connectDeltaChat(userId: string, address: string, password: string): Promise<SocialConnectionPublic> {
    const result = await this.deltaChatRequest(userId, 'connect', { address, password });
    if (!result?.credential) throw new Error('Delta Chat bridge did not return an account credential.');
    return this.save({
      userId,
      provider: 'delta_chat',
      accountId: result.accountId || address,
      displayName: result.displayName || address,
      handle: address,
      credential: { bridgeCredential: result.credential },
      metadata: { bridge: 'configured' },
    });
  }

  private async deltaChatRequest(userId: string, operation: string, body: Record<string, unknown>): Promise<any> {
    const bridgeUrl = String(process.env.DELTA_CHAT_BRIDGE_URL || '').replace(/\/+$/, '');
    if (!bridgeUrl) throw new Error('Delta Chat is not configured on this server. Ask the administrator to configure the Delta Chat bridge.');
    const credential = operation === 'connect' ? undefined : (await this.credentials(userId, 'delta_chat'))?.bridgeCredential;
    const response = await fetch(`${bridgeUrl}/${operation}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.DELTA_CHAT_BRIDGE_TOKEN ? { Authorization: `Bearer ${process.env.DELTA_CHAT_BRIDGE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ userId, credential, ...body }),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Delta Chat ${operation} failed.`);
    return data;
  }
}

export const socialAccountService = new SocialAccountService();