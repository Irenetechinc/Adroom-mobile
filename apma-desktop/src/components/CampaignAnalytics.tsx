import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apmaApi } from '../services/api';
import { SkeletonStats, SkeletonCard } from './SkeletonLoader';

const PLATFORM_COLORS: Record<string, string> = {
  twitter: '#1DA1F2', facebook: '#1877F2', reddit: '#FF4500',
  telegram: '#229ED9', linkedin: '#0A66C2', tiktok: '#FF0050', web: '#6366F1',
};

export default function CampaignAnalytics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apmaApi.analytics(days);
      setData(res);
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SkeletonStats count={4} />
      <SkeletonCard lines={5} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <SkeletonCard lines={6} />
        <SkeletonCard lines={6} />
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '12px 16px', color: '#ef4444', fontSize: 13 }}>
      ⚠ {error}
      <button onClick={load} style={{ marginLeft: 12, background: 'none', border: '1px solid rgba(239,68,68,.4)', color: '#ef4444', borderRadius: 5, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>Retry</button>
    </div>
  );

  if (!data?.campaign) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 12 }}>
      <span style={{ fontSize: 32 }}>📊</span>
      <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', maxWidth: 380, lineHeight: 1.6 }}>
        No active campaign found. Analytics populate automatically once a campaign starts running.
      </div>
    </div>
  );

  const trendData = (data.sentiment_trend ?? []).map((d: any) => ({
    label: new Date(d.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    score: parseFloat(d.score?.toFixed(4) ?? '0'),
  }));

  const dailyData = (data.by_day ?? []).slice(-days).map((d: any) => ({
    label: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    actions: d.count,
  }));

  const scoreColor = (s: number) => s >= 0.3 ? '#22c55e' : s >= 0 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Campaign: <span style={{ color: '#e2e8f0' }}>{data.campaign.name}</span>
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {([7, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ background: days === d ? '#6366f1' : '#1e293b', border: `1px solid ${days === d ? '#6366f1' : '#334155'}`, color: days === d ? '#fff' : '#94a3b8', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', transition: 'all .15s' }}>
              {d}d
            </button>
          ))}
          <button onClick={load} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>↻</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          ['Narrative Score', (data.campaign.narrative_score_current ?? 0).toFixed(3), scoreColor(data.campaign.narrative_score_current ?? 0)],
          ['Total Actions', String(data.total ?? 0), '#818cf8'],
          ['Success Rate', Math.round((data.success_rate ?? 0) * 100) + '%', '#22c55e'],
          ['Target Score', (data.campaign.narrative_score_target ?? 0.6).toFixed(2), '#f59e0b'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: '#131c2e', borderRadius: 8, padding: '14px 16px', border: '1px solid #1e293b', textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{val}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{label}</div>
          </div>
        ))}
      </div>

      {trendData.length > 1 && (
        <div style={{ background: '#131c2e', borderRadius: 10, padding: 16, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
            Narrative Score Trend
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[-1, 1]} tick={{ fill: '#475569', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
                itemStyle={{ color: '#818cf8' }}
                formatter={(v: number) => [v.toFixed(4), 'Score']}
              />
              <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#6366f1' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {dailyData.length > 1 && (
        <div style={{ background: '#131c2e', borderRadius: 10, padding: 16, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
            Daily Action Volume
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={dailyData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} itemStyle={{ color: '#6366f1' }} />
              <Bar dataKey="actions" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#131c2e', borderRadius: 10, padding: 16, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>By Action Type</div>
          {(data.by_type ?? []).length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>No data yet.</div>}
          {(data.by_type ?? []).slice(0, 7).map((t: any) => {
            const max = data.by_type[0]?.count ?? 1;
            return (
              <div key={t.type} style={{ marginBottom: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: '#e2e8f0', textTransform: 'capitalize' }}>{t.type.replace(/_/g, ' ')}</span>
                  <span style={{ color: '#64748b' }}>{t.count}</span>
                </div>
                <div style={{ height: 5, background: '#1e293b', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${Math.round(t.count / max * 100)}%`, background: '#6366f1', borderRadius: 3, transition: 'width .5s' }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: '#131c2e', borderRadius: 10, padding: 16, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>By Platform</div>
          {(data.by_platform ?? []).length === 0 && <div style={{ color: '#64748b', fontSize: 12 }}>No data yet.</div>}
          {(data.by_platform ?? []).slice(0, 7).map((p: any) => {
            const max = data.by_platform[0]?.count ?? 1;
            const color = PLATFORM_COLORS[p.platform] ?? '#6366f1';
            return (
              <div key={p.platform} style={{ marginBottom: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: '#e2e8f0', textTransform: 'capitalize' }}>{p.platform}</span>
                  <span style={{ color: '#64748b' }}>{p.count}</span>
                </div>
                <div style={{ height: 5, background: '#1e293b', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${Math.round(p.count / max * 100)}%`, background: color, borderRadius: 3, transition: 'width .5s' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
