import { useEffect, useRef, useState } from 'react';

const CSS = `
  @keyframes apma-logo-in {
    from { opacity: 0; transform: scale(0.88) translateY(14px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }
  @keyframes apma-ring {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes apma-dot {
    0%, 100% { transform: scale(0.5); opacity: 0.18; }
    50%       { transform: scale(1);   opacity: 1;    }
  }
  @keyframes apma-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  const existing = document.getElementById('__apma_splash_css__');
  if (existing) { cssInjected = true; return; }
  const s = document.createElement('style');
  s.id = '__apma_splash_css__';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}
injectCSS();

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    injectCSS();
    const fade = setTimeout(() => setVisible(false), 1900);
    const done = setTimeout(() => onDoneRef.current(), 2350);
    return () => { clearTimeout(fade); clearTimeout(done); };
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: 0, right: 0, bottom: 0, left: 0,
      background: 'linear-gradient(160deg, #060d1a 0%, #0a1628 55%, #0b1a2f 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.45s ease',
      userSelect: 'none',
      animation: 'apma-fade-in 0.25s ease forwards',
    }}>

      <div style={{
        textAlign: 'center',
        animation: 'apma-logo-in 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards',
      }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 28 }}>
          <div style={{
            width: 88, height: 88, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, rgba(99,102,241,.18) 0%, rgba(56,189,248,.06) 100%)',
            border: '1px solid rgba(99,102,241,.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 48px rgba(99,102,241,.18), 0 0 80px rgba(99,102,241,.08)',
          }}>
            <span style={{ fontSize: 38, lineHeight: 1 }}>🎯</span>
          </div>

          <div style={{
            position: 'absolute',
            top: -10, right: -10, bottom: -10, left: -10,
            border: '2px solid transparent',
            borderTopColor: '#6366f1',
            borderRightColor: 'rgba(99,102,241,.3)',
            borderRadius: '50%',
            animation: 'apma-ring 1.4s linear infinite',
          }} />
          <div style={{
            position: 'absolute',
            top: -18, right: -18, bottom: -18, left: -18,
            border: '1px solid transparent',
            borderTopColor: 'rgba(56,189,248,.4)',
            borderRadius: '50%',
            animation: 'apma-ring 2.2s linear infinite reverse',
          }} />
        </div>

        <div style={{ fontSize: 48, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.02em', marginBottom: 4, lineHeight: 1 }}>
          APMA
        </div>
        <div style={{ fontSize: 10.5, color: '#6366f1', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 6 }}>
          Autonomous Political Marketing Agent
        </div>
        <div style={{ fontSize: 11, color: '#334155', fontWeight: 500, marginBottom: 52 }}>
          from <span style={{ color: '#475569' }}>AdRoom AI</span>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 7, height: 7, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              boxShadow: '0 0 8px rgba(99,102,241,.5)',
              animation: `apma-dot 1.3s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
