import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apmaApi } from '../services/api';
import { SkeletonCard } from './SkeletonLoader';

interface SocialAccount {
  id: string;
  platform: string;
  account_type: string;
  account_id?: string;
  account_name: string;
  phone_number?: string;
  active: boolean;
  last_used_at?: string;
  usage_count: number;
  created_at: string;
}

const PLATFORM_META: Record<string, {
  icon: string;
  color: string;
  label: string;
  oauth?: boolean;
  oauthPlatform?: string;
  oauthNote?: string;
  tokenLabel?: string;
  idLabel?: string;
  showPhone?: boolean;
  hint?: string;
}> = {
  facebook:  { icon: '📘', color: '#1877f2', label: 'Facebook',   oauth: true },
  instagram: { icon: '📸', color: '#e1306c', label: 'Instagram',  oauth: true, oauthPlatform: 'facebook', oauthNote: 'Connects via Facebook' },
  twitter:   { icon: '𝕏',  color: '#1da1f2', label: 'Twitter/X',  oauth: true },
  linkedin:  { icon: '💼', color: '#0a66c2', label: 'LinkedIn',   oauth: true },
  reddit:    { icon: '🟠', color: '#ff4500', label: 'Reddit',     oauth: true },
  telegram:  {
    icon: '✈️', color: '#229ed9', label: 'Telegram',
    tokenLabel: 'Bot Token', idLabel: 'Channel ID or @username',
    hint: 'Create a bot via @BotFather on Telegram. Copy the token it gives you. Add the bot as an admin to your channel, then paste the channel @username or numeric ID.',
  },
  whatsapp:  {
    icon: '💬', color: '#25d366', label: 'WhatsApp',
    tokenLabel: 'Permanent Token', idLabel: 'Phone Number ID', showPhone: true,
    hint: 'Use a WhatsApp Business API permanent token from Meta Business Suite. Provide your Phone Number ID and WABA ID.',
  },
};

const PLATFORMS = ['facebook', 'instagram', 'twitter', 'linkedin', 'reddit', 'telegram', 'whatsapp'] as const;

type OAuthModal = {
  platform: string;
  oauthPlatform: string;
  step: 'starting' | 'waiting' | 'success' | 'error';
  authUrl?: string;
  stateId?: string;
  error?: string;
  newAccounts?: SocialAccount[];
};

type TokenModal = {
  platform: string;
  step: 'form' | 'saving';
};

