import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

interface Props {
  data: Array<{ date: string; score: number }>;
}

export default function SentimentChart({ data }: Props) {
  if (!data.length) return <p style={{ color:'#475569', padding:'24px 0', textAlign:'center' }}>No trend data yet</p>;

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-GB', { day:'numeric', month:'short' }),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={formatted} margin={{ top:4, right:8, bottom:0, left:-20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#263348" />
        <XAxis dataKey="label" tick={{ fill:'#475569', fontSize:11 }} interval="preserveStartEnd" />
        <YAxis domain={[-1, 1]} tick={{ fill:'#475569', fontSize:11 }} />
        <Tooltip
          contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:8, fontSize:12 }}
          labelStyle={{ color:'#94a3b8' }}
          itemStyle={{ color:'#818cf8' }}
          formatter={(v: number) => [v.toFixed(4), 'Sentiment']}
        />
        <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
        <ReferenceLine y={0.6} stroke="#6366f1" strokeDasharray="2 4" label={{ value:'target', fill:'#6366f1', fontSize:10, position:'right' }} />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#818cf8"
          strokeWidth={2}
          dot={false}
          activeDot={{ r:4, fill:'#6366f1' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
