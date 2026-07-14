import { useEffect, useState, useRef } from 'react';
import { apmaApi } from '../services/api';

const AGENT_COLORS: Record<string, string> = {
  SALESMAN:  '#10B981',
  AWARENESS: '#00F0FF',
  PROMOTION: '#F59E0B',
  LAUNCH:    '#8B5CF6',
  IPE:       '#3B82F6',
  STRATEGY:  '#EC4899',
  LEAD_DISCOVERY: '#F97316',
};

function scoreColor(score: number): string {
  if (score >= 75) return '#10B981';
  if (score >= 50) return '#F59E0B';
  return '#EF4444';
}

function verdictBadge(verdict: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    approved: { bg: 'rgba(16,185,129,0.15)', color: '#10B981', label: '✓ Approved' },
    flagged:  { bg: 'rgba(245,158,11,0.15)',  color: '#F59E0B', label: '⚠ Flagged' },
    rejected: { bg: 'rgba(239,68,68,0.15)',   color: '#EF4444', label: '✕ Rejected' },
  };
  const s = map[verdict] || map.flagged;
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={7} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={`${filled} ${circ}`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
}

function AgentScoreCard({ agentType, data, threshold, onSetThreshold, onAutoImprove, improving }: {
  agentType: string;
  data: { total: number; avg: number };
  threshold: number;
  onSetThreshold: (v: number) => void;
  onAutoImprove: () => void;
  improving: boolean;
}) {
  const color = AGENT_COLORS[agentType] || '#64748b';
  const isPaused = data.avg < threshold && data.total > 5;

  return (
    <div style={{
      background: '#1e293b', borderRadius: 12, padding: 16,
      border: `1px solid ${isPaused ? '#ef4444' : '#334155'}`,
      position: 'relative', overflow: 'hidden',
    }}>
      {isPaused && (
        <div style={{
          position: 'absolute', top: 0, right: 0,
          background: '#ef4444', color: '#fff',
          fontSize: 9, fontWeight: 800, padding: '3px 8px',
          borderBottomLeftRadius: 8, letterSpacing: 1,
        }}>
          PAUSED
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <ScoreRing score={data.avg} size={64} />
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column',
          }}>
            <span style={{ color: scoreColor(data.avg), fontWeight: 900, fontSize: 15 }}>{data.avg}</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13 }}>{agentType}</span>
          </div>
          <span style={{ color: '#64748b', fontSize: 11 }}>{data.total.toLocaleString()} evaluations</span>
        </div>
      </div>

      {/* Quality bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#94a3b8', fontSize: 11 }}>Avg Quality</span>
          <span style={{ color: scoreColor(data.avg), fontWeight: 700, fontSize: 11 }}>{data.avg}/100</span>
        </div>
        <div style={{ height: 5, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${data.avg}%`,
            background: `linear-gradient(90deg, ${scoreColor(data.avg)}, ${color})`,
            borderRadius: 3, transition: 'width 0.6s ease',
          }} />
        </div>
        {/* Threshold marker */}
        <div style={{ position: 'relative', height: 8, marginTop: 2 }}>
          <div style={{
            position: 'absolute', left: `${threshold}%`,
            transform: 'translateX(-50%)',
            width: 2, height: 8, background: '#f59e0b', borderRadius: 1,
          }} />
        </div>
      </div>

      {/* Auto-pause threshold slider */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#64748b', fontSize: 10 }}>Auto-pause below:</span>
          <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 10 }}>{threshold}</span>
        </div>
        <input
          type="range" min={20} max={80} value={threshold}
          onChange={e => onSetThreshold(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer' }}
        />
      </div>

      {/* Auto-improve button */}
      <button
        onClick={onAutoImprove}
        disabled={improving}
        style={{
          width: '100%', padding: '8px 0',
          background: improving ? '#1e293b' : 'rgba(99,102,241,0.15)',
          border: `1px solid ${improving ? '#334155' : 'rgba(99,102,241,0.4)'}`,
          borderRadius: 8, color: improving ? '#475569' : '#818cf8',
          fontSize: 12, fontWeight: 700, cursor: improving ? 'not-allowed' : 'pointer',
          transition: 'all .2s',
        }}
      >
        {improving ? '⟳ Improving…' : '✦ Auto-Improve'}
      </button>
    </div>
  );
}

