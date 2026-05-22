import { useEffect, useRef, useState, useCallback } from 'react';
import { apmaApi } from '../services/api';
import { clearCredentials } from '../services/api';
import { useAuthStore, useDashboardStore } from '../store';
import NarrativeScoreCard from '../components/NarrativeScoreCard';
import SentimentChart from '../components/SentimentChart';
import ActionsGrid from '../components/ActionsGrid';
import RecommendationsList from '../components/RecommendationsList';
import ThemesPanel from '../components/ThemesPanel';
import BlogsPanel from '../components/BlogsPanel';
import PredictiveCalendar from '../components/PredictiveCalendar';
import InsightsPanel from '../components/InsightsPanel';
import SocialAccountsPanel from '../components/SocialAccountsPanel';
import OppositionPanel from '../components/OppositionPanel';
import CampaignAnalytics from '../components/CampaignAnalytics';
import { SkeletonStats, SkeletonCard } from '../components/SkeletonLoader';

type Tab = 'overview' | 'analytics' | 'opposition' | 'actions' | 'recommendations' | 'blogs' | 'calendar' | 'insights' | 'accounts' | 'monitor';

const EVENT_COLOURS: Record<string, string> = {
  start:           '#818CF8',
  perception_start:'#38BDF8',
  perception_done: '#22D3EE',
  score_updated:   '#34D399',
  decision_start:  '#FBBF24',
  decision_done:   '#F59E0B',
  action_start:    '#FB923C',
  action_done:     '#22C55E',
  action_resume:   '#F472B6',
  cycle_complete:  '#A78BFA',
  prediction_start:'#60A5FA',
  prediction_done: '#93C5FD',
};

