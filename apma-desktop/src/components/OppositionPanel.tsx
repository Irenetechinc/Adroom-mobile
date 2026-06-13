import { useState, useEffect, useCallback } from 'react';
import { apmaApi } from '../services/api';
import { SkeletonCard } from './SkeletonLoader';

const PLATFORM_EMOJI: Record<string, string> = {
  twitter: '𝕏', facebook: '📘', reddit: '🟠', telegram: '✈️', linkedin: '💼', web: '🌐',
};

export default function OppositionPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apmaApi.opposition();
      setData(res);
    } catch (e: any) {
      setError(e.message || 'Failed to load opposition data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[3, 2, 3, 2].map((lines, i) => <SkeletonCard key={i} lines={lines} />)}
    </div>
  );

  if (error) return (
    <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '12px 16px', color: '#ef4444', fontSize: 13 }}>
      ⚠ {error}
      <button onClick={load} style={{ marginLeft: 12, background: 'none', border: '1px solid rgba(239,68,68,.4)', color: '#ef4444', borderRadius: 5, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  if (!data || !data.threats?.length) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 12 }}>
      <span style={{ fontSize: 32 }}>🛡️</span>
      <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', maxWidth: 380, lineHeight: 1.6 }}>
        No opposition signals detected yet. Signals populate here once the campaign perception cycle runs (every 15 min).
      </div>
      <button onClick={load} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', marginTop: 4 }}>
        ↻ Check Now
      </button>
    </div>
  );

  const momentum: number = data.momentum ?? 0;
  const momentumColor = momentum > 0.05 ? '#22c55e' : momentum < -0.05 ? '#ef4444' : '#f59e0b';
  const momentumLabel = momentum > 0.05 ? '↑ Improving' : momentum < -0.05 ? '↓ Worsening' : '→ Stable';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ background: '#131c2e', borderRadius: 8, padding: 14, border: '1px solid #1e293b', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Opposition Signals (30d)</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#ef4444' }}>{data.total_opposition_signals ?? 0}</div>
        </div>
        <div style={{ background: '#131c2e', borderRadius: 8, padding: 14, border: '1px solid #1e293b', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Active Threat Clusters</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>{(data.threats ?? []).length}</div>
        </div>
        <div style={{ background: '#131c2e', borderRadius: 8, padding: 14, border: '1px solid #1e293b', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Narrative Momentum</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: momentumColor }}>{momentumLabel}</div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
            {momentum >= 0 ? '+' : ''}{(momentum * 100).toFixed(1)}% vs 15 days ago
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Real-Time Threat Intelligence — Sorted by Volume
        </div>
        {(data.threats ?? []).map((threat: any, i: number) => {
          const sentColor = threat.avg_sentiment < -0.5 ? '#ef4444' : threat.avg_sentiment < -0.3 ? '#f59e0b' : '#64748b';
          const barColor = threat.avg_sentiment < -0.5 ? '#ef4444' : threat.avg_sentiment < -0.3 ? '#f59e0b' : '#334155';
          return (
            <div key={threat.cluster} style={{
              background: '#131c2e', borderRadius: 10, marginBottom: 8,
              border: '1px solid #1e293b',
              borderLeft: `3px solid ${barColor}`,
              overflow: 'hidden',
            }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer' }}
                onClick={() => setExpanded(expanded === threat.cluster ? null : threat.cluster)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', flexShrink: 0 }}>#{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {threat.cluster.replace(/_/g, ' ')}
                  </span>
                  {threat.trending && (
                    <span style={{ fontSize: 10, background: 'rgba(239,68,68,.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,.3)', borderRadius: 4, padding: '1px 7px', fontWeight: 700, flexShrink: 0 }}>
                      🔥 TRENDING
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{threat.volume} signals</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: sentColor, background: `${sentColor}18`, border: `1px solid ${sentColor}40`, borderRadius: 4, padding: '1px 7px' }}>
                    {threat.avg_sentiment.toFixed(3)}
                  </span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {(threat.platforms ?? []).map((p: string) => (
                      <span key={p} title={p} style={{ fontSize: 12 }}>{PLATFORM_EMOJI[p] ?? '📡'}</span>
                    ))}
                  </div>
                  <span style={{ color: '#475569', fontSize: 12 }}>{expanded === threat.cluster ? '▲' : '▼'}</span>
                </div>
              </div>

              {expanded === threat.cluster && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid #1a2540' }}>
                  {threat.samples?.length > 0 ? (
                    <>
                      <div style={{ fontSize: 11, color: '#64748b', padding: '10px 0 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Intelligence samples from social monitoring:
                      </div>
                      {threat.samples.map((sample: string, j: number) => (
                        <div key={j} style={{
                          background: '#0a1628', borderRadius: 6, padding: '8px 12px', marginBottom: 6,
                          fontSize: 12, color: '#94a3b8', lineHeight: 1.6,
                          borderLeft: '2px solid #334155',
                        }}>
                          "{sample}"
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: '#475569', paddingTop: 10 }}>No content samples available for this cluster.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#334155' }}>Auto-refreshes every campaign cycle (15 min)</span>
        <button onClick={load} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>
          ↻ Refresh Intelligence
        </button>
      </div>
    </div>
  );
}
