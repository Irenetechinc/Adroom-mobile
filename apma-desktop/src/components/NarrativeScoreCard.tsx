interface Props {
  campaign: {
    name: string;
    status: string;
    start_date: string;
    narrative_score_current: number;
    narrative_score_target: number;
    score_delta: number;
  };
}

export default function NarrativeScoreCard({ campaign }: Props) {
  const score  = campaign.narrative_score_current ?? 0;
  const target = campaign.narrative_score_target  ?? 0.6;
  const delta  = campaign.score_delta ?? 0;

  const pct   = ((score + 1) / 2) * 100;
  const tPct  = ((target + 1) / 2) * 100;
  const color = score >= 0.3 ? '#22c55e' : score >= 0 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontSize:12, color:'#94a3b8', fontWeight:500 }}>NARRATIVE SCORE</div>
          <div style={{ fontSize:40, fontWeight:700, color, marginTop:4 }}>{score.toFixed(3)}</div>
        </div>
        <span className={`badge ${campaign.status === 'active' ? 'badge-green' : 'badge-amber'}`} style={{ marginTop:4 }}>
          {campaign.status}
        </span>
      </div>

      {/* Gauge bar */}
      <div>
        <div style={{ height:8, background:'#334155', borderRadius:4, position:'relative', overflow:'visible' }}>
          <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:4, transition:'width .6s' }} />
          {/* Target marker */}
          <div style={{ position:'absolute', top:-4, left:`${tPct}%`, width:2, height:16, background:'#6366f1', borderRadius:1, transform:'translateX(-50%)' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:11, color:'#475569' }}>
          <span>−1.0 negative</span>
          <span>target: {target.toFixed(2)}</span>
          <span>+1.0 positive</span>
        </div>
      </div>

      <div style={{ display:'flex', gap:16, paddingTop:8, borderTop:'1px solid #334155' }}>
        <div>
          <div style={{ fontSize:11, color:'#64748b' }}>30d change</div>
          <div style={{ fontSize:16, fontWeight:600, color: delta >= 0 ? '#22c55e' : '#ef4444' }}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
          </div>
        </div>
        <div>
          <div style={{ fontSize:11, color:'#64748b' }}>Gap to target</div>
          <div style={{ fontSize:16, fontWeight:600, color:'#94a3b8' }}>
            {(target - score).toFixed(3)}
          </div>
        </div>
        <div>
          <div style={{ fontSize:11, color:'#64748b' }}>Since</div>
          <div style={{ fontSize:14, fontWeight:500, color:'#94a3b8' }}>
            {campaign.start_date}
          </div>
        </div>
      </div>
    </div>
  );
}