export default function CriticDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [pauseConfig, setPauseConfig] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [improving, setImproving] = useState<string | null>(null);
  const [localThresholds, setLocalThresholds] = useState<Record<string, number>>({});
  const [savedMsg, setSavedMsg] = useState('');
  const [logFilter, setLogFilter] = useState<'all' | 'rejected' | 'flagged'>('all');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    try {
      const [s, l, pc] = await Promise.all([
        apmaApi.criticStats(),
        apmaApi.criticLogs({ limit: 30 }),
        apmaApi.criticPauseConfig(),
      ]);
      setStats(s);
      setLogs(l.logs ?? []);
      setPauseConfig(pc.thresholds ?? {});
      setLocalThresholds((prev) => {
        const merged: Record<string, number> = { ...pc.thresholds };
        for (const k of Object.keys(prev)) {
          if (!(k in pc.thresholds)) merged[k] = prev[k];
        }
        return merged;
      });
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load critic data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleSetThreshold = (agentType: string, value: number) => {
    setLocalThresholds(prev => ({ ...prev, [agentType]: value }));
  };

  const handleSaveThresholds = async () => {
    try {
      await apmaApi.setCriticPauseThresholds(localThresholds);
      setSavedMsg('Thresholds saved!');
      setTimeout(() => setSavedMsg(''), 2500);
      await fetchData();
    } catch (err: any) {
      setError('Save failed: ' + err.message);
    }
  };

  const handleAutoImprove = async (agentType: string) => {
    setImproving(agentType);
    try {
      const res = await apmaApi.criticAutoImprove(agentType);
      setSavedMsg(`Improvement plan generated for ${agentType}!`);
      setTimeout(() => setSavedMsg(''), 4000);
      console.log('[CriticDash] Improvement:', res);
      await fetchData();
    } catch (err: any) {
      setError('Auto-improve failed: ' + err.message);
    } finally {
      setImproving(null);
    }
  };

  const filteredLogs = logs.filter(l =>
    logFilter === 'all' ? true : l.verdict === logFilter
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#64748b' }}>
        ⟳ Loading Critic Agent data…
      </div>
    );
  }

  const agentEntries = Object.entries(stats?.byAgent ?? {}) as [string, { total: number; avg: number }][];
  const pausedAgents = agentEntries.filter(([k, v]) => v.avg < (localThresholds[k] ?? 50) && v.total > 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}
      {savedMsg && (
        <div style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 8, padding: '10px 14px', color: '#10b981', fontSize: 13 }}>
          ✓ {savedMsg}
        </div>
      )}

      {/* Overview KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { label: 'Total Evaluated', value: stats?.total?.toLocaleString() ?? '—', color: '#94a3b8' },
          { label: 'Approved', value: stats?.approved?.toLocaleString() ?? '—', color: '#10b981' },
          { label: 'Flagged', value: stats?.flagged?.toLocaleString() ?? '—', color: '#f59e0b' },
          { label: 'Rejected', value: stats?.rejected?.toLocaleString() ?? '—', color: '#ef4444' },
          { label: 'Avg Quality', value: stats?.avgScore ? `${stats.avgScore}/100` : '—', color: scoreColor(stats?.avgScore ?? 0) },
        ].map((kpi) => (
          <div key={kpi.label} style={{
            background: '#1e293b', borderRadius: 10, padding: '14px 16px',
            border: '1px solid #334155', textAlign: 'center',
          }}>
            <div style={{ color: kpi.color, fontWeight: 900, fontSize: 22, marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ color: '#475569', fontSize: 11, fontWeight: 600 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* 24h alert */}
      {stats?.last24h && stats.last24h.rejected > 0 && (
        <div style={{
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 10, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div>
            <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 13 }}>
              {stats.last24h.rejected} rejected outputs in the last 24h
            </span>
            <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>
              (of {stats.last24h.total} total evaluations)
            </span>
          </div>
        </div>
      )}

      {/* Paused agents alert */}
      {pausedAgents.length > 0 && (
        <div style={{
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.4)',
          borderRadius: 10, padding: '12px 16px',
        }}>
          <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            🔴 {pausedAgents.length} agent(s) below auto-pause threshold:
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pausedAgents.map(([k]) => (
              <span key={k} style={{
                background: 'rgba(239,68,68,.2)', color: '#ef4444',
                borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 700,
              }}>{k}</span>
            ))}
          </div>
        </div>
      )}

      {/* Per-agent cards */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14, margin: 0 }}>
            Agent Quality Scores
          </h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {savedMsg && <span style={{ color: '#10b981', fontSize: 12 }}>✓ Saved</span>}
            <button
              onClick={handleSaveThresholds}
              style={{
                background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.4)',
                borderRadius: 8, color: '#818cf8', fontSize: 12, fontWeight: 700,
                padding: '6px 14px', cursor: 'pointer',
              }}
            >
              Save Thresholds
            </button>
          </div>
        </div>
        {agentEntries.length === 0 ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
            No agent evaluations yet. Evaluations appear as agents run tasks.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {agentEntries.map(([agentType, data]) => (
              <AgentScoreCard
                key={agentType}
                agentType={agentType}
                data={data}
                threshold={localThresholds[agentType] ?? pauseConfig[agentType] ?? 50}
                onSetThreshold={(v) => handleSetThreshold(agentType, v)}
                onAutoImprove={() => handleAutoImprove(agentType)}
                improving={improving === agentType}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent logs */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14, margin: 0 }}>Recent Evaluations</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'flagged', 'rejected'] as const).map(f => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', border: 'none',
                  background: logFilter === f ? '#6366f1' : '#334155',
                  color: logFilter === f ? '#fff' : '#94a3b8',
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Time', 'Agent', 'Task', 'Score', 'Verdict', 'Issues'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', color: '#475569', fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>
                    No evaluations for this filter.
                  </td>
                </tr>
              ) : filteredLogs.map((log: any) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {new Date(log.created_at).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      color: AGENT_COLORS[log.agent_type] || '#94a3b8',
                      fontWeight: 700, fontSize: 11,
                    }}>
                      {log.agent_type || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{log.task_type || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ color: scoreColor(log.quality_score), fontWeight: 800 }}>
                      {log.quality_score}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>{verdictBadge(log.verdict)}</td>
                  <td style={{ padding: '8px 10px', color: '#64748b', maxWidth: 260 }}>
                    {Array.isArray(log.issues) && log.issues.length > 0
                      ? log.issues.slice(0, 2).join(' · ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
