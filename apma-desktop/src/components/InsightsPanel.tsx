import { useState, useEffect } from 'react';
import { apmaApi } from '../services/api';

interface SelfImprovementLog {
  id: string;
  skill_name: string;
  description: string;
  code_snippet?: string;
  test_result?: string;
  deployed: boolean;
  performance_delta: number;
  created_at: string;
}

interface ClientProfile {
  public_perception_summary: string;
  win_probability: number;
  win_probability_rationale: string;
  key_strengths: string[];
  key_weaknesses: string[];
  key_threats: string[];
  key_opportunities: string[];
  target_demographics: Array<{ group: string; lean: string; size_estimate: string }>;
  key_issues: Array<{ issue: string; stance: string; importance: string }>;
  competitor_analysis: Array<{ name: string; threat_level: string; notes: string }>;
  narrative_health_rating: string;
  recommended_focus_areas: string[];
  generated_at: string;
}

const HEALTH_COLOUR: Record<string, string> = {
  excellent: '#22c55e', good: '#86efac', fair: '#f59e0b', poor: '#ef4444', critical: '#dc2626',
};
const LEAN_COLOUR: Record<string, string> = { for: '#22c55e', against: '#ef4444', undecided: '#f59e0b' };
const THREAT_COLOUR: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

export default function InsightsPanel() {
  const [logs, setLogs] = useState<SelfImprovementLog[]>([]);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState('');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'improvements'>('profile');

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setError('');
    await Promise.all([fetchProfile(), fetchLogs()]);
  }

  async function fetchLogs() {
    setLoadingLogs(true);
    try {
      const data = await apmaApi.selfImprovementLogs();
      setLogs(data.logs ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load logs');
    } finally {
      setLoadingLogs(false);
    }
  }

  async function fetchProfile() {
    setLoadingProfile(true);
    try {
      const data = await apmaApi.clientProfile();
      setProfile(data.profile ?? null);
    } catch {
      // profile might not exist yet
    } finally {
      setLoadingProfile(false);
    }
  }

  async function handleDeploy(id: string) {
    setDeployingId(id);
    try {
      await apmaApi.deployImprovement(id);
      setLogs((prev) => prev.map((l) => l.id === id ? { ...l, deployed: true } : l));
    } catch (e: any) {
      setError('Deploy failed: ' + (e.message || 'Unknown error'));
    } finally {
      setDeployingId(null);
    }
  }

  async function handleRefreshProfile() {
    setLoadingProfile(true);
    try {
      const data = await apmaApi.refreshProfile();
      setProfile(data.profile ?? null);
    } catch (e: any) {
      setError('Profile refresh failed: ' + (e.message || 'Unknown error'));
    } finally {
      setLoadingProfile(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #1e293b' }}>
        {([['profile', 'Intelligence Profile'], ['improvements', 'AI Self-Improvement']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px', fontSize: 12, fontWeight: 500,
              color: activeTab === id ? '#6366f1' : '#64748b',
              borderBottom: activeTab === id ? '2px solid #6366f1' : '2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* ─── CLIENT INTELLIGENCE PROFILE ─────────────────────────────── */}
      {activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>AI-generated intelligence brief — updated every 24 hours automatically</span>
            <button onClick={handleRefreshProfile} disabled={loadingProfile}
              style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}>
              {loadingProfile ? '…' : '↻ Refresh'}
            </button>
          </div>

          {loadingProfile && !profile && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0', fontSize: 12 }}>Generating intelligence profile…</div>
          )}

          {!loadingProfile && !profile && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0', fontSize: 12 }}>
              No active campaign found. The profile is generated when a campaign is running.
            </div>
          )}

          {profile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Win probability + health */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ background: '#131c2e', borderRadius: 10, padding: 16, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Goal Achievement Probability</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: '#6366f1' }}>{Math.round(profile.win_probability * 100)}%</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>{profile.win_probability_rationale}</div>
                </div>
                <div style={{ background: '#131c2e', borderRadius: 10, padding: 16, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Narrative Health</div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20,
                    background: `${HEALTH_COLOUR[profile.narrative_health_rating] ?? '#64748b'}22`,
                    border: `1px solid ${HEALTH_COLOUR[profile.narrative_health_rating] ?? '#64748b'}44` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: HEALTH_COLOUR[profile.narrative_health_rating] ?? '#64748b', display: 'inline-block' }} />
                    <span style={{ fontWeight: 700, fontSize: 14, color: HEALTH_COLOUR[profile.narrative_health_rating] ?? '#64748b', textTransform: 'capitalize' }}>{profile.narrative_health_rating}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>{profile.public_perception_summary}</div>
                </div>
              </div>

              {/* SWOT */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {([
                  ['Strengths', profile.key_strengths, '#22c55e'],
                  ['Weaknesses', profile.key_weaknesses, '#ef4444'],
                  ['Opportunities', profile.key_opportunities, '#6366f1'],
                  ['Threats', profile.key_threats, '#f59e0b'],
                ] as [string, string[], string][]).map(([title, items, color]) => (
                  <div key={title} style={{ background: '#131c2e', borderRadius: 8, padding: 12, border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
                    {items.map((item, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#e2e8f0', display: 'flex', gap: 6, marginBottom: 4 }}>
                        <span style={{ color, flexShrink: 0 }}>•</span>{item}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Demographics */}
              {profile.target_demographics?.length > 0 && (
                <div style={{ background: '#131c2e', borderRadius: 8, padding: 14, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Demographics</div>
                  {profile.target_demographics.map((d, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: '#0f172a', borderRadius: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#e2e8f0' }}>{d.group}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{d.size_estimate}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: LEAN_COLOUR[d.lean] ?? '#94a3b8',
                          background: `${LEAN_COLOUR[d.lean] ?? '#94a3b8'}22`, padding: '2px 8px', borderRadius: 4, textTransform: 'capitalize' }}>{d.lean}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Competitors */}
              {profile.competitor_analysis?.length > 0 && (
                <div style={{ background: '#131c2e', borderRadius: 8, padding: 14, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Competitor Analysis</div>
                  {profile.competitor_analysis.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
                      borderBottom: i < profile.competitor_analysis.length - 1 ? '1px solid #1a2540' : 'none' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: THREAT_COLOUR[c.threat_level] ?? '#94a3b8',
                        background: `${THREAT_COLOUR[c.threat_level] ?? '#94a3b8'}22`, padding: '2px 7px', borderRadius: 4, flexShrink: 0, textTransform: 'capitalize', marginTop: 2 }}>{c.threat_level}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{c.notes}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Focus areas */}
              {profile.recommended_focus_areas?.length > 0 && (
                <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>APMA Recommended Focus</div>
                  {profile.recommended_focus_areas.map((f, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#c7d2fe', display: 'flex', gap: 6, marginBottom: 4 }}>
                      <span style={{ color: '#6366f1' }}>▶</span>{f}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 10, color: '#334155', textAlign: 'right' }}>
                Generated: {new Date(profile.generated_at).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── SELF-IMPROVEMENT LOGS ────────────────────────────────── */}
      {activeTab === 'improvements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            APMA generates tactical optimizations every 6 hours from real campaign performance data.
          </div>
          {loadingLogs && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0', fontSize: 12 }}>Loading self-improvement logs…</div>
          )}
          {!loadingLogs && logs.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0', fontSize: 12 }}>
              No logs yet. Generated automatically every 6 hours when a campaign is active.
            </div>
          )}
          {logs.map((log) => (
            <div key={log.id} style={{
              background: '#131c2e', borderRadius: 10, border: '1px solid #1e293b',
              borderLeft: `3px solid ${log.deployed ? '#22c55e' : '#f59e0b'}`, overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer' }}
                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: log.deployed ? 'rgba(34,197,94,.15)' : 'rgba(245,158,11,.15)',
                    color: log.deployed ? '#22c55e' : '#f59e0b' }}>
                    {log.deployed ? '✓ DEPLOYED' : '⏳ PENDING'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{log.skill_name.replace(/_/g, ' ')}</span>
                  {log.performance_delta > 0 && (
                    <span style={{ fontSize: 11, color: '#22c55e' }}>+{(log.performance_delta * 100).toFixed(1)}% expected</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: '#475569' }}>{new Date(log.created_at).toLocaleString()}</span>
                  {!log.deployed && (
                    <button onClick={(e) => { e.stopPropagation(); handleDeploy(log.id); }} disabled={deployingId === log.id}
                      style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 5, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      {deployingId === log.id ? '…' : 'Deploy'}
                    </button>
                  )}
                  <span style={{ fontSize: 14, color: '#475569' }}>{expandedLog === log.id ? '▲' : '▼'}</span>
                </div>
              </div>
              {expandedLog === log.id && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid #1a2540' }}>
                  <div style={{ paddingTop: 10, fontSize: 12, color: '#94a3b8', lineHeight: 1.6, marginBottom: 10 }}>{log.description}</div>
                  {log.code_snippet && (
                    <pre style={{ background: '#0a1628', borderRadius: 6, padding: '10px 12px', fontSize: 10, color: '#7dd3fc',
                      overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>
                      {String(log.code_snippet).length > 1200 ? String(log.code_snippet).slice(0, 1200) + '\n… (truncated)' : log.code_snippet}
                    </pre>
                  )}
                  {log.test_result && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>Test result: {log.test_result}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
