import { useState, useEffect, useCallback } from 'react';
import { apmaApi } from '../services/api';

interface StrategyPerf {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  paid_equivalent_usd: number;
  post_count: number;
  by_platform: Record<string, { impressions: number; likes: number; comments: number; shares: number }>;
  by_agent: Record<string, number>;
}

interface Strategy {
  id: string;
  plan_date: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  actions_total: number;
  actions_done: number;
  effectiveness: number | null;
  created_at: string;
  performance: StrategyPerf | null;
  has_performance: boolean;
}

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: '📘', instagram: '📸', twitter: '𝕏', reddit: '🟠',
  linkedin: '💼', tiktok: '🎵', telegram: '✈️', web: '🌐',
};

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  completed:  { color: '#22c55e', bg: 'rgba(34,197,94,.12)',    label: 'Completed'  },
  executing:  { color: '#6366f1', bg: 'rgba(99,102,241,.12)',   label: 'Executing'  },
  pending:    { color: '#f59e0b', bg: 'rgba(245,158,11,.12)',   label: 'Pending'    },
  failed:     { color: '#ef4444', bg: 'rgba(239,68,68,.12)',    label: 'Failed'     },
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function MetricPill({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', background: '#0f172a', borderRadius: 8, padding: '10px 14px', border: `1px solid ${color}22` }}>
      <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function PlatformBreakdown({ byPlatform }: { byPlatform: Record<string, { impressions: number; likes: number; comments: number; shares: number }> }) {
  const platforms = Object.entries(byPlatform).sort((a, b) => b[1].impressions - a[1].impressions);
  if (!platforms.length) return null;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {platforms.map(([platform, m]) => (
        <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#131c2e', borderRadius: 6, padding: '4px 8px', border: '1px solid #1e293b' }}>
          <span style={{ fontSize: 12 }}>{PLATFORM_EMOJI[platform] ?? '📡'}</span>
          <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{platform}</span>
          <span style={{ fontSize: 11, color: '#38bdf8' }}>{fmt(m.impressions)} imp</span>
          <span style={{ fontSize: 10, color: '#475569' }}>·</span>
          <span style={{ fontSize: 11, color: '#a78bfa' }}>{fmt(m.likes + m.comments + m.shares)} eng</span>
        </div>
      ))}
    </div>
  );
}

function StrategyCard({ strategy, expanded, onToggle }: { strategy: Strategy; expanded: boolean; onToggle: () => void }) {
  const st = STATUS_STYLE[strategy.status] ?? STATUS_STYLE.pending;
  const progress = strategy.actions_total > 0 ? (strategy.actions_done / strategy.actions_total) * 100 : 0;
  const p = strategy.performance;
  const engagements = p ? p.likes + p.comments + p.shares : 0;
  const roi = p ? p.paid_equivalent_usd : 0;

  return (
    <div style={{
      background: '#131c2e',
      borderRadius: 10,
      border: '1px solid #1e293b',
      borderLeft: `3px solid ${st.color}`,
      overflow: 'hidden',
    }}>
      {/* Header row — always visible */}
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: st.bg, color: st.color, flexShrink: 0 }}>
            {st.label}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
            {new Date(strategy.plan_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <span style={{ fontSize: 11, color: '#475569' }}>
            {strategy.actions_done}/{strategy.actions_total} actions
          </span>
        </div>

        {/* Summary metrics always shown in header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          {strategy.has_performance && p ? (
            <>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>{fmt(p.impressions)}</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Impressions</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>{fmt(engagements)}</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Engagements</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>${roi.toFixed(0)}</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Media Value</div>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 11, color: '#334155', fontStyle: 'italic' }}>
              {strategy.status === 'completed' ? 'No perf data' : 'Awaiting data'}
            </span>
          )}
          {strategy.effectiveness != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: strategy.effectiveness >= 0.5 ? '#22c55e' : strategy.effectiveness >= 0 ? '#f59e0b' : '#ef4444' }}>
                {(strategy.effectiveness * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Effectiveness</div>
            </div>
          )}
          <span style={{ color: '#334155', fontSize: 14 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Progress bar */}
      {strategy.actions_total > 0 && (
        <div style={{ height: 2, background: '#1e293b', margin: '0 16px' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: st.color, borderRadius: 1, transition: 'width 0.3s ease' }} />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '16px 16px 16px', borderTop: '1px solid #1a2540' }}>
          {strategy.has_performance && p ? (
            <>
              {/* 4 core KPI tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                <MetricPill label="Impressions"   value={fmt(p.impressions)}   color="#38bdf8" sub={p.reach > 0 ? `${fmt(p.reach)} reach` : undefined} />
                <MetricPill label="Clicks / Likes" value={fmt(p.likes)}        color="#a78bfa" />
                <MetricPill label="Replies"        value={fmt(p.comments)}     color="#f59e0b" sub={p.shares > 0 ? `+${fmt(p.shares)} shares` : undefined} />
                <MetricPill label="Media Value"    value={`$${roi.toFixed(2)}`} color="#22c55e" sub={`${p.post_count} posts tracked`} />
              </div>

              {/* Per-platform breakdown */}
              {Object.keys(p.by_platform).length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Platform breakdown</div>
                  <PlatformBreakdown byPlatform={p.by_platform} />
                </>
              )}

              {/* Agent type breakdown */}
              {Object.keys(p.by_agent).length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(p.by_agent).sort((a, b) => b[1] - a[1]).map(([agent, count]) => (
                    <span key={agent} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(99,102,241,.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,.2)' }}>
                      {agent.replace(/_/g, ' ')}: {count} task{count !== 1 ? 's' : ''}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#475569', fontSize: 12 }}>
              {strategy.status === 'pending'
                ? 'This strategy is pending execution — performance data will appear once agents run.'
                : strategy.status === 'executing'
                ? 'Agents are currently executing this strategy. Metrics update as posts go live.'
                : 'No performance data recorded for this strategy. Posts may have been sent without feedback tracking.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StrategiesPanel() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [limit, setLimit]           = useState(14);

  const load = useCallback(async (lim = limit) => {
    setLoading(true);
    setError('');
    try {
      const res = await apmaApi.strategies(lim);
      setStrategies(res.strategies ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load strategies');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { load(); }, []);

  function toggle(id: string) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  // Summary stats across all strategies with performance data
  const withPerf = strategies.filter((s) => s.has_performance && s.performance);
  const totals = withPerf.reduce(
    (acc, s) => {
      const p = s.performance!;
      acc.impressions += p.impressions;
      acc.likes       += p.likes;
      acc.comments    += p.comments;
      acc.shares      += p.shares;
      acc.roi         += p.paid_equivalent_usd;
      return acc;
    },
    { impressions: 0, likes: 0, comments: 0, shares: 0, roi: 0 }
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Aggregate KPI banner */}
      {withPerf.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {[
            { label: 'Total Impressions', value: fmt(totals.impressions), color: '#38bdf8' },
            { label: 'Total Clicks',      value: fmt(totals.likes),       color: '#a78bfa' },
            { label: 'Total Replies',     value: fmt(totals.comments),    color: '#f59e0b' },
            { label: 'Total Shares',      value: fmt(totals.shares),      color: '#fb923c' },
            { label: 'Total Media Value', value: `$${totals.roi.toFixed(0)}`, color: '#22c55e' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: '#131c2e', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e293b', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {strategies.length} strateg{strategies.length !== 1 ? 'ies' : 'y'} · {withPerf.length} with performance data
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={limit}
            onChange={(e) => { const v = Number(e.target.value); setLimit(v); load(v); }}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}
          >
            <option value={7}>Last 7</option>
            <option value={14}>Last 14</option>
            <option value={30}>Last 30</option>
          </select>
          <button
            onClick={() => load()}
            disabled={loading}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {loading && strategies.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '60px 0', fontSize: 13 }}>Loading strategies…</div>
      )}

      {!loading && strategies.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '60px 0', fontSize: 13 }}>
          No strategies yet. APMA generates a daily strategy plan for each active campaign.
        </div>
      )}

      {/* Strategy cards */}
      {strategies.map((s) => (
        <StrategyCard
          key={s.id}
          strategy={s}
          expanded={expanded === s.id}
          onToggle={() => toggle(s.id)}
        />
      ))}

      {/* Legend */}
      {strategies.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid #1e293b' }}>
          <span style={{ fontSize: 10, color: '#334155' }}>
            📊 <span style={{ color: '#475569' }}>Media Value = estimated paid advertising equivalent based on reach and engagement rate per platform CPM</span>
          </span>
        </div>
      )}
    </div>
  );
}
