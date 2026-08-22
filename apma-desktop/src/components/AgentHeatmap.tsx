/**
 * AgentHeatmap — 7-day rolling quality score grid (agent × platform)
 * Colour-coded cells: green ≥75, amber 50-74, red <50, slate = no data
 */
import { useEffect, useState } from 'react';

interface HeatmapCell {
  agentType: string;
  platform:  string;
  avgScore:  number;
  count:     number;
  verdict:   'good' | 'warn' | 'bad' | 'none';
}

interface Props {
  fetchHeatmap: () => Promise<{ cells: HeatmapCell[] }>;
  agents:    string[];
  platforms: string[];
  title?:    string;
}

function cellColor(cell: HeatmapCell | undefined): string {
  if (!cell) return '#0f172a';
  if (cell.avgScore >= 75) return 'rgba(16,185,129,0.18)';
  if (cell.avgScore >= 50) return 'rgba(245,158,11,0.18)';
  return 'rgba(239,68,68,0.18)';
}
function cellBorder(cell: HeatmapCell | undefined): string {
  if (!cell) return '#1e293b';
  if (cell.avgScore >= 75) return 'rgba(16,185,129,0.45)';
  if (cell.avgScore >= 50) return 'rgba(245,158,11,0.45)';
  return 'rgba(239,68,68,0.45)';
}
function cellTextColor(cell: HeatmapCell | undefined): string {
  if (!cell) return '#334155';
  if (cell.avgScore >= 75) return '#10B981';
  if (cell.avgScore >= 50) return '#F59E0B';
  return '#EF4444';
}

export default function AgentHeatmap({ fetchHeatmap, agents, platforms, title }: Props) {
  const [cells, setCells]   = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await fetchHeatmap();
        if (alive) { setCells(data.cells || []); setLoading(false); }
      } catch (e: any) {
        if (alive) { setError(e.message); setLoading(false); }
      }
    }
    load();
    const iv = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Build lookup map
  const map = new Map<string, HeatmapCell>();
  for (const c of cells) map.set(`${c.agentType}||${c.platform}`, c);

  const PLATFORM_LABELS: Record<string, string> = {
    facebook: 'FB', instagram: 'IG', twitter: 'X', linkedin: 'LI',
    tiktok: 'TT', reddit: 'RD', telegram: 'TG', web: 'WB',
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:32, color:'#475569', fontSize:13 }}>
      Loading heatmap…
    </div>
  );
  if (error) return (
    <div style={{ color:'#EF4444', padding:16, fontSize:12 }}>Heatmap error: {error}</div>
  );

  // Filter out agents/platforms that have no data if cells is empty
  const activeAgents    = agents;
  const activePlatforms = platforms;

  return (
    <div>
      {title && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#f1f5f9' }}>{title}</span>
          <span style={{ fontSize:10, color:'#475569', background:'#1e293b', borderRadius:4, padding:'2px 6px' }}>
            7-day rolling avg · refreshes every 60s
          </span>
          <div style={{
            marginLeft:'auto', display:'flex', alignItems:'center', gap:16, fontSize:11,
          }}>
            {[
              { label:'≥75 Good',    color:'#10B981' },
              { label:'50–74 Warn',  color:'#F59E0B' },
              { label:'<50 Bad',     color:'EF4444' },
            ].map(({ label, color }) => (
              <span key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:10, height:10, borderRadius:2, background:color, display:'inline-block' }} />
                <span style={{ color:'#64748b' }}>{label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ overflowX:'auto' }}>
        <table style={{ borderCollapse:'separate', borderSpacing:4, width:'100%' }}>
          <thead>
            <tr>
              <th style={{ padding:'6px 12px', textAlign:'left', color:'#475569', fontSize:11, fontWeight:700, background:'transparent' }}>
                AGENT
              </th>
              {activePlatforms.map(p => (
                <th key={p} style={{
                  padding:'6px 8px', color:'#64748b', fontSize:11, fontWeight:700,
                  textAlign:'center', whiteSpace:'nowrap', textTransform:'uppercase',
                }}>
                  {PLATFORM_LABELS[p] || p.slice(0,2).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeAgents.map(agent => (
              <tr key={agent}>
                <td style={{
                  padding:'6px 12px', fontWeight:700, fontSize:12,
                  color: agent === 'SALESMAN' ? '#10B981'
                       : agent === 'AWARENESS' ? '#00F0FF'
                       : agent === 'PROMOTION' ? '#F59E0B'
                       : agent === 'LAUNCH'    ? '#8B5CF6'
                       : '#94A3B8',
                  whiteSpace:'nowrap',
                }}>
                  {agent}
                </td>
                {activePlatforms.map(platform => {
                  const cell = map.get(`${agent}||${platform}`);
                  return (
                    <td key={platform} title={cell ? `${cell.count} evals — avg ${cell.avgScore}/100` : 'No data yet'}>
                      <div style={{
                        background:   cellColor(cell),
                        border:       `1px solid ${cellBorder(cell)}`,
                        borderRadius: 8,
                        padding:      '6px 4px',
                        textAlign:    'center',
                        minWidth:     44,
                        cursor:       'default',
                        transition:   'filter .15s',
                      }}
                        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.3)')}
                        onMouseLeave={e => (e.currentTarget.style.filter = '')}
                      >
                        {cell ? (
                          <>
                            <div style={{ fontSize:15, fontWeight:800, color: cellTextColor(cell) }}>
                              {cell.avgScore}
                            </div>
                            <div style={{ fontSize:9, color:'#475569', marginTop:1 }}>
                              {cell.count}ev
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize:12, color:'#334155' }}>—</div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