export default function SocialAccountsPanel() {
  const [accounts, setAccounts]     = useState<SocialAccount[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [oauthModal, setOauthModal] = useState<OAuthModal | null>(null);
  const [tokenModal, setTokenModal] = useState<TokenModal | null>(null);
  const [form, setForm]             = useState({ account_id: '', account_name: '', access_token: '', phone_number: '', waba_id: '' });
  const [formError, setFormError]   = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPoll(), []);

  async function startOAuth(platform: string) {
    const meta = PLATFORM_META[platform];
    const oauthPlatform = meta?.oauthPlatform || platform;

    setOauthModal({ platform, oauthPlatform, step: 'starting' });

    try {
      const { authUrl, stateId } = await apmaApi.oauthStart(oauthPlatform);
      setOauthModal({ platform, oauthPlatform, step: 'waiting', authUrl, stateId });
      window.open(authUrl, '_blank');
      beginPolling(platform, oauthPlatform, stateId);
    } catch (e: any) {
      setOauthModal({ platform, oauthPlatform, step: 'error', error: e.message || 'Failed to start OAuth' });
    }
  }

  function beginPolling(platform: string, oauthPlatform: string, stateId: string) {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await apmaApi.oauthPoll(stateId);
        if (res.status === 'completed') {
          stopPoll();
          const newAccts = res.accounts ?? [];
          setAccounts((prev) => {
            const existingIds = new Set(prev.map((a) => a.id));
            const merged = [...prev];
            for (const a of newAccts) { if (!existingIds.has(a.id)) merged.push(a); }
            return merged;
          });
          setOauthModal({ platform, oauthPlatform, step: 'success', newAccounts: newAccts });
        } else if (res.status === 'error') {
          stopPoll();
          setOauthModal({ platform, oauthPlatform, step: 'error', error: res.error || 'Authorization failed' });
        } else if (res.status === 'expired') {
          stopPoll();
          setOauthModal({ platform, oauthPlatform, step: 'error', error: 'OAuth session expired — please try again.' });
        }
      } catch (_e) {}
    }, 2000);
  }

  function cancelOAuth() {
    stopPoll();
    setOauthModal(null);
  }

  function openTokenForm(platform: string) {
    setTokenModal({ platform, step: 'form' });
    setForm({ account_id: '', account_name: '', access_token: '', phone_number: '', waba_id: '' });
    setFormError('');
  }

  function closeTokenForm() { setTokenModal(null); setFormError(''); }

  async function handleTokenSave(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenModal) return;
    const meta = PLATFORM_META[tokenModal.platform];
    if (!form.account_id || !form.account_name || !form.access_token) {
      setFormError(`${meta?.idLabel ?? 'Account ID'}, account name, and ${meta?.tokenLabel ?? 'token'} are required.`);
      return;
    }
    setTokenModal((m) => m ? { ...m, step: 'saving' } : null);
    setFormError('');
    try {
      const res = await apmaApi.addSocialAccount({
        platform: tokenModal.platform,
        account_type: 'page',
        account_id: form.account_id.trim(),
        account_name: form.account_name.trim(),
        access_token: form.access_token.trim(),
        phone_number: form.phone_number.trim() || undefined,
        waba_id: form.waba_id.trim() || undefined,
      });
      setAccounts((prev) => [...prev, res.account]);
      closeTokenForm();
    } catch (e: any) {
      setFormError(e.message || 'Failed to connect account');
      setTokenModal((m) => m ? { ...m, step: 'form' } : null);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setConfirmRemoveId(null);
    try {
      await apmaApi.removeSocialAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError('Remove failed: ' + (e.message || 'Unknown'));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleToggle(acct: SocialAccount) {
    try {
      const updated = await apmaApi.toggleSocialAccount(acct.id, !acct.active);
      setAccounts((prev) => prev.map((a) => a.id === acct.id ? { ...a, active: updated.account?.active ?? !acct.active } : a));
    } catch (e: any) {
      setError('Toggle failed: ' + (e.message || 'Unknown'));
    }
  }

  const byPlatform = PLATFORMS.reduce<Record<string, SocialAccount[]>>((acc, p) => {
    acc[p] = accounts.filter((a) => a.platform === p);
    return acc;
  }, {} as Record<string, SocialAccount[]>);

  const totalActive = accounts.filter((a) => a.active).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {([
          ['Total Accounts', accounts.length, '#6366f1'],
          ['Active',         totalActive,     '#22c55e'],
          ['Platforms',      PLATFORMS.filter((p) => byPlatform[p]?.length > 0).length, '#38bdf8'],
          ['Total Uses',     accounts.reduce((s, a) => s + (a.usage_count ?? 0), 0), '#f59e0b'],
        ] as const).map(([label, val, color]) => (
          <div key={label} style={{ background: '#131c2e', borderRadius: 8, padding: '12px 16px', border: '1px solid #1e293b', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
      )}

      {loading && accounts.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
        {PLATFORMS.map((platform) => {
          const m = PLATFORM_META[platform];
          const platAccounts = byPlatform[platform] ?? [];
          const connected = platAccounts.length > 0;
          return (
            <div key={platform} style={{
              background: '#131c2e', borderRadius: 14,
              border: `1px solid ${connected ? `${m.color}28` : '#1e293b'}`,
              borderTop: `3px solid ${connected ? m.color : '#273040'}`,
              padding: '16px 16px 14px',
              display: 'flex', flexDirection: 'column', gap: 10,
              transition: 'border-color .2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{m.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{m.label}</div>
                  {m.oauthNote && !connected && (
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{m.oauthNote}</div>
                  )}
                  {connected ? (
                    <div style={{ fontSize: 11, color: '#22c55e', marginTop: 1 }}>
                      {platAccounts.length} account{platAccounts.length > 1 ? 's' : ''} connected
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 1 }}>Not connected</div>
                  )}
                </div>
              </div>

              {connected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {platAccounts.map((acct) => (
                    <div key={acct.id} style={{ background: '#0a1628', borderRadius: 7, padding: '7px 10px', border: '1px solid #1e293b' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                          {acct.account_name}
                        </span>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button onClick={() => handleToggle(acct)}
                            title={acct.active ? 'Pause' : 'Activate'}
                            style={{
                              fontSize: 10, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                              border: 'none', fontWeight: 600,
                              background: acct.active ? 'rgba(34,197,94,.15)' : 'rgba(100,116,139,.12)',
                              color: acct.active ? '#22c55e' : '#64748b',
                            }}>
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
                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.18)', color: '#ef4444', cursor: 'pointer' }}>
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: '#334155', marginTop: 3 }}>
                        {acct.usage_count} use{acct.usage_count !== 1 ? 's' : ''}{acct.last_used_at ? ` · last ${new Date(acct.last_used_at).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => m.oauth ? startOAuth(platform) : openTokenForm(platform)}
                style={{
                  marginTop: 'auto',
                  background: connected ? `${m.color}12` : '#1a2540',
                  border: `1px solid ${connected ? `${m.color}35` : '#273040'}`,
                  color: connected ? m.color : '#94a3b8',
                  borderRadius: 8, padding: '8px 0', fontSize: 12,
                  cursor: 'pointer', fontWeight: 700, width: '100%',
                  transition: 'all .15s',
                }}>
                {connected ? '+ Add Account' : m.oauth ? '🔗 Connect' : '🔑 Setup'}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={load} disabled={loading}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {/* ─── OAuth Modal ───────────────────────────────────────────────────── */}
      {oauthModal && (
        <Modal onClose={oauthModal.step !== 'starting' ? cancelOAuth : undefined}>
          {(() => {
            const m = PLATFORM_META[oauthModal.platform];
            if (oauthModal.step === 'starting') {
              return (
                <ModalBody icon={m.icon} color={m.color} title={`Connecting ${m.label}`} subtitle="Preparing secure authorization…">
                  <SpinnerRing color={m.color} />
                </ModalBody>
              );
            }
            if (oauthModal.step === 'waiting') {
              return (
                <ModalBody icon={m.icon} color={m.color} title={`Authorize ${m.label}`} subtitle="A browser window has opened — sign in and grant APMA access.">
                  <SpinnerRing color={m.color} />
                  <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 1.7, margin: '4px 0 0' }}>
                    Waiting for authorization…<br />
                    <button
                      onClick={() => oauthModal.authUrl && window.open(oauthModal.authUrl, '_blank')}
                      style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                      Re-open browser window
                    </button>
                  </p>
                  <button onClick={cancelOAuth}
                    style={{ marginTop: 6, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', color: '#ef4444', borderRadius: 8, padding: '9px 24px', fontSize: 13, cursor: 'pointer', width: '100%' }}>
                    Cancel
                  </button>
                </ModalBody>
              );
            }
            if (oauthModal.step === 'success') {
              const cnt = oauthModal.newAccounts?.length ?? 0;
              const platforms = [...new Set(oauthModal.newAccounts?.map((a) => a.platform) ?? [])];
              return (
                <ModalBody icon="✓" color="#22c55e" title="Connected!" subtitle={`${cnt} account${cnt !== 1 ? 's' : ''} connected to APMA: ${platforms.join(', ')}`}>
                  <button onClick={() => setOauthModal(null)}
                    style={{ background: '#22c55e', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 32px', fontSize: 14, cursor: 'pointer', fontWeight: 700, width: '100%' }}>
                    Done
                  </button>
                </ModalBody>
              );
            }
            return (
              <ModalBody icon="⚠" color="#ef4444" title="Connection Failed" subtitle={oauthModal.error || 'An error occurred during authorization.'}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={cancelOAuth}
                    style={{ flex: 1, background: '#263348', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '9px 0', fontSize: 13, cursor: 'pointer' }}>
                    Close
                  </button>
                  <button onClick={() => startOAuth(oauthModal.platform)}
                    style={{ flex: 1, background: m.color, border: 'none', color: '#fff', borderRadius: 8, padding: '9px 0', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
                    Try Again
                  </button>
                </div>
              </ModalBody>
            );
          })()}
        </Modal>
      )}

      {/* ─── Token Form Modal (Telegram / WhatsApp) ────────────────────────── */}
      {tokenModal && (() => {
        const m = PLATFORM_META[tokenModal.platform];
        const saving = tokenModal.step === 'saving';
        return (
          <Modal onClose={closeTokenForm}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>{m?.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Setup {m?.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Add an account APMA will use autonomously</div>
                </div>
              </div>
              <button onClick={closeTokenForm} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>✕</button>
            </div>

            {m?.hint && (
              <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 8, padding: '11px 14px', fontSize: 12, color: '#94a3b8', lineHeight: 1.7, marginBottom: 20 }}>
                <strong style={{ color: '#818cf8' }}>Setup guide:</strong><br />{m.hint}
              </div>
            )}

            <form onSubmit={handleTokenSave} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <Field label="Account Name *">
                <Input value={form.account_name} onChange={(v) => setForm((f) => ({ ...f, account_name: v }))} placeholder="Display name for this account" required />
              </Field>
              <Field label={`${m?.idLabel ?? 'Account ID'} *`}>
                <Input value={form.account_id} onChange={(v) => setForm((f) => ({ ...f, account_id: v }))} placeholder={m?.idLabel ?? 'Account ID'} required />
              </Field>
              <Field label={`${m?.tokenLabel ?? 'Access Token'} *`}>
                <Input value={form.access_token} onChange={(v) => setForm((f) => ({ ...f, access_token: v }))} placeholder="Paste token here" type="password" required />
              </Field>
              {m?.showPhone && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Phone Number">
                    <Input value={form.phone_number} onChange={(v) => setForm((f) => ({ ...f, phone_number: v }))} placeholder="+1234567890" />
                  </Field>
                  <Field label="WABA ID">
                    <Input value={form.waba_id} onChange={(v) => setForm((f) => ({ ...f, waba_id: v }))} placeholder="WhatsApp Business Account ID" />
                  </Field>
                </div>
              )}
              {formError && (
                <div style={{ background: 'rgba(239,68,68,.09)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 6, padding: '8px 12px', color: '#ef4444', fontSize: 12 }}>
                  ⚠ {formError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 2 }}>
                <button type="button" onClick={closeTokenForm}
                  style={{ background: '#263348', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  style={{ background: m?.color ?? '#6366f1', border: 'none', color: '#fff', borderRadius: 8, padding: '9px 24px', fontSize: 13, cursor: 'pointer', fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Connecting…' : `Connect ${m?.label}`}
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
      background: 'rgba(0,0,0,.78)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000,
    }}
      onClick={onClose}>
      <div style={{
        background: '#1a2540', borderRadius: 18, padding: 28,
        width: 420, maxWidth: '95vw', border: '1px solid #273040',
        boxShadow: '0 24px 64px rgba(0,0,0,.6)', maxHeight: '90vh', overflowY: 'auto',
      }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ModalBody({ icon, color, title, subtitle, children }: {
  icon: string; color: string; title: string; subtitle: string; children?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: `${color}14`, border: `1px solid ${color}35`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto', fontSize: 28,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 17, color: '#f1f5f9', marginBottom: 5 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function SpinnerRing({ color }: { color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        border: `3px solid ${color}25`,
        borderTopColor: color,
        animation: 'apma-ring 1s linear infinite',
      }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', required }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      required={required}
      style={{
        width: '100%', background: '#0f172a', border: '1px solid #273040',
        borderRadius: 7, padding: '9px 11px', color: '#e2e8f0', fontSize: 13,
        boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}
