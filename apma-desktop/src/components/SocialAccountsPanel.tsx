import { useState, useEffect, useCallback } from 'react';
import { apmaApi } from '../services/api';
import { SkeletonCard } from './SkeletonLoader';

interface SocialAccount {
  id: string;
  platform: string;
  account_type: string;
  account_id: string;
  account_name: string;
  phone_number?: string;
  active: boolean;
  last_used_at?: string;
  usage_count: number;
  created_at: string;
}

const PLATFORM_META: Record<string, { icon: string; color: string; label: string; hint: string; tokenLabel: string; idLabel: string; showPhone?: boolean }> = {
  facebook:  { icon: '📘', color: '#1877f2', label: 'Facebook',  hint: 'Use a long-lived Page Access Token from Meta Business Suite → Settings → Advanced → System Users.',         tokenLabel: 'Page Access Token', idLabel: 'Page ID' },
  instagram: { icon: '📸', color: '#e1306c', label: 'Instagram', hint: 'Use an Instagram Graph API token attached to a connected Facebook Page via Meta Business Suite.',            tokenLabel: 'Access Token',      idLabel: 'Account ID' },
  twitter:   { icon: '𝕏',  color: '#1da1f2', label: 'Twitter/X', hint: 'Use a user OAuth2 access token from Twitter Developer Portal → Projects → OAuth 2.0.',                       tokenLabel: 'OAuth2 Access Token', idLabel: 'Numeric User ID' },
  whatsapp:  { icon: '💬', color: '#25d366', label: 'WhatsApp',  hint: 'Use a WhatsApp Business API permanent token (Business Platform). Provide your WABA ID and phone number ID.', tokenLabel: 'Permanent Token',    idLabel: 'Phone Number ID', showPhone: true },
  telegram:  { icon: '✈️', color: '#229ed9', label: 'Telegram',  hint: 'Use a bot token from @BotFather. Provide the channel username or numeric chat ID as account ID.',           tokenLabel: 'Bot Token',          idLabel: 'Channel ID / @username' },
  reddit:    { icon: '🟠', color: '#ff4500', label: 'Reddit',    hint: 'Use a Reddit OAuth2 user access token from your Reddit App (script type). Provide the username as account name.', tokenLabel: 'OAuth2 Access Token', idLabel: 'Username (without u/)' },
  linkedin:  { icon: '💼', color: '#0a66c2', label: 'LinkedIn',  hint: 'Use a LinkedIn OAuth2 access token. Provide the URN (person or organization) as account ID.',                tokenLabel: 'OAuth2 Access Token', idLabel: 'Person / Org URN' },
};

const PLATFORMS = ['facebook', 'instagram', 'twitter', 'whatsapp', 'telegram', 'reddit', 'linkedin'] as const;

const ACCOUNT_TYPES = [
  { value: 'page',     label: 'Page' },
  { value: 'persona',  label: 'Personal Profile' },
  { value: 'phone',    label: 'Phone Number' },
  { value: 'business', label: 'Business Account' },
];

type ConnectStep = 'idle' | 'form' | 'saving';

