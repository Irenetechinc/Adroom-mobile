import { useState, useEffect, useCallback } from 'react';
import { apmaApi } from '../services/api';

interface PredictedEvent {
  date: string;
  event: string;
  probability: number;
  suggested_action: string;
  campaign_id?: string;
  campaign_name?: string;
  client_name?: string;
}

type Horizon = 7 | 30 | 90;

const PROB_COLOR = (p: number) =>
  p >= 0.75 ? '#ef4444' : p >= 0.5 ? '#f59e0b' : '#22c55e';

const PROB_LABEL = (p: number) =>
  p >= 0.75 ? 'High' : p >= 0.5 ? 'Medium' : 'Low';

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

interface Props {
  adminMode?: boolean;
}

export default function PredictiveCalendar({ adminMode = false }: Props) {
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [events, setEvents] = useState<PredictedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<PredictedEvent | null>(null);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apmaApi.predictedEvents(horizon);
      setEvents(res.events ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }, [horizon]);

  useEffect(() => { load(); }, [load]);

  const eventsByDate = events.reduce<Record<string, PredictedEvent[]>>((acc, ev) => {
    const d = ev.date.slice(0, 10);
    if (!acc[d]) acc[d] = [];
    acc[d].push(ev);
    return acc;
  }, {});

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const daysInMonth  = getDaysInMonth(viewYear, viewMonth);
  const firstDayOfWeek = getFirstDayOfWeek(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const upcomingEvents = events
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>Horizon:</span>
          {([7, 30, 90] as Horizon[]).map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              style={{
                background: horizon === h ? '#6366f1' : '#263348',
                color: horizon === h ? '#fff' : '#94a3b8',
                border: 'none', borderRadius: 6, padding: '5px 14px',
                fontSize: 12, cursor: 'pointer', fontWeight: 500,
              }}
            >
              {h}d
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            {[['High', '#ef4444'], ['Medium', '#f59e0b'], ['Low', '#22c55e']].map(([l, c]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c as string, display: 'inline-block' }} />
                {l}
              </span>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            {loading ? '⟳' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        {/* Monthly Calendar Grid */}
        <div style={{ background: '#131c2e', borderRadius: 12, border: '1px solid #1e293b', overflow: 'hidden' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #1e293b' }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, padding: '0 6px' }}>‹</button>
            <span style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 14 }}>{monthName}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, padding: '0 6px' }}>›</button>
          </div>

          {/* Day-of-week headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
            {DAY_LABELS.map(d => (
              <div key={d} style={{ textAlign: 'center', padding: '8px 0', fontSize: 11, fontWeight: 600, color: '#475569', borderBottom: '1px solid #1e293b' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
            {/* Empty cells for start offset */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} style={{ minHeight: 80, borderRight: '1px solid #1a2540', borderBottom: '1px solid #1a2540' }} />
            ))}

            {/* Actual day cells */}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayEvents = eventsByDate[dateStr] ?? [];
              const isToday = dateStr === todayStr;
              const isPast  = dateStr < todayStr;

              return (
                <div
                  key={day}
                  style={{
                    minHeight: 80,
                    padding: '6px',
                    borderRight: '1px solid #1a2540',
                    borderBottom: '1px solid #1a2540',
                    background: isToday ? 'rgba(99,102,241,.08)' : 'transparent',
                    opacity: isPast ? 0.5 : 1,
                    verticalAlign: 'top',
                  }}
                >
                  <div style={{
                    fontSize: 11, fontWeight: 600,
                    color: isToday ? '#6366f1' : '#64748b',
                    marginBottom: 4,
                    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: isToday ? '50%' : undefined,
                    background: isToday ? 'rgba(99,102,241,.2)' : 'transparent',
                  }}>
                    {day}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {dayEvents.slice(0, 3).map((ev, ei) => (
                      <div
                        key={ei}
                        onClick={() => setSelectedEvent(ev)}
                        title={ev.event}
                        style={{
                          background: `${PROB_COLOR(ev.probability)}22`,
                          border: `1px solid ${PROB_COLOR(ev.probability)}55`,
                          borderLeft: `3px solid ${PROB_COLOR(ev.probability)}`,
                          borderRadius: 4, padding: '2px 4px',
                          fontSize: 9, color: '#e2e8f0',
                          cursor: 'pointer', overflow: 'hidden',
                          whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          maxWidth: '100%',
                          lineHeight: 1.3,
                        }}
                      >
                        {ev.event.length > 22 ? ev.event.slice(0, 22) + '…' : ev.event}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: 9, color: '#64748b', paddingLeft: 3 }}>+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar — upcoming events list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>
            Upcoming ({upcomingEvents.length})
          </div>
          {loading && events.length === 0 && (
            <div style={{ color: '#64748b', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
              Generating AI predictions…
            </div>
          )}
          {!loading && upcomingEvents.length === 0 && !error && (
            <div style={{ color: '#64748b', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
              No upcoming events predicted. Try increasing the horizon.
            </div>
          )}
          {upcomingEvents.map((ev, i) => {
            const probColor = PROB_COLOR(ev.probability);
            const daysAway = Math.round((new Date(ev.date).getTime() - today.getTime()) / 86_400_000);
            return (
              <div
                key={i}
                onClick={() => setSelectedEvent(ev)}
                style={{
                  background: '#131c2e', border: '1px solid #1e293b',
                  borderLeft: `3px solid ${probColor}`,
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                  transition: 'border-color .15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {new Date(ev.date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    {' '}
                    <span style={{ color: '#475569' }}>({daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway}d`})</span>
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: `${probColor}22`, color: probColor,
                  }}>
                    {PROB_LABEL(ev.probability)} {Math.round(ev.probability * 100)}%
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 4 }}>
                  {ev.event}
                </div>
                {(ev.campaign_name || ev.client_name) && (
                  <div style={{ fontSize: 10, color: '#475569' }}>
                    {ev.client_name ?? ev.campaign_name}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
          }}
          onClick={() => setSelectedEvent(null)}
        >
          <div
            style={{
              background: '#1e293b', borderRadius: 14, padding: 24, maxWidth: 480, width: '90%',
              border: `1px solid ${PROB_COLOR(selectedEvent.probability)}44`,
              boxShadow: '0 24px 60px rgba(0,0,0,.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Predicted Event</span>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                background: `${PROB_COLOR(selectedEvent.probability)}22`,
                color: PROB_COLOR(selectedEvent.probability),
                border: `1px solid ${PROB_COLOR(selectedEvent.probability)}44`,
              }}>
                {PROB_LABEL(selectedEvent.probability)} PROBABILITY — {Math.round(selectedEvent.probability * 100)}%
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {new Date(selectedEvent.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>

            <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.6, marginBottom: 18, fontWeight: 500 }}>
              {selectedEvent.event}
            </div>

            {(selectedEvent.campaign_name || selectedEvent.client_name) && (
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 14 }}>
                Campaign: <span style={{ color: '#94a3b8' }}>{selectedEvent.client_name ?? selectedEvent.campaign_name}</span>
              </div>
            )}

            <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                APMA Suggested Action
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
                {selectedEvent.suggested_action}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
