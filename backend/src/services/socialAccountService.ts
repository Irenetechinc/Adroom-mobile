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
    private readonly pendingSignal = new Map<string, { userId: string; phone: string; createdAt: number }>();
  private readonly pendingWhatsApp = new Map<string, { userId: string; phone: string; sock: any; authDir: string }>();

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
  }

  async reserveAction(userId: string, provider: string, recipient?: string): Promise<boolean> {
    provider = normalizePlatform(provider);
    if (!(await isFeatureEnabled(`social_${provider}_connections`, userId))) return false;
    const row = await this.get(userId, provider);
    if (!row || row.status !== 'connected') return false;
    if (row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now()) return false;
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
    this.pendingSignal.set(requestId, { userId, phone, createdAt: Date.now() });
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
    provider = normalizePlatform(provider);
    await this.assertProviderEnabled(userId, provider);
    if (provider === 'delta_chat') {
      return this.deltaChatRequest(userId, 'publish', { text, mediaUrl });
    }
    if (provider === 'bluesky') {
      if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
      await this.safetyDelay(provider);
      const credential = await this.credentials(userId, provider);
      if (!credential?.accessJwt || !credential?.did) throw new Error('Bluesky credentials are unavailable.');
      try {
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
        await this.recordSuccess(userId, provider);
        return { id: data.uri, url: credential.handle ? `https://bsky.app/profile/${credential.handle}` : undefined };
      } catch (error: any) {
        await this.recordError(userId, provider, error.message);
        throw error;
      }
    }
    throw new Error(`Publishing is not supported for ${provider} yet.`);
  }

  async sendMessage(provider: string, userId: string, recipient: string, text: string): Promise<void> {
    provider = normalizePlatform(provider);
    await this.assertProviderEnabled(userId, provider);
    if (!(await this.reserveAction(userId, provider))) throw new Error(`${provider} daily safety limit reached or account is not ready.`);
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
        await exec('signal-cli', ['-u', credential.phone, 'send', '-m', text.slice(0, 2000), recipient], { timeout: 30000 });
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