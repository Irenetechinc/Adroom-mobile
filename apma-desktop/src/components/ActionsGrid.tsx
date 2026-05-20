interface Props {
  counts: {
    posts: number;
    comments: number;
    blog_articles: number;
    group_engagements: number;
    total: number;
  };
}

const CELLS = [
  { key: 'posts',            label: 'Posts Published', icon: '📢' },
  { key: 'comments',         label: 'Comments / Replies', icon: '💬' },
  { key: 'blog_articles',    label: 'Blog Articles', icon: '📰' },
  { key: 'group_engagements',label: 'Group Activity', icon: '👥' },
  { key: 'total',            label: 'Total Actions', icon: '⚡', highlight: true },
] as const;

export default function ActionsGrid({ counts }: Props) {
  return (
    <div className="card">
      <h3 style={{ fontWeight:600, marginBottom:16, color:'#f1f5f9', fontSize:14 }}>Activity — Last 24 Hours</h3>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:12 }}>
        {CELLS.map((c) => (
          <div
            key={c.key}
            style={{
              background: c.highlight ? 'rgba(99,102,241,.1)' : '#263348',
              border: `1px solid ${c.highlight ? '#6366f1' : '#334155'}`,
              borderRadius:8, padding:'14px 10px', textAlign:'center',
            }}
          >
            <div style={{ fontSize:22, marginBottom:6 }}>{c.icon}</div>
            <div style={{ fontSize:26, fontWeight:700, color: c.highlight ? '#818cf8' : '#f1f5f9' }}>
              {counts[c.key] ?? 0}
            </div>
            <div style={{ fontSize:10, color:'#64748b', marginTop:4 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
