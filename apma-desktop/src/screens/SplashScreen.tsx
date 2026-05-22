import { useEffect, useState } from 'react';

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setOpacity(0), 1800);
    const doneTimer = setTimeout(onDone, 2200);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(135deg, #060d1a 0%, #0a1628 50%, #0d1f3c 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      opacity, transition: 'opacity 0.4s ease', zIndex: 9999, userSelect: 'none',
    }}>
      <style>{`
        @keyframes apma-pulse {
          0%, 100% { transform: scale(0.55); opacity: 0.2; }
          50% { transform: scale(1); opacity: 1; }
        }
        @keyframes apma-logo-in {
          from { opacity: 0; transform: scale(0.85) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes apma-ring {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{ textAlign: 'center', animation: 'apma-logo-in 0.6s ease forwards' }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 24 }}>
          <div style={{
            width: 90, height: 90, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(99,102,241,.15) 0%, rgba(56,189,248,.08) 100%)',
            border: '1px solid rgba(99,102,241,.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(99,102,241,.2)',
          }}>
            <span style={{ fontSize: 40 }}>🎯</span>
          </div>
          <div style={{
            position: 'absolute', inset: -8,
            border: '2px solid transparent',
            borderTopColor: '#6366f1',
            borderRadius: '50%',
            animation: 'apma-ring 1.5s linear infinite',
          }} />
        </div>

        <div style={{ fontSize: 46, fontWeight: 900, color: '#F1F5F9', letterSpacing: '-0.02em', marginBottom: 4 }}>
          APMA
        </div>
        <div style={{ fontSize: 11, color: '#6366F1', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6 }}>
          Autonomous Political Marketing Agent
        </div>
        <div style={{ fontSize: 11, color: '#334155', fontWeight: 500, marginBottom: 48 }}>
          from <span style={{ color: '#475569' }}>AdRoom AI</span>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: '50%', background: '#6366F1',
              animation: `apma-pulse 1.2s ease-in-out ${i * 0.22}s infinite`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
