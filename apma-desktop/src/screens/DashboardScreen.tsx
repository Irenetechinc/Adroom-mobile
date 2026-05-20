import { useEffect, useState, useCallback } from 'react';
import { apmaApi } from '../services/api';
import { clearCredentials } from '../services/api';
import { useAuthStore, useDashboardStore } from '../store';
import NarrativeScoreCard from '../components/NarrativeScoreCard';
import SentimentChart from '../components/SentimentChart';
import ActionsGrid from '../components/ActionsGrid';
import RecommendationsList from '../components/RecommendationsList';
import ThemesPanel from '../components/ThemesPanel';
import BlogsPanel from '../components/BlogsPanel';

type Tab = 'overview' | 'actions' | 'recommendations' | 'blogs';

export default function DashboardScreen() {
  const { clearAuth } = useAuthStore();
  const { dashboard, loading, lastUpdated, setDashboard, setLoading } = useDashboardStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [sentimentTrend, setSentimentTrend] = useState<any[]>([]);
  const [actions, setActions] = useState<any>(null);
  const [recs, setRecs] = useState<any[]>([]);
  const [blogs, setBlogs] = useState<any[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dash, trend, acts, recData, blogData] = await Promise.all([
        apmaApi.dashboard(),
        apmaApi.sentimentTrend(30),
        apmaApi.actions(),
        apmaApi.recommendations(),
        apmaApi.blogs(),
      ]);
      setDashboard(dash);
      setSentimentTrend(trend.trend ?? []);
      setActions(acts);
      setRecs(recData.recommendations ?? []);
      setBlogs(blogData.blogs ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => {
    const interval = setInterval(fetchAll, 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  async function handleSignOut() {
    await clearCredentials();
    clearAuth();
  }

  async function handleVeto(id: string) {
    try {
      await apmaApi.vetoRec(id);
      setRecs((r) => r.map((x) => x.id === id ? { ...x, status: 'vetoed' } : x));
    } catch (err: any) {
      alert('Veto failed: ' + err.message);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',        label: 'Overview'        },
    { id: 'actions',         label: 'Actions'         },
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'blogs',           label: 'Blogs'           },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background:'#0f172a' }}>
      {/* Top Bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 24px', background:'#1e293b', borderBottom:'1px solid #334155', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:20 }}>🎯</span>
          <div>
            <div style={{ fontWeight:700, fontSize:15, color:'#f1f5f9' }}>APMA Dashboard</div>
            {dashboard && (
              <div style={{ fontSize:11, color:'#64748b' }}>{dashboard.client?.name} · {dashboard.campaign?.name}</div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {lastUpdated && (
            <span style={{ fontSize:11, color:'#475569' }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button className="btn btn-ghost" onClick={fetchAll} disabled={loading} style={{ fontSize:12, padding:'6px 14px' }}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize:12, padding:'6px 14px' }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:2, padding:'0 24px', background:'#1e293b', borderBottom:'1px solid #334155', flexShrink:0 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background:'none', border:'none', cursor:'pointer',
              padding:'12px 18px', fontSize:13, fontWeight:500,
              color: tab === t.id ? '#6366f1' : '#94a3b8',
              borderBottom: tab === t.id ? '2px solid #6366f1' : '2px solid transparent',
              transition:'all .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:24 }}>
        {error && (
          <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:'12px 16px', color:'#ef4444', marginBottom:20 }}>
            ⚠ {error}
          </div>
        )}

        {loading && !dashboard && (
          <div style={{ textAlign:'center', color:'#64748b', padding:'80px 0' }}>Loading campaign data…</div>
        )}

        {tab === 'overview' && dashboard && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            {/* Narrative score + campaign stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:20 }}>
              <NarrativeScoreCard campaign={dashboard.campaign} />
              <ActionsGrid counts={dashboard.actions_24h} />
            </div>

            {/* Sentiment trend chart */}
            <div className="card">
              <h3 style={{ fontWeight:600, marginBottom:16, color:'#f1f5f9', fontSize:14 }}>Sentiment Trend — 30 days</h3>
              <SentimentChart data={sentimentTrend} />
            </div>

            {/* Themes */}
            <div className="card">
              <h3 style={{ fontWeight:600, marginBottom:16, color:'#f1f5f9', fontSize:14 }}>Top Narrative Themes</h3>
              <ThemesPanel themes={dashboard.top_themes ?? []} />
            </div>
          </div>
        )}

        {tab === 'actions' && (
          <div className="card">
            <h3 style={{ fontWeight:600, marginBottom:16, color:'#f1f5f9', fontSize:14 }}>Recent Actions (24h)</h3>
            {actions ? (
              <ActionsDetail actions={actions.actions ?? []} />
            ) : (
              <p style={{ color:'#64748b' }}>Loading actions…</p>
            )}
          </div>
        )}

        {tab === 'recommendations' && (
          <div className="card">
            <h3 style={{ fontWeight:600, marginBottom:16, color:'#f1f5f9', fontSize:14 }}>AI Recommendations</h3>
            <RecommendationsList recs={recs} onVeto={handleVeto} />
          </div>
        )}

        {tab === 'blogs' && (
          <div className="card">
            <h3 style={{ fontWeight:600, marginBottom:16, color:'#f1f5f9', fontSize:14 }}>Blog Network</h3>
            <BlogsPanel blogs={blogs} />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionsDetail({ actions }: { actions: any[] }) {
  if (!actions.length) return <p style={{ color:'#64748b' }}>No actions in the last 24 hours.</p>;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {actions.map((a: any, i: number) => (
        <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'#263348', borderRadius:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:16 }}>{platformEmoji(a.platform)}</span>
            <span style={{ color:'#e2e8f0', textTransform:'capitalize' }}>{a.action_type}</span>
            <span style={{ color:'#64748b', fontSize:12 }}>{a.platform}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span className={`badge ${a.success ? 'badge-green' : 'badge-red'}`}>{a.success ? 'success' : 'failed'}</span>
            <span style={{ color:'#475569', fontSize:11 }}>{new Date(a.executed_at).toLocaleTimeString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function platformEmoji(p: string) {
  const map: Record<string, string> = { twitter:'𝕏', facebook:'📘', reddit:'🟠', web:'🌐', telegram:'✈️', discord:'💬' };
  return map[p] ?? '📡';
}