export default function DashboardScreen() {
  const { clearAuth } = useAuthStore();
  const { dashboard, loading, lastUpdated, setDashboard, setLoading } = useDashboardStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [sentimentTrend, setSentimentTrend] = useState<any[]>([]);
  const [actions, setActions] = useState<any>(null);
  const [recs, setRecs] = useState<any[]>([]);
  const [blogs, setBlogs] = useState<any[]>([]);
  const [monitorEvents, setMonitorEvents] = useState<any[]>([]);
  const monitorSeqRef = useRef<number>(0);
  const monitorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Monitor tab: poll events every 5 s while active
  useEffect(() => {
    if (tab !== 'monitor') {
      if (monitorTimerRef.current) { clearInterval(monitorTimerRef.current); monitorTimerRef.current = null; }
      return;
    }
    async function pollEvents() {
      try {
        const res = await apmaApi.events(monitorSeqRef.current);
        if (res.events.length > 0) {
          monitorSeqRef.current = res.latest_seq;
          setMonitorEvents((prev) => [...prev, ...res.events].slice(-200));
        }
      } catch {}
    }
    pollEvents();
    monitorTimerRef.current = setInterval(pollEvents, 5000);
    return () => { if (monitorTimerRef.current) { clearInterval(monitorTimerRef.current); monitorTimerRef.current = null; } };
  }, [tab]);

  async function handleSignOut() {
    await clearCredentials();
    clearAuth();
  }

  async function handleVeto(id: string) {
    try {
      await apmaApi.vetoRec(id);
      setRecs((r) => r.map((x) => x.id === id ? { ...x, status: 'vetoed' } : x));
    } catch (err: any) {
      setError('Veto failed: ' + (err.message || 'Unknown error'));
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview',        label: 'Overview'        },
    { id: 'analytics',       label: '📊 Analytics'   },
    { id: 'opposition',      label: '🛡️ Opposition'  },
    { id: 'insights',        label: '🧠 Insights'     },
    { id: 'accounts',        label: '🔗 Accounts'     },
    { id: 'actions',         label: 'Actions'         },
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'blogs',           label: 'Blogs'           },
    { id: 'calendar',        label: '📅 Calendar'     },
    { id: 'monitor',         label: '⬤ Monitor'       },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background:'#0f172a' }}>
      {/* Top Bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 24px', background:'#1e293b', borderBottom:'1px solid #334155', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:20 }}>🎯</span>
          <div>
            <div style={{ fontWeight:900, fontSize:16, color:'#f1f5f9', letterSpacing:'-0.01em' }}>APMA</div>
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
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:20 }}>
              <SkeletonCard lines={4} />
              <SkeletonStats count={5} />
            </div>
            <SkeletonCard lines={5} />
            <SkeletonCard lines={3} />
          </div>
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

        {tab === 'insights' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
              <h3 style={{ fontWeight:600, color:'#f1f5f9', fontSize:14, margin:0 }}>APMA Intelligence</h3>
              <span style={{ fontSize:11, color:'#64748b' }}>Client intelligence profile & AI self-improvement activity</span>
            </div>
            <InsightsPanel />
          </div>
        )}

        {tab === 'accounts' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
              <h3 style={{ fontWeight:600, color:'#f1f5f9', fontSize:14, margin:0 }}>Social Accounts</h3>
              <span style={{ fontSize:11, color:'#64748b' }}>Connected accounts APMA uses autonomously across platforms</span>
            </div>
            <SocialAccountsPanel />
          </div>
        )}

        {tab === 'analytics' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
              <h3 style={{ fontWeight:600, color:'#f1f5f9', fontSize:14, margin:0 }}>Campaign Analytics</h3>
              <span style={{ fontSize:11, color:'#64748b' }}>Realtime — powered by live agent data</span>
            </div>
            <CampaignAnalytics />
          </div>
        )}

        {tab === 'opposition' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
              <h3 style={{ fontWeight:600, color:'#f1f5f9', fontSize:14, margin:0 }}>Opposition Intelligence</h3>
              <span style={{ fontSize:11, color:'#64748b' }}>Deep analysis of counter-narratives and threats</span>
            </div>
            <OppositionPanel />
          </div>
        )}

        {tab === 'calendar' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
              <h3 style={{ fontWeight:600, color:'#f1f5f9', fontSize:14, margin:0 }}>Predictive Events Calendar</h3>
              <span style={{ fontSize:11, color:'#64748b' }}>AI-predicted political & narrative events requiring campaign action</span>
            </div>
            <PredictiveCalendar />
          </div>
        )}

        {tab === 'monitor' && (
          <div className="card" style={{ display:'flex', flexDirection:'column', gap:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <h3 style={{ fontWeight:600, color:'#f1f5f9', fontSize:14, margin:0 }}>Live Cycle Monitor</h3>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background: monitorTimerRef.current ? '#22C55E' : '#475569' }} />
                <span style={{ fontSize:11, color:'#64748b' }}>{monitorTimerRef.current ? 'Polling every 5s' : 'Idle'}</span>
                <button
                  onClick={() => { setMonitorEvents([]); monitorSeqRef.current = 0; }}
                  style={{ background:'none', border:'1px solid #334155', color:'#94a3b8', borderRadius:5, padding:'3px 10px', fontSize:11, cursor:'pointer' }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div style={{ height:480, overflowY:'auto', background:'#0a1628', borderRadius:8, padding:'12px 14px', fontFamily:'monospace', fontSize:11, display:'flex', flexDirection:'column', gap:4 }}>
              {monitorEvents.length === 0 ? (
                <span style={{ color:'#475569' }}>No cycle events yet. Events appear here every 15 minutes when a campaign cycle runs.</span>
              ) : (
                monitorEvents.map((ev, i) => {
                  const colour = EVENT_COLOURS[ev.event as string] ?? '#94a3b8';
                  const ts = new Date(ev.ts).toLocaleTimeString();
                  const label = ev.event.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                  const clientName = ev.client_name ? ` [${ev.client_name}]` : '';
                  let detail = '';
                  if (ev.data?.client)               detail = ` — ${ev.data.client}`;
                  else if (ev.data?.executed != null) detail = ` — ${ev.data.executed} ok / ${ev.data.failed} fail`;
                  else if (ev.data?.sample_size)      detail = ` — ${ev.data.sample_size} samples, sentiment ${(ev.data.overall_sentiment ?? 0).toFixed(2)}`;
                  else if (ev.data?.narrative_score != null) detail = ` — score ${ev.data.narrative_score.toFixed(2)}`;
                  else if (ev.data?.total_actions)    detail = ` — ${ev.data.total_actions} actions`;
                  return (
                    <div key={i} style={{ display:'flex', gap:6 }}>
                      <span style={{ color:'#475569', flexShrink:0 }}>[{ts}]</span>
                      <span style={{ color:'#6366f1', flexShrink:0 }}>{clientName}</span>
                      <span style={{ color:colour, fontWeight:600, flexShrink:0 }}>{label}</span>
                      <span style={{ color:'#94a3b8' }}>{detail}</span>
                    </div>
                  );
                })
              )}
            </div>
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
