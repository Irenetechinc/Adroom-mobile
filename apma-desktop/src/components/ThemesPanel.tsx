interface Theme {
  theme: string;
  sentiment: 'positive' | 'negative';
  volume: number;
}

interface Props { themes: Theme[] }

export default function ThemesPanel({ themes }: Props) {
  if (!themes.length) return <p style={{ color:'#64748b' }}>No theme data collected yet.</p>;

  const maxVol = Math.max(...themes.map((t) => t.volume), 1);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {themes.map((t, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:14 }}>
          <span className={`badge ${t.sentiment === 'positive' ? 'badge-green' : 'badge-red'}`} style={{ width:70, justifyContent:'center' }}>
            {t.sentiment}
          </span>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ color:'#e2e8f0', fontSize:13, textTransform:'capitalize' }}>
                {t.theme.replace(/_/g, ' ')}
              </span>
              <span style={{ color:'#64748b', fontSize:12 }}>{t.volume} mentions</span>
            </div>
            <div style={{ height:6, background:'#334155', borderRadius:3, overflow:'hidden' }}>
              <div style={{
                height:'100%',
                width:`${(t.volume / maxVol) * 100}%`,
                background: t.sentiment === 'positive' ? '#22c55e' : '#ef4444',
                borderRadius:3,
                transition:'width .5s',
              }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
