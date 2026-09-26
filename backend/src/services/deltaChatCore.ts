import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';

type RpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type DeltaChatCredential = {
  token: string;
};

export type DeltaChatMessage = {
  externalId: string;
  senderId: string;
  text: string;
  timestamp: string;
};

/**
 * The bridge URL points back to this backend in the current deployment. Use an
 * explicit bridge token when one is configured; otherwise derive an internal
 * token from the existing server secret without sending the secret itself.
 */
export function deltaChatBridgeToken(): string {
  const explicit = String(process.env.DELTA_CHAT_BRIDGE_TOKEN || '').trim();
  if (explicit) return explicit;
  const secret = String(process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || '').trim();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update('adroom-delta-chat-bridge-v1').digest('hex');
}

function configuredPath(value: string | undefined, fallback: string): string {
  return String(value || '').trim() || fallback;
}

function credentialKey(): Buffer {
  const secret = String(process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || '').trim();
  if (!secret) throw new Error('Delta Chat credential encryption is not configured.');
  return crypto.createHash('sha256').update(`delta-chat-credential-v1:${secret}`).digest();
}

function toBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sealCredential(accountId: number, userId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ version: 1, accountId, userId }), 'utf8'),
    cipher.final(),
  ]);
  return [
    'dc1',
    toBase64Url(iv),
    toBase64Url(ciphertext),
    toBase64Url(cipher.getAuthTag()),
  ].join('.');
}

function numericAccountId(credential: unknown, userId: string): number {
  const token = typeof credential === 'object' && credential !== null
    ? String((credential as Record<string, unknown>).token || '')
    : String(credential || '');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'dc1') {
    throw new Error('Delta Chat account credential is invalid.');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      credentialKey(),
      fromBase64Url(parts[1]),
    );
    decipher.setAuthTag(fromBase64Url(parts[3]));
    const payload = JSON.parse(Buffer.concat([
      decipher.update(fromBase64Url(parts[2])),
      decipher.final(),
    ]).toString('utf8'));
    if (payload?.version !== 1 || payload?.userId !== userId) {
      throw new Error('Delta Chat account credential does not belong to this user.');
    }
    const accountId = Number(payload.accountId);
    if (!Number.isInteger(accountId) || accountId < 1) throw new Error('invalid account id');
    return accountId;
  } catch (error: any) {
    if (/does not belong/.test(error.message)) throw error;
    throw new Error('Delta Chat account credential is invalid.');
  }
}

