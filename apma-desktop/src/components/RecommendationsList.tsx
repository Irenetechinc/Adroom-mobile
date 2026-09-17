interface Rec {
  id: string;
  text: string;
  priority: string;
  status: string;
  created_at: string;
  implemented_at?: string;
}

interface Props {
  recs: Rec[];
  onVeto: (id: string) => void;
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'badge-red',
  high:     'badge-red',
  medium:   'badge-amber',
  low:      'badge-muted',
};

const STATUS_BADGE: Record<string, string> = {
  pending:        'badge-amber',
  implementing:   'badge-purple',
  done:           'badge-green',
  vetoed:         'badge-muted',
};

export default function RecommendationsList({ recs, onVeto }: Props) {
  if (!recs.length) return <p style={{ color:'#64748b' }}>No recommendations yet.</p>;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {recs.map((r) => (
        <div
          key={r.id}
          style={{ background:'#263348', border:'1px solid #334155', borderRadius:8, padding:'14px 16px' }}
        >
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
            <div style={{ flex:1 }}>
              <p style={{ color:'#e2e8f0', lineHeight:1.5, marginBottom:10 }}>{r.text}</p>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <span className={`badge ${PRIORITY_BADGE[r.priority] ?? 'badge-muted'}`}>{r.priority}</span>
                <span className={`badge ${STATUS_BADGE[r.status] ?? 'badge-muted'}`}>{r.status}</span>
                <span style={{ fontSize:11, color:'#475569', alignSelf:'center' }}>
                  {new Date(r.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                </span>
              </div>
            </div>
            {(r.status === 'pending' || r.status === 'implementing') && (
              <button
                className="btn btn-ghost"
                onClick={() => onVeto(r.id)}
                style={{ fontSize:11, padding:'5px 12px', color:'#ef4444', borderColor:'rgba(239,68,68,.3)', flexShrink:0 }}
              >
                Veto
              </button>
            )}
          </div>
          {r.implemented_at && (
            <p style={{ fontSize:11, color:'#22c55e', marginTop:8 }}>
              ✓ Implemented {new Date(r.implemented_at).toLocaleDateString()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