export default function SocialAccountsPanel() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [connectPlatform, setConnectPlatform] = useState<string | null>(null);
  const [connectStep, setConnectStep] = useState<ConnectStep>('idle');
  const [form, setForm] = useState({ account_id: '', account_name: '', access_token: '', account_type: 'page', phone_number: '', waba_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apmaApi.socialAccounts();
      setAccounts(res.accounts ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openConnect(platform: string) {
    setConnectPlatform(platform);
    setConnectStep('form');
    setForm({ account_id: '', account_name: '', access_token: '', account_type: 'page', phone_number: '', waba_id: '' });
    setError('');
  }

  function closeConnect() {
    setConnectPlatform(null);
    setConnectStep('idle');
    setError('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.account_id || !form.account_name || !form.access_token) {
      setError('Account ID, name, and access token are required.');
      return;
    }
    setConnectStep('saving');
    setError('');
    try {
      const res = await apmaApi.addSocialAccount({
        platform: connectPlatform,
        account_type: form.account_type,
        account_id: form.account_id.trim(),
        account_name: form.account_name.trim(),
        access_token: form.access_token.trim(),
        phone_number: form.phone_number.trim() || undefined,
        waba_id: form.waba_id.trim() || undefined,
      });
      setAccounts((prev) => [...prev, res.account]);
      closeConnect();
    } catch (e: any) {
      setError(e.message || 'Failed to connect account');
      setConnectStep('form');
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setConfirmRemoveId(null);
    try {
      await apmaApi.removeSocialAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError('Remove failed: ' + (e.message || 'Unknown error'));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleToggle(acct: SocialAccount) {
    try {
      const updated = await apmaApi.toggleSocialAccount(acct.id, !acct.active);
      setAccounts((prev) => prev.map((a) => a.id === acct.id ? { ...a, active: updated.account?.active ?? !acct.active } : a));
    } catch (e: any) {
      setError('Toggle failed: ' + (e.message || 'Unknown error'));
    }
  }

  const byPlatform = PLATFORMS.reduce<Record<string, SocialAccount[]>>((acc, p) => {
    acc[p] = accounts.filter((a) => a.platform === p);
    return acc;
  }, {} as Record<string, SocialAccount[]>);

  const totalActive = accounts.filter((a) => a.active).length;
  const meta = connectPlatform ? PLATFORM_META[connectPlatform] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {([
          ['Total Accounts', accounts.length, '#6366f1'],
          ['Active', totalActive, '#22c55e'],
          ['Platforms', PLATFORMS.filter((p) => byPlatform[p]?.length > 0).length, '#38bdf8'],
          ['Total Uses', accounts.reduce((s, a) => s + (a.usage_count ?? 0), 0), '#f59e0b'],
        ] as const).map(([label, val, color]) => (
          <div key={label} style={{ background: '#131c2e', borderRadius: 8, padding: '12px 16px', border: '1px solid #1e293b', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
      )}

      {loading && accounts.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      {/* Platform cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {PLATFORMS.map((platform) => {
          const m = PLATFORM_META[platform];
          const platformAccounts = byPlatform[platform] ?? [];
          const connected = platformAccounts.length > 0;
          const allActive = platformAccounts.every((a) => a.active);
          return (
            <div key={platform}
              style={{
                background: '#131c2e', borderRadius: 12, border: `1px solid ${connected ? `${m.color}33` : '#1e293b'}`,
                borderTop: `3px solid ${connected ? m.color : '#334155'}`,
                padding: 16, display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color .2s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{m.label}</div>
                  {connected ? (
                    <div style={{ fontSize: 11, color: '#22c55e', marginTop: 1 }}>
                      {platformAccounts.length} account{platformAccounts.length > 1 ? 's' : ''} connected
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>Not connected</div>
                  )}
                </div>
              </div>

              {connected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {platformAccounts.map((acct) => (
                    <div key={acct.id} style={{ background: '#0a1628', borderRadius: 7, padding: '7px 10px', border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{acct.account_name}</span>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button onClick={() => handleToggle(acct)}
                            title={acct.active ? 'Click to pause' : 'Click to activate'}
                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: 'none', fontWeight: 600, background: acct.active ? 'rgba(34,197,94,.15)' : 'rgba(100,116,139,.15)', color: acct.active ? '#22c55e' : '#64748b' }}>
                            {acct.active ? '● On' : '○ Off'}
                          </button>
                          {confirmRemoveId === acct.id ? (
                            <>
                              <button onClick={() => handleRemove(acct.id)} disabled={removingId === acct.id}
                                style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                                {removingId === acct.id ? '…' : 'Yes'}
                              </button>
                              <button onClick={() => setConfirmRemoveId(null)}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#263348', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmRemoveId(acct.id)}
                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.2)', color: '#ef4444', cursor: 'pointer' }}>
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>
                        {acct.usage_count} uses {acct.last_used_at ? `· last ${new Date(acct.last_used_at).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => openConnect(platform)}
                style={{
                  marginTop: 'auto', background: connected ? `${m.color}15` : '#1e293b',
                  border: `1px solid ${connected ? `${m.color}40` : '#334155'}`,
                  color: connected ? m.color : '#94a3b8',
                  borderRadius: 7, padding: '7px 0', fontSize: 12, cursor: 'pointer', fontWeight: 600, width: '100%',
                  transition: 'all .15s',
                }}>
                {connected ? '+ Add Account' : 'Connect'}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={load} disabled={loading}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Connect Modal */}
      {connectPlatform && meta && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
          onClick={closeConnect}
        >
          <div
            style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: 500, maxWidth: '95vw', border: '1px solid #334155', boxShadow: '0 24px 60px rgba(0,0,0,.6)', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>{meta.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Connect {meta.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Add an account APMA will use autonomously</div>
                </div>
              </div>
              <button onClick={closeConnect} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#94a3b8', lineHeight: 1.6, marginBottom: 20 }}>
              <strong style={{ color: '#818cf8' }}>How to get your token:</strong><br />
              {meta.hint}
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Account Type</label>
                  <select value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }}>
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Account Name *</label>
                  <input value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} placeholder="Display name"
                    required style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{meta.idLabel} *</label>
                <input value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))} placeholder="Numeric ID or username"
                  required style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>{meta.tokenLabel} *</label>
                <input value={form.access_token} onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))} placeholder="Paste token here"
                  required type="password" style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
              </div>

              {meta.showPhone && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Phone Number</label>
                    <input value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} placeholder="+1234567890"
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>WABA ID</label>
                    <input value={form.waba_id} onChange={(e) => setForm((f) => ({ ...f, waba_id: e.target.value }))} placeholder="WhatsApp Business Account ID"
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>
              )}

              {error && (
                <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '8px 12px', color: '#ef4444', fontSize: 12 }}>
                  ⚠ {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button type="button" onClick={closeConnect}
                  style={{ background: '#263348', border: '1px solid #334155', color: '#94a3b8', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={connectStep === 'saving'}
                  style={{ background: meta.color, border: 'none', color: '#fff', borderRadius: 7, padding: '9px 22px', fontSize: 13, cursor: 'pointer', fontWeight: 700, opacity: connectStep === 'saving' ? 0.7 : 1 }}>
                  {connectStep === 'saving' ? 'Connecting…' : `Connect ${meta.label}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