function messageIdFromListItem(item: any): number | null {
  if (!item || item.kind === 'dayMarker' || item.kind === 'daymarker') return null;
  const id = Number(item.msg_id ?? item.msgId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export class DeltaChatCore {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private startPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  private readonly binaryPath = configuredPath(
    process.env.DELTA_CHAT_RPC_PATH,
    path.resolve(__dirname, '../../bin/deltachat-rpc-server'),
  );

  private readonly accountsPath = configuredPath(
    process.env.DELTA_CHAT_ACCOUNTS_PATH,
    path.resolve(process.cwd(), '.data/delta-chat'),
  );

  private timeoutMs(): number {
    const value = Number(process.env.DELTA_CHAT_RPC_TIMEOUT_MS || 120_000);
    return Number.isFinite(value) && value >= 5_000 ? value : 120_000;
  }

  private async start(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      await fs.mkdir(this.accountsPath, { recursive: true });
      const child = spawn(this.binaryPath, [], {
        cwd: this.accountsPath,
        env: { ...process.env, DC_ACCOUNTS_PATH: this.accountsPath },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.child = child;
      this.reader = readline.createInterface({ input: child.stdout });
      this.reader.on('line', (line) => this.handleResponse(line));
      child.stderr.on('data', (chunk) => {
        const message = String(chunk).trim();
        if (message) console.warn(`[DeltaChatCore] ${message}`);
      });
      child.once('error', (error) => this.failPending(new Error(`Delta Chat Core failed to start: ${error.message}`)));
      child.once('exit', (code, signal) => {
        this.reader?.close();
        this.reader = null;
        this.child = null;
        this.failPending(new Error(`Delta Chat Core stopped${code === null ? ` (${signal || 'unknown signal'})` : ` with code ${code}`}.`));
      });

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          cleanup();
          reject(new Error(`Delta Chat Core failed to start: ${error.message}`));
        };
        const onSpawn = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          child.off('error', onError);
          child.off('spawn', onSpawn);
        };
        child.once('error', onError);
        child.once('spawn', onSpawn);
      });

    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private handleResponse(line: string): void {
    let response: RpcResponse;
    try {
      response = JSON.parse(line);
    } catch {
      console.warn('[DeltaChatCore] Ignoring non-JSON RPC output.');
      return;
    }
    const id = Number(response.id);
    if (!Number.isInteger(id)) return;
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (response.error) {
      request.reject(new Error(response.error.message || 'Delta Chat Core request failed.'));
      return;
    }
    request.resolve(response.result);
  }

  private failPending(error: Error): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pending.delete(id);
    }
  }

  private async call(method: string, params: any[] = [], timeoutOverrideMs?: number): Promise<any> {
    await this.start();
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new Error('Delta Chat Core is not running.');
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Delta Chat Core timed out during ${method}.`));
      }, timeoutOverrideMs ?? this.timeoutMs());
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Delta Chat Core request failed: ${error.message}`));
      }
    });
  }

  private async resolveChat(accountId: number, recipient: string): Promise<number> {
    const address = String(recipient || '').trim();
    if (!address) throw new Error('Delta Chat recipient is required.');
    let contactId = await this.call('lookup_contact_id_by_addr', [accountId, address]);
    if (!contactId) contactId = await this.call('create_contact', [accountId, address, null]);
    let chatId = await this.call('get_chat_id_by_contact_id', [accountId, contactId]);
    if (!chatId) chatId = await this.call('create_chat_by_contact_id', [accountId, contactId]);
    return Number(chatId);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Capability checks are requested by account screens and must fail
      // quickly when the binary is missing or the RPC process is unhealthy.
      await this.call('get_all_account_ids', [], Math.min(this.timeoutMs(), 5000));
      return true;
    } catch (error: any) {
      console.warn(`[DeltaChatCore] Health check failed: ${error.message}`);
      return false;
    }
  }

  async connect(address: string, password: string): Promise<{
    credential: DeltaChatCredential;
    accountId: string;
    displayName: string;
  }> {
    return this.connectForUser('', address, password);
  }

  private async connectForUser(userId: string, address: string, password: string): Promise<{
    credential: DeltaChatCredential;
    accountId: string;
    displayName: string;
  }> {
    const accountId = Number(await this.call('add_account', []));
    try {
      await this.call('add_or_update_transport', [
        accountId,
        { addr: address, password },
      ]);
      await this.call('start_io_for_all_accounts', []);
      const account = await this.call('get_account_info', [accountId]);
      return {
        credential: { token: sealCredential(accountId, userId) },
        accountId: address,
        displayName: String(account?.displayName || address),
      };
    } catch (error) {
      await this.call('remove_account', [accountId]).catch(() => {});
      throw error;
    }
  }

  async connectAsUser(userId: string, address: string, password: string): Promise<{
    credential: DeltaChatCredential;
    accountId: string;
    displayName: string;
  }> {
    if (!userId) throw new Error('Delta Chat user identity is required.');
    return this.connectForUser(userId, address, password);
  }

  async disconnect(credential: DeltaChatCredential, userId: string): Promise<void> {
    await this.call('remove_account', [numericAccountId(credential, userId)]);
  }

  async send(
    credential: DeltaChatCredential,
    recipient: string,
    text: string,
    userId: string,
  ): Promise<{ id: string; accountId: string; chatId: number; messageId: number }> {
    const accountId = numericAccountId(credential, userId);
    const chatId = await this.resolveChat(accountId, recipient);
    const messageId = Number(await this.call('misc_send_text_message', [accountId, chatId, text]));
    return {
      id: `delta-chat:${accountId}:${messageId}`,
      accountId: String(accountId),
      chatId,
      messageId,
    };
  }

  async receive(
    credential: DeltaChatCredential,
    recipient: string,
    limit: number,
    userId: string,
  ): Promise<DeltaChatMessage[]> {
    const accountId = numericAccountId(credential, userId);
    const chatId = await this.resolveChat(accountId, recipient);
    const list = await this.call('get_message_list_items', [accountId, chatId, false, false]);
    const ids = (Array.isArray(list) ? list : [])
      .map(messageIdFromListItem)
      .filter((id): id is number => id !== null)
      .slice(-Math.min(50, Math.max(1, limit)));
    if (!ids.length) return [];

    const loaded = await this.call('get_messages', [accountId, ids]);
    return ids
      .map((id) => {
        const item = loaded?.[String(id)] ?? loaded?.[id];
        if (!item || item.kind === 'loadingError') return null;
        const senderId = String(item.sender?.address || item.sender?.displayName || '');
        const text = String(item.text || '').trim();
        if (!text || item.isInfo || !senderId) return null;
        const timestamp = Number(item.timestamp || item.sortTimestamp || item.receivedTimestamp || Date.now());
        return {
          externalId: `delta-chat:${accountId}:${id}`,
          senderId,
          text,
          timestamp: new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString(),
        };
      })
      .filter((message): message is DeltaChatMessage => message !== null);
  }
}

export const deltaChatCore = new DeltaChatCore();