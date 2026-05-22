import { useState, useEffect, useCallback } from 'react';
import { apmaApi } from '../services/api';

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

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: '📘', instagram: '📸', twitter: '𝕏', whatsapp: '💬',
  telegram: '✈️', reddit: '🟠', linkedin: '💼', tiktok: '🎵',
};

const PLATFORM_COLOR: Record<string, string> = {
  facebook: '#1877f2', instagram: '#e1306c', twitter: '#1da1f2', whatsapp: '#25d366',
  telegram: '#229ed9', reddit: '#ff4500', linkedin: '#0a66c2', tiktok: '#ff0050',
};

const PLATFORMS = ['facebook', 'instagram', 'twitter', 'whatsapp', 'telegram', 'reddit', 'linkedin'];

export default function SocialAccountsPanel() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ platform: 'facebook', account_id: '', account_name: '', access_token: '', account_type: 'page', phone_number: '', waba_id: '' });

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

  async function handleToggle(account: SocialAccount) {
    try {
      const updated = await apmaApi.toggleSocialAccount(account.id, !account.active);
      setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, active: updated.active } : a));
    } catch (e: any) {
      setError('Toggle failed: ' + (e.message || 'Unknown error'));
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.account_id || !addForm.account_name || !addForm.access_token) {
      setError('Account ID, name, and access token are required.');
      return;
    }
    setConnecting(addForm.platform);
    setError('');
    try {
      const res = await apmaApi.addSocialAccount(addForm);
      setAccounts((prev) => [...prev, res.account]);
      setShowAddModal(false);
      setAddForm({ platform: 'facebook', account_id: '', account_name: '', access_token: '', account_type: 'page', phone_number: '', waba_id: '' });
    } catch (e: any) {
      setError('Add failed: ' + (e.message || 'Unknown error'));
    } finally {
      setConnecting(null);
    }
  }

  const byPlatform = PLATFORMS.reduce<Record<string, SocialAccount[]>>((acc, p) => {
    acc[p] = accounts.filter((a) => a.platform === p);
    return acc;
  }, {});

  const activePlatforms = PLATFORMS.filter((p) => byPlatform[p].length > 0);
  const totalActive = accounts.filter((a) => a.active).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          ['Total Accounts', accounts.length, '#6366f1'],
          ['Active', totalActive, '#22c55e'],
          ['Platforms', activePlatforms.length, '#38bdf8'],
          ['Total Uses', accounts.reduce((s, a) => s + a.usage_count, 0), '#f59e0b'],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ background: '#131c2e', borderRadius: 8, padding: '12px 16px', border: '1px solid #1e293b', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: color as string }}>{val as number}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label as string}</div>
          </div>
        ))}
      </div>

      {/* Actions bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          APMA will autonomously rotate across all active accounts according to its strategic plan.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
          >
            + Add Account
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}

      {loading && accounts.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '60px 0', fontSize: 13 }}>Loading connected accounts…</div>
      )}

      {!loading && accounts.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '60px 0', fontSize: 13 }}>
          No social accounts connected. Click "Add Account" to connect Facebook pages, Instagram, WhatsApp, Twitter/X, and more.
        </div>
      )}

      {/* Per-platform groups */}
      {activePlatforms.map((platform) => (
        <div key={platform}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>{PLATFORM_EMOJI[platform]}</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', textTransform: 'capitalize' }}>{platform}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>({byPlatform[platform].length} account{byPlatform[platform].length > 1 ? 's' : ''})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {byPlatform[platform].map((acct) => (
              <div
                key={acct.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: '#131c2e', borderRadius: 8,
                  border: `1px solid ${acct.active ? `${PLATFORM_COLOR[platform]}33` : '#1e293b'}`,
                  borderLeft: `3px solid ${acct.active ? PLATFORM_COLOR[platform] : '#475569'}`,
                  opacity: acct.active ? 1 : 0.6,
                  flexWrap: 'wrap', gap: 8,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{acct.account_name}</span>
                    <span style={{ fontSize: 10, color: '#475569', background: '#0f172a', padding: '1px 6px', borderRadius: 4 }}>{acct.account_type}</span>
                    {!acct.active && <span style={{ fontSize: 10, color: '#ef4444' }}>paused</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, display: 'flex', gap: 12 }}>
                    <span>ID: {acct.account_id}</span>
                    {acct.phone_number && <span>📞 {acct.phone_number}</span>}
                    <span>Used {acct.usage_count} times</span>
                    {acct.last_used_at && <span>Last: {new Date(acct.last_used_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => handleToggle(acct)}
                    style={{
                      background: acct.active ? 'rgba(34,197,94,.12)' : 'rgba(100,116,139,.12)',
                      border: `1px solid ${acct.active ? 'rgba(34,197,94,.3)' : '#334155'}`,
                      color: acct.active ? '#22c55e' : '#64748b',
                      borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    {acct.active ? 'Active' : 'Paused'}
                  </button>

                  {confirmRemoveId === acct.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '3px 8px' }}>
                      <span style={{ fontSize: 11, color: '#fca5a5' }}>Remove?</span>
                      <button
                        onClick={() => handleRemove(acct.id)}
                        disabled={removingId === acct.id}
                        style={{ background: '#ef4444', border: 'none', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                      >
                        {removingId === acct.id ? '…' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setConfirmRemoveId(null)}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemoveId(acct.id)}
                      disabled={removingId === acct.id}
                      style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', color: '#ef4444', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add Account Modal */}
      {showAddModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{ background: '#1e293b', borderRadius: 14, padding: 28, width: 480, maxWidth: '95vw', border: '1px solid #334155', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Connect Social Account</span>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Platform *</label>
                  <select value={addForm.platform} onChange={(e) => setAddForm((f) => ({ ...f, platform: e.target.value }))}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }}>
                    {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_EMOJI[p]} {p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Account Type *</label>
                  <select value={addForm.account_type} onChange={(e) => setAddForm((f) => ({ ...f, account_type: e.target.value }))}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }}>
                    <option value="page">Page</option>
                    <option value="persona">Personal Profile</option>
                    <option value="phone">Phone Number</option>
                    <option value="business">Business Account</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Account Name *</label>
                <input value={addForm.account_name} onChange={(e) => setAddForm((f) => ({ ...f, account_name: e.target.value }))} placeholder="Display name"
                  required style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Account / Page ID *</label>
                <input value={addForm.account_id} onChange={(e) => setAddForm((f) => ({ ...f, account_id: e.target.value }))} placeholder="Platform account ID"
                  required style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Access Token *</label>
                <input value={addForm.access_token} onChange={(e) => setAddForm((f) => ({ ...f, access_token: e.target.value }))} placeholder="Long-lived access token"
                  required type="password" style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }} />
              </div>

              {(addForm.platform === 'whatsapp') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Phone Number</label>
                    <input value={addForm.phone_number} onChange={(e) => setAddForm((f) => ({ ...f, phone_number: e.target.value }))} placeholder="+1234567890"
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>WABA ID</label>
                    <input value={addForm.waba_id} onChange={(e) => setAddForm((f) => ({ ...f, waba_id: e.target.value }))} placeholder="WhatsApp Business Account ID"
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13 }} />
                  </div>
                </div>
              )}

              <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 6, padding: '10px 12px', fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                APMA will use this account autonomously across campaigns according to its strategic plan. Multiple accounts per platform are supported — APMA rotates between them to maximise reach and minimise detection.
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowAddModal(false)}
                  style={{ background: '#263348', border: '1px solid #334155', color: '#94a3b8', borderRadius: 7, padding: '9px 18px', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={!!connecting}
                  style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 7, padding: '9px 20px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                  {connecting ? 'Connecting…' : 'Connect Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
