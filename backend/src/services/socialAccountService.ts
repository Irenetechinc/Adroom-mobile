import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getServiceSupabaseClient } from '../config/supabase';
import { normalizePlatform, normalizeSelectedPlatforms } from './platformIdentity';
import { isEnabled as isFeatureEnabled } from './featureFlagService';
import { normalizeInboundMessageTimestamp } from './inboundMessageTimestamp';
import {
  persistWhatsAppPairingSession,
  requestWhatsAppPairingCodeWhenReady,
} from './whatsappPairing';

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
  if (!secret) {
    const generated = crypto.randomBytes(32).toString('hex');
    console.warn('[SocialAccountService] SESSION_SECRET/ENCRYPTION_KEY is missing; using a process-local generated key for this runtime only. Configure a stable secret in Railway for persistent encrypted sessions.');
    process.env.SESSION_SECRET = generated;
    return crypto.createHash('sha256').update(generated).digest();
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function signalCliPath(): string {
  return String(process.env.SIGNAL_CLI_PATH || 'signal-cli').trim() || 'signal-cli';
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

function classifyProviderError(provider: string, message: string): {
  code: string;
  cooldown: boolean;
  banned: boolean;
  requiresReconnect: boolean;
} {
  const value = String(message || '').toLowerCase();
  if (provider === 'telegram' && /floodwait|flood wait/.test(value)) {
    return { code: 'telegram_flood_wait', cooldown: true, banned: false, requiresReconnect: false };
  }
  if (provider === 'whatsapp_personal' && /logged.?out|401|bad session|connection closed.*logged/.test(value)) {
    return { code: 'whatsapp_logged_out', cooldown: false, banned: false, requiresReconnect: true };
  }
  if (provider === 'signal_personal' && /unregistered|invalid.*(session|account)|banned|registration denied/.test(value)) {
    return { code: /banned|registration denied/.test(value) ? 'signal_registration_blocked' : 'signal_invalid_session', cooldown: false, banned: /banned/.test(value), requiresReconnect: true };
  }
  if (provider === 'bluesky' && /auth.?token|jwt|session|expired|unauthorized|401/.test(value)) {
    return { code: 'bluesky_session_expired', cooldown: false, banned: false, requiresReconnect: true };
  }
  if (provider === 'delta_chat' && /401|403|unauthorized|authentication/.test(value)) {
    return { code: 'delta_chat_bridge_auth', cooldown: false, banned: false, requiresReconnect: true };
  }
  if (/banned|blocked|account disabled|forbidden/.test(value)) {
    return { code: 'provider_account_blocked', cooldown: true, banned: true, requiresReconnect: false };
  }
  if (/rate.?limit|too many requests|429|cooldown/.test(value)) {
    return { code: 'provider_rate_limited', cooldown: true, banned: false, requiresReconnect: false };
  }
  if (/unauthoriz|invalid.?token|expired|access token|oauth|401/.test(value)) {
    return { code: 'provider_credentials_expired', cooldown: false, banned: false, requiresReconnect: true };
  }
  return { code: 'provider_action_failed', cooldown: false, banned: false, requiresReconnect: false };
}

export class SocialAccountService {
  private readonly supabase = getServiceSupabaseClient();
  private readonly pendingTelegram = new Map<string, any>();
  private readonly pendingSignal = new Map<string, { userId: string; phone: string; createdAt: number; authDir: string }>();
  private readonly pendingWhatsApp = new Map<string, {
    userId: string;
    phone: string;
    sock: any;
    authDir: string;
    finalizing?: Promise<void>;
    waitForCredentials: () => Promise<void>;
  }>();
  // Keep one live Baileys socket per connected user while the backend process
  // is running. WhatsApp does not expose reliable history from a freshly
  // materialized auth bundle, so inbound events must be buffered as they arrive
  // and then consumed by the shared inbound-DM pipeline.
  private readonly whatsappSockets = new Map<string, any>();
  private readonly whatsappAuthDirs = new Map<string, string>();
  private readonly whatsappPersistTimers = new Map<string, NodeJS.Timeout>();
  private readonly whatsappReconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly whatsappReconnectAttempts = new Map<string, number>();
  private readonly whatsappInbound = new Map<string, PersonalInboundMessage[]>();

  /**
   * Telegram's MTProto app credentials belong to Adirum's server, not to an
   * end user. They are loaded only from server secrets and are never copied
   * into a user's encrypted connection record or returned from an API route.
   */
  private telegramAppConfig(): { apiId: number; apiHash: string } {
    const apiId = Number(process.env.TELEGRAM_API_ID || process.env.TELEGRAM_APP_API_ID || 0);
    const apiHash = String(process.env.TELEGRAM_API_HASH || process.env.TELEGRAM_APP_API_HASH || '').trim();
    if (!apiId || !apiHash) {
      console.error('[SocialAccountService] Telegram server credentials are not configured.');
      throw new Error('TELEGRAM_SERVER_NOT_READY');
    }
    return { apiId, apiHash };
  }

  private telegramClient(session: string): any {
    let telegram: any;
    try {
      telegram = require('telegram');
    } catch {
      throw new Error('TELEGRAM_SERVER_NOT_READY');
    }
    const { apiId, apiHash } = this.telegramAppConfig();
    return new telegram.TelegramClient(
      new telegram.sessions.StringSession(session || ''),
      apiId,
      apiHash,
      { connectionRetries: 3 },
    );
  }

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
          if (message.key) {
            setTimeout(() => {
              void Promise.resolve(sock.readMessages?.([message.key])).catch(() => {});
            }, 1400 + Math.floor(Math.random() * 2600));
          }
        }
      }
    });
  }

  private async persistWhatsAppInbound(userId: string, message: PersonalInboundMessage): Promise<void> {
    await this.persistInboundMessages(userId, 'whatsapp_personal', [message]);
  }

  private async persistInboundMessages(
    userId: string,
    provider: string,
    messages: PersonalInboundMessage[],
  ): Promise<void> {
    if (!messages.length) return;
    const rows = messages.map((message) => ({
      user_id: userId,
      provider: normalizePlatform(provider),
      external_id: message.externalId,
      sender_id: message.senderId,
      message: message.text,
      message_timestamp: message.timestamp,
    }));
    const { error } = await this.supabase
      .from('personal_inbound_messages')
      .upsert(rows, { onConflict: 'user_id,provider,external_id' });
    if (error) {
      console.error(
        `[SocialAccountService] ${normalizePlatform(provider)} inbound persistence failed `
        + `(user=${userId}, count=${messages.length}): ${error.message}`,
      );
    }
  }

  private messageFingerprint(recipient: string, text: string): string {
    return crypto.createHash('sha256')
      .update(`${String(recipient).trim().toLowerCase()}\n${String(text).trim().toLowerCase()}`)
      .digest('hex');
  }

  private async assertMessageVariation(userId: string, provider: string, recipient: string, text: string): Promise<void> {
    const row = await this.get(userId, provider);
    const fingerprints = Array.isArray(row?.metadata?.recent_outbound_fingerprints)
      ? row.metadata.recent_outbound_fingerprints
      : [];
    const fingerprint = this.messageFingerprint(recipient, text);
    if (fingerprints.some((item: any) => item?.fingerprint === fingerprint
      && Date.now() - new Date(item.createdAt || 0).getTime() < 30 * 24 * 60 * 60 * 1000)) {
      throw new Error('This account recently sent identical content to this recipient. Create a natural variation before sending again.');
    }
  }

  private async rememberMessageFingerprint(userId: string, provider: string, recipient: string, text: string): Promise<void> {
    const row = await this.get(userId, provider);
    if (!row) return;
    const existing = Array.isArray(row.metadata?.recent_outbound_fingerprints)
      ? row.metadata.recent_outbound_fingerprints
      : [];
    const next = [
      ...existing,
      { fingerprint: this.messageFingerprint(recipient, text), createdAt: new Date().toISOString() },
    ].slice(-100);
    await this.supabase.from('social_account_connections').update({
      metadata: { ...(row.metadata || {}), recent_outbound_fingerprints: next },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
  }

  private async sendTyping(provider: string, credential: any, recipient: string, clientOrSocket?: any): Promise<void> {
    try {
      if (provider === 'telegram' && clientOrSocket) {
        const telegram = require('telegram');
        await clientOrSocket.invoke(new telegram.Api.messages.SetTyping({
          peer: recipient,
          action: new telegram.Api.SendMessageTypingAction(),
        }));
      } else if (provider === 'whatsapp_personal' && clientOrSocket) {
        await clientOrSocket.sendPresenceUpdate?.('composing', this.normalizeWhatsAppRecipient(recipient));
      } else if (provider === 'signal_personal') {
        const exec = promisify(execFile);
        const configDir = await this.materializeSignalBundle(credential);
        try {
          await exec(signalCliPath(), ['--config', configDir, '-u', credential.phone, 'sendTyping', recipient], { timeout: 10000 });
        } finally {
          await fs.rm(configDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {
      // Typing is best effort and must not make a provider unavailable.
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

  private async saveWhatsAppPairingSession(
    userId: string,
    phoneNumber: string,
    authDir: string,
    waitForCredentials?: () => Promise<void>,
  ): Promise<void> {
    await persistWhatsAppPairingSession({
      authDir,
      waitForCredentials,
      persist: async (bundle) => {
        await this.save({
          userId,
          provider: 'whatsapp_personal',
          accountId: phoneNumber,
          displayName: phoneNumber,
          handle: phoneNumber,
          credential: { bundle },
        });
      },
    });
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
    const sock = baileys.default({
      auth: state,
      printQRInTerminal: false,
      qrTimeout: 120000,
      browser: ['Ubuntu', 'Chrome', '1.0.0'],
    });
    sock.ev.on('creds.update', (update: any) => {
      void saveCreds(update);
      this.scheduleWhatsAppCredentialPersist(userId, authDir);
    });
    this.attachWhatsAppInbound(userId, sock);
    this.whatsappAuthDirs.set(userId, authDir);
    sock.ev.on('connection.update', async (update: any) => {
      if (update.connection !== 'close') return;
      const statusCode = Number(update?.lastDisconnect?.error?.output?.statusCode || 0);
      const terminal = [401, 403, 405].includes(statusCode);
      if (this.whatsappSockets.get(userId) === sock) this.whatsappSockets.delete(userId);
      if (this.whatsappAuthDirs.get(userId) === authDir) this.whatsappAuthDirs.delete(userId);
      await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
      if (terminal) {
        const message = statusCode === 403
          ? 'WhatsApp session was rejected or banned. Reconnect the account.'
          : 'WhatsApp session expired or was logged out. Reconnect the account.';
        console.error(`[SocialAccountService] WhatsApp session for ${userId} requires reconnect (${statusCode || 'auth failure'})`);
        await this.supabase.from('social_account_connections').update({
          status: 'needs_reconnect',
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId).eq('provider', 'whatsapp_personal');
        this.whatsappReconnectAttempts.delete(userId);
      } else {
        this.scheduleWhatsAppReconnect(userId);
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WhatsApp connection timed out.')), 30000);
        sock.ev.on('connection.update', (update: any) => {
          if (update.connection === 'open') {
            clearTimeout(timer);
            this.whatsappSockets.set(userId, sock);
            this.whatsappReconnectAttempts.delete(userId);
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

  private scheduleWhatsAppReconnect(userId: string): void {
    if (this.whatsappReconnectTimers.has(userId)) return;
    const attempt = Math.min(6, Number(this.whatsappReconnectAttempts.get(userId) || 0));
    const delayMs = Math.min(60_000, 2_000 * Math.pow(2, attempt));
    this.whatsappReconnectAttempts.set(userId, attempt + 1);
    const timer = setTimeout(async () => {
      this.whatsappReconnectTimers.delete(userId);
      try {
        const row = await this.get(userId, 'whatsapp_personal');
        if (!row || row.status !== 'connected') return;
        const credential = decrypt(row);
        if (!credential) throw new Error('Encrypted WhatsApp credentials are unavailable.');
        await this.restoreWhatsAppSocket(userId, credential);
        console.log(`[SocialAccountService] WhatsApp session restored for ${userId}`);
      } catch (error: any) {
        console.error(`[SocialAccountService] WhatsApp reconnect attempt failed for ${userId}: ${error.message}`);
        const row = await this.get(userId, 'whatsapp_personal').catch(() => null);
        if (row?.status === 'connected') this.scheduleWhatsAppReconnect(userId);
      }
    }, delayMs);
    this.whatsappReconnectTimers.set(userId, timer);
    console.warn(`[SocialAccountService] Scheduling WhatsApp reconnect for ${userId} in ${delayMs}ms`);
  }

  /**
   * Rehydrate every connected WhatsApp auth bundle after a Railway process
   * restart. The encrypted Supabase bundle is the source of truth; the live
   * socket is deliberately process-local and rebuilt here.
   */
  async restoreConnectedWhatsAppSockets(): Promise<void> {
    const { data, error } = await this.supabase
      .from('social_account_connections')
      .select('user_id, status, credential_ciphertext, credential_iv, credential_tag')
      .eq('provider', 'whatsapp_personal')
      .eq('status', 'connected');
    if (error) {
      console.error(`[SocialAccountService] WhatsApp startup restore query failed: ${error.message}`);
      return;
    }
    for (const row of data || []) {
      try {
        const credential = decrypt(row);
        if (!credential) throw new Error('Encrypted auth bundle is unavailable.');
        await this.restoreWhatsAppSocket(row.user_id, credential);
        console.log(`[SocialAccountService] Restored WhatsApp live session for ${row.user_id}`);
      } catch (restoreError: any) {
        console.error(`[SocialAccountService] WhatsApp startup restore failed for ${row.user_id}: ${restoreError.message}`);
        this.scheduleWhatsAppReconnect(row.user_id);
      }
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
    const normalized = normalizePlatform(provider);
    const row = await this.get(userId, normalized);
    if (!row) return null;
    const credential = decrypt(row);
    if (
      normalized === 'telegram'
      && credential
      && (Object.prototype.hasOwnProperty.call(credential, 'apiId')
        || Object.prototype.hasOwnProperty.call(credential, 'apiHash'))
    ) {
      // Older connections stored the server app credentials alongside the
      // user's session. Remove those fields the next time the record is read.
      const sanitized = { session: credential.session, phone: credential.phone };
      const encrypted = encrypt(sanitized);
      await this.supabase.from('social_account_connections').update({
        credential_ciphertext: encrypted.ciphertext,
        credential_iv: encrypted.iv,
        credential_tag: encrypted.tag,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      return sanitized;
    }
    return credential;
  }

  async remove(userId: string, provider: string): Promise<void> {
    provider = normalizePlatform(provider);
    if (provider === 'delta_chat') {
      // Let the configured bridge release the account before deleting the
      // local opaque credential. If it cannot acknowledge disconnect, keep the
      // local row so an operator can retry instead of orphaning the bridge
      // session.
      await this.deltaChatRequest(userId, 'disconnect', {});
    }
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
      const reconnectTimer = this.whatsappReconnectTimers.get(userId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      this.whatsappReconnectTimers.delete(userId);
      this.whatsappReconnectAttempts.delete(userId);
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
    const { data: activeStrategies, error: strategyError } = await this.supabase
      .from('strategies')
      .select('selected_accounts, platforms')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('status', 'active');
    if (strategyError) {
      console.error(`[SocialAccountService] Active strategy selection check failed for ${provider}: ${strategyError.message}`);
      return false;
    }
    const selectedByActiveStrategy = (activeStrategies || []).some((strategy: any) => {
      const selected = normalizeSelectedPlatforms(strategy.selected_accounts || strategy.platforms || []);
      return selected.includes(provider);
    });
    if (!selectedByActiveStrategy) {
      console.warn(`[SocialAccountService] Blocked ${provider} action because no active strategy selected it.`);
      return false;
    }
    const recipientKey = recipient
      ? crypto.createHash('sha256').update(String(recipient)).digest('hex').slice(0, 24)
      : null;
    const { data, error } = await this.supabase.rpc('reserve_social_action', {
      p_user_id: userId,
      p_provider: provider,
      p_recipient_hash: recipientKey,
    });
    if (error) {
      console.error(`[SocialAccountService] Atomic action reservation failed for ${provider}: ${error.message}`);
      return false;
    }
    return data?.allowed === true;
  }

  async recordError(userId: string, provider: string, message: string): Promise<void> {
    provider = normalizePlatform(provider);
    const row = await this.get(userId, provider);
    const consecutiveErrors = Number(row?.consecutive_errors || 0) + 1;
    const classification = classifyProviderError(provider, message);
    const shouldPause = consecutiveErrors >= 3 || classification.cooldown;
    const cooldownUntil = shouldPause
      ? new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * Math.pow(2, Math.min(consecutiveErrors - 3, 4)))).toISOString()
      : null;
    const nextStatus = classification.requiresReconnect
      ? 'needs_reconnect'
      : classification.banned
        ? 'paused'
        : shouldPause ? 'paused' : 'error';
    await this.supabase.from('social_account_connections').update({
      status: nextStatus,
      last_error: `${classification.code}: ${message}`.slice(0, 500),
      consecutive_errors: consecutiveErrors,
      cooldown_until: cooldownUntil,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', provider);
    await this.supabase.from('social_action_log').insert({
      user_id: userId,
      provider,
      action_type: 'send_personal_message',
      status: 'failure',
      error_code: classification.code,
      safe_error: message.slice(0, 500),
    }).then(({ error }) => {
      if (error) console.error(`[SocialAccountService] Action failure log failed: ${error.message}`);
    });
  }

  async recordSuccess(userId: string, provider: string): Promise<void> {
    const normalized = normalizePlatform(provider);
    await this.supabase.from('social_account_connections').update({
      consecutive_errors: 0,
      cooldown_until: null,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('provider', normalized);
    await this.supabase.from('social_action_log').insert({
      user_id: userId,
      provider: normalized,
      action_type: 'send_personal_message',
      status: 'success',
    }).then(({ error }) => {
      if (error) console.error(`[SocialAccountService] Action success log failed: ${error.message}`);
    });
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
    const { apiId, apiHash } = this.telegramAppConfig();
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
    this.pendingTelegram.set(requestId, { userId, client, phone, phoneCodeHash: result.phoneCodeHash });
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
      // Only the user's session and phone are stored. The app credentials
      // remain server-scoped and are loaded from secrets when needed.
      credential: { session, phone: pending.phone },
    });
  }

  async startWhatsAppPairing(userId: string, phone: string): Promise<{ requestId: string; pairingCode: string }> {
    let baileys: any;
    try { baileys = require('@whiskeysockets/baileys'); } catch { throw new Error('WhatsApp pairing service is not installed.'); }
    const phoneNumber = phone.replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(phoneNumber)) {
      throw new Error('Enter a WhatsApp phone number with its country code.');
    }
    const requestId = crypto.randomUUID();
    const authDir = path.join(os.tmpdir(), 'adroom-whatsapp', requestId);
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    // Use a canonical browser/OS tuple for pairing. Baileys rc14 sends the
    // tuple's OS label to WhatsApp as "Chrome (<OS>)"; custom labels produce
    // codes that look valid but are rejected by the phone.
    const sock = baileys.default({
      auth: state,
      printQRInTerminal: false,
      qrTimeout: 120000,
      browser: ['Ubuntu', 'Chrome', '1.0.0'],
    });
    let credentialsSaved = Promise.resolve();
    sock.ev.on('creds.update', (update: any) => {
      credentialsSaved = Promise.resolve(saveCreds(update));
      void credentialsSaved.catch(() => {});
      this.scheduleWhatsAppCredentialPersist(userId, authDir);
    });
    this.attachWhatsAppInbound(userId, sock);
    this.pendingWhatsApp.set(requestId, {
      userId,
      phone: phoneNumber,
      sock,
      authDir,
      waitForCredentials: () => credentialsSaved,
    });
    sock.ev.on('connection.update', async (update: any) => {
      const pending = this.pendingWhatsApp.get(requestId);
      if (update.isNewLogin && pending) {
        pending.finalizing = this.saveWhatsAppPairingSession(userId, phoneNumber, authDir)
          .catch(async (error: any) => {
            await this.recordError(userId, 'whatsapp_personal', error.message);
            throw error;
          });
        await pending.finalizing.catch(() => {});
      }
      if (update.connection === 'close') {
        // A successful first pair commonly closes with 515/restartRequired.
        // Keep the newly saved session available for the reconnect instead of
        // deleting the temporary auth state as if pairing had failed.
        if (pending?.finalizing) await pending.finalizing.catch(() => {});
        this.pendingWhatsApp.delete(requestId);
        if (this.whatsappSockets.get(userId) === sock) this.whatsappSockets.delete(userId);
        if (this.whatsappAuthDirs.get(userId) === authDir) this.whatsappAuthDirs.delete(userId);
        await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
        return;
      }
      if (update.connection === 'open') {
        try {
          await this.saveWhatsAppPairingSession(
            userId,
            phoneNumber,
            authDir,
            pending?.waitForCredentials,
          );
          this.whatsappSockets.set(userId, sock);
          this.whatsappAuthDirs.set(userId, authDir);
        } catch (error: any) {
          await this.recordError(userId, 'whatsapp_personal', error.message);
        }
        this.pendingWhatsApp.delete(requestId);
        return;
      }
    });
    try {
      const pairingCode = await requestWhatsAppPairingCodeWhenReady(sock, phoneNumber);
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
      await exec(signalCliPath(), ['--config', authDir, '-u', phone, 'register'], { timeout: 30000 });
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
      await exec(signalCliPath(), ['--config', pending.authDir, '-u', pending.phone, 'verify', code], { timeout: 30000 });
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
      await this.assertMessageVariation(userId, provider, requestedRecipient, text);
      if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
      await this.safetyDelay(provider);
      const credential = await this.credentials(userId, provider);
      if (!credential) throw new Error(`${provider} credentials are unavailable.`);
      try {
        if (provider === 'telegram') {
          const client = this.telegramClient(credential.session);
          await client.connect();
           const recipient = requestedRecipient;
            await this.sendTyping(provider, credential, recipient, client);
            await new Promise((resolve) => setTimeout(resolve, 600 + Math.floor(Math.random() * 1600)));
          const result = mediaUrl
             ? await client.sendFile(recipient, { file: mediaUrl, caption: text.slice(0, 4000) })
             : await client.sendMessage(recipient, { message: text.slice(0, 4000) });
          await client.disconnect();
          await this.recordSuccess(userId, provider);
          return { id: String(result?.id || `telegram:${Date.now()}`), url: credential.handle ? `https://t.me/${String(credential.handle).replace(/^@/, '')}` : undefined };
        }

        if (provider === 'whatsapp_personal') {
           const liveSocket = await this.restoreWhatsAppSocket(userId, credential);
           if (!liveSocket) throw new Error('WhatsApp live session is not connected. Reconnect the account and try again.');
           const jid = requestedRecipient.includes('@')
             ? requestedRecipient
             : `${requestedRecipient.replace(/\D/g, '')}@s.whatsapp.net`;
            await this.sendTyping(provider, credential, jid, liveSocket);
            await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 1200)));
            const mediaPayload = mediaUrl
              ? await this.buildWhatsAppMediaMessage(mediaUrl, text)
              : null;
            const result = await liveSocket.sendMessage(jid, mediaPayload?.message || { text: text.slice(0, 4000) });
            if (mediaPayload?.filePath) await fs.rm(mediaPayload.filePath, { force: true }).catch(() => {});
           await this.recordSuccess(userId, provider);
            await this.rememberMessageFingerprint(userId, provider, requestedRecipient, text);
           return { id: String(result?.key?.id || `whatsapp:${Date.now()}`) };
        }

        const exec = promisify(execFile);
        const phone = requestedRecipient;
         await this.sendTyping(provider, credential, phone);
         await new Promise((resolve) => setTimeout(resolve, 900 + Math.floor(Math.random() * 2600)));
        const configDir = await this.materializeSignalBundle(credential);
         let attachmentPath: string | null = null;
        try {
           const args = ['--config', configDir, '-u', credential.phone, 'send', '-m', text.slice(0, 2000)];
           if (mediaUrl) {
             const attachment = await this.materializeMediaAttachment(mediaUrl, 'adroom-signal-attachment');
             attachmentPath = attachment.filePath;
             args.push('--attachment', attachment.filePath);
           }
           args.push(phone);
            await exec(signalCliPath(), args, { timeout: 30000 });
        } finally {
           if (attachmentPath) await fs.rm(attachmentPath, { force: true }).catch(() => {});
          await fs.rm(configDir, { recursive: true, force: true });
        }
        await this.recordSuccess(userId, provider);
         await this.rememberMessageFingerprint(userId, provider, requestedRecipient, text);
        return { id: `signal:${Date.now()}` };
      } catch (error: any) {
        await this.recordError(userId, provider, error.message);
        throw error;
      }
    }
    if (provider === 'bluesky') {
      await this.assertMessageVariation(userId, provider, destination || 'public-feed', text);
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
        await this.rememberMessageFingerprint(userId, provider, destination || 'public-feed', text);
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

  private async materializeMediaAttachment(mediaUrl: string, prefix: string): Promise<{ filePath: string; mimeType: string }> {
    const value = String(mediaUrl || '').trim();
    if (!value) throw new Error('Media URL is empty.');

    let bytes: Buffer;
    let mimeType = '';
    if (value.startsWith('data:')) {
      const match = value.match(/^data:([^;,]+);base64,(.+)$/s);
      if (!match) throw new Error('Generated media data is not a valid base64 data URI.');
      mimeType = match[1];
      bytes = Buffer.from(match[2], 'base64');
    } else {
      const response = await fetch(value);
      if (!response.ok) throw new Error(`Media download failed with HTTP ${response.status}.`);
      mimeType = response.headers.get('content-type')?.split(';')[0].trim() || '';
      bytes = Buffer.from(await response.arrayBuffer());
    }

    const extensionByMime: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.ogg',
      'application/pdf': '.pdf',
    };
    const extension = extensionByMime[mimeType] || path.extname(value.split('?')[0]).slice(0, 8) || '.bin';
    const filePath = path.join(os.tmpdir(), prefix, `${crypto.randomUUID()}${extension}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return { filePath, mimeType };
  }

  private async buildWhatsAppMediaMessage(mediaUrl: string, caption: string): Promise<{ message: any; filePath: string }> {
    const media = await this.materializeMediaAttachment(mediaUrl, 'adroom-whatsapp-media');
    const base = { url: media.filePath };
    const common = { caption: caption.slice(0, 4000) };
    if (media.mimeType.startsWith('image/')) return { message: { image: base, ...common }, filePath: media.filePath };
    if (media.mimeType.startsWith('video/')) return { message: { video: base, ...common }, filePath: media.filePath };
    if (media.mimeType.startsWith('audio/')) return { message: { audio: base, ptt: false }, filePath: media.filePath };
    return {
      message: { document: base, fileName: `adirum-creative${path.extname(media.filePath)}`, ...common },
      filePath: media.filePath,
    };
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
    await this.assertMessageVariation(userId, provider, recipient, text);
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
          await exec(signalCliPath(), ['--config', tempDir, '-u', credential.phone, 'send', '-m', text.slice(0, 2000), recipient], { timeout: 30000 });
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
        await this.recordSuccess(userId, provider);
        return;
      }

      if (provider === 'telegram') {
        const client = this.telegramClient(credential.session);
        await client.connect();
        await this.sendTyping(provider, credential, recipient, client);
        await new Promise((resolve) => setTimeout(resolve, 600 + Math.floor(Math.random() * 1600)));
        await client.sendMessage(recipient, { message: text.slice(0, 4000) });
        await client.disconnect();
        await this.recordSuccess(userId, provider);
        await this.rememberMessageFingerprint(userId, provider, recipient, text);
        return;
      }

      if (provider === 'whatsapp_personal') {
        let baileys: any;
        try { baileys = require('@whiskeysockets/baileys'); } catch { throw new Error('WhatsApp pairing service is not installed.'); }
        const liveSocket = await this.restoreWhatsAppSocket(userId, credential);
        if (liveSocket) {
          const jid = recipient.includes('@') ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
          await this.sendTyping(provider, credential, jid, liveSocket);
          await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 1200)));
          await liveSocket.sendMessage(jid, { text: text.slice(0, 4000) });
          await this.recordSuccess(userId, provider);
          await this.rememberMessageFingerprint(userId, provider, recipient, text);
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
          await this.sendTyping(provider, credential, jid, sock);
          await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 1200)));
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
        await this.rememberMessageFingerprint(userId, provider, recipient, text);
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
      const client = this.telegramClient(credential.session);
      await client.connect();
      try {
        const messages = await client.getMessages(recipient, { limit: Math.min(50, Math.max(1, limit)) });
         const inbound = (messages || [])
          .filter((message: any) => !message?.out && String(message?.message || '').trim())
          .map((message: any) => ({
            externalId: `telegram:${message.id}`,
            senderId: String(message.senderId?.value || message.senderId || recipient),
            text: String(message.message).trim(),
            timestamp: new Date(Number(message.date || 0) * 1000 || Date.now()).toISOString(),
          }));
         if (inbound.length) {
           await new Promise((resolve) => setTimeout(resolve, 1200 + Math.floor(Math.random() * 1800)));
           try { await client.markAsRead?.(recipient); } catch {}
         }
          await this.persistInboundMessages(userId, provider, inbound);
          return inbound;
      } finally {
        await client.disconnect();
      }
    }

    if (provider === 'signal_personal') {
      const exec = promisify(execFile);
      const configDir = await this.materializeSignalBundle(credential);
      try {
        const result = await exec(signalCliPath(), [
          '--config', configDir,
          '-u', credential.phone,
          'receive',
          '--timeout', '1',
          '--max-messages', String(Math.min(100, Math.max(1, limit))),
          '--json',
        ], { timeout: 15000 });
        const inbound = result.stdout
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
        await this.persistInboundMessages(userId, provider, inbound);
        return inbound;
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
       const inbound = (messages?.messages || [])
        .filter((message: any) => message?.sender?.did !== credential.did && String(message?.message?.text || '').trim())
        .map((message: any) => ({
          externalId: `bluesky:${message.id}`,
          senderId: String(message.sender?.did || recipient),
          text: String(message.message.text).trim(),
          timestamp: message.sentAt || new Date().toISOString(),
        }));
       await this.persistInboundMessages(userId, provider, inbound);
       return inbound;
    }

    if (provider === 'delta_chat') {
      const result = await this.deltaChatRequest(userId, 'receive', { recipient, limit });
      const messages = Array.isArray(result) ? result : (result?.messages || []);
      const inbound = messages
        .map((message: any) => ({
          externalId: `delta-chat:${message.id || message.messageId || crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex').slice(0, 20)}`,
          senderId: String(message.senderId || message.sender || recipient),
          text: String(message.text || message.message || '').trim(),
          timestamp: message.timestamp || message.createdAt || new Date().toISOString(),
        }))
        .filter((message: PersonalInboundMessage) => Boolean(message.text));
      await this.persistInboundMessages(userId, provider, inbound);
      return inbound;
    }

    // Baileys does not expose reliable historical message retrieval for a
    // freshly materialized auth bundle. Live WhatsApp events are handled by
    // the connection listener; do not fabricate an empty successful poll.
    if (provider === 'whatsapp_personal') {
      await this.restoreWhatsAppSocket(userId, credential);
       const persisted = await this.supabase
        .from('personal_inbound_messages')
         .select('external_id, sender_id, message, message_timestamp')
        .eq('user_id', userId)
        .eq('provider', 'whatsapp_personal')
         .order('message_timestamp', { ascending: false })
        .limit(Math.min(100, Math.max(1, limit)));
       if (persisted.error) {
         console.error(`[SocialAccountService] WhatsApp inbound history read failed: ${persisted.error.message}`);
         throw new Error(`WhatsApp inbound history is unavailable: ${persisted.error.message}`);
       }
      const persistedMessages: PersonalInboundMessage[] = (persisted.data || []).map((message: any) => ({
        externalId: String(message.external_id),
        senderId: String(message.sender_id),
        text: String(message.message || ''),
        timestamp: normalizeInboundMessageTimestamp(message, message?.message_timestamp ?? message?.received_at ?? message?.created_at ?? new Date()),
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
    if (!['connect', 'send', 'publish', 'receive', 'disconnect'].includes(operation)) {
      throw new Error(`Delta Chat operation "${operation}" is not supported.`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(bridgeUrl);
    } catch {
      throw new Error('DELTA_CHAT_BRIDGE_URL is invalid. Use an https URL.');
    }
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
      throw new Error('DELTA_CHAT_BRIDGE_URL must use http or https.');
    }
    const credential = operation === 'connect' ? undefined : (await this.credentials(userId, 'delta_chat'))?.bridgeCredential;
    let response: any;
    try {
      response = await fetch(`${bridgeUrl}/${operation}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.DELTA_CHAT_BRIDGE_TOKEN ? { Authorization: `Bearer ${process.env.DELTA_CHAT_BRIDGE_TOKEN}` } : {}),
        },
        body: JSON.stringify({ userId, credential, ...body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error: any) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`Delta Chat bridge timed out during ${operation}.`);
      }
      throw new Error(`Delta Chat bridge unavailable during ${operation}.`);
    }
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Delta Chat bridge authentication failed during ${operation}.`);
      }
      throw new Error(data.error || data.message || `Delta Chat ${operation} failed.`);
    }
    return data;
  }
}

export const socialAccountService = new SocialAccountService();