interface Blog {
  id: string;
  name: string;
  domain: string;
  status: string;
  article_count: number;
  monthly_visits: number;
  created_at: string;
}

interface Props { blogs: Blog[] }

const STATUS_COLOR: Record<string, string> = {
  live:     '#22c55e',
  creating: '#f59e0b',
  paused:   '#94a3b8',
  down:     '#ef4444',
};

export default function BlogsPanel({ blogs }: Props) {
  if (!blogs.length) {
    return <p style={{ color:'#64748b' }}>No blog sites created yet. Sites are created automatically by APMA when the strategy includes blog tasks.</p>;
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {blogs.map((b) => (
        <div key={b.id} style={{ background:'#263348', border:'1px solid #334155', borderRadius:8, padding:'14px 16px', display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ width:10, height:10, borderRadius:'50%', background:STATUS_COLOR[b.status] ?? '#94a3b8', flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:600, color:'#f1f5f9' }}>{b.name}</div>
            <div style={{ fontSize:12, color:'#64748b' }}>{b.domain}</div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:700, color:'#818cf8' }}>{b.article_count}</div>
            <div style={{ fontSize:10, color:'#64748b' }}>articles</div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:700, color:'#22c55e' }}>{b.monthly_visits.toLocaleString()}</div>
            <div style={{ fontSize:10, color:'#64748b' }}>monthly visits</div>
          </div>
          <div style={{ fontSize:11, color:'#475569' }}>
            {new Date(b.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}
          </div>
        </div>
      ))}
    </div>
  );
}
