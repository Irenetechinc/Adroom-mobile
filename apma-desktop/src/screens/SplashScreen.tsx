import { useEffect, useRef, useState } from 'react';

const CSS = `
  @keyframes apma-logo-in {
    from { opacity: 0; transform: scale(0.88) translateY(14px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }
  @keyframes apma-halo {
    0%, 100% { opacity: 0.48; transform: scale(0.94); }
    50%      { opacity: 0.9;  transform: scale(1.06); }
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
        <div style={{
          position: 'relative',
          width: 132,
          height: 132,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,.32) 0%, rgba(56,189,248,.12) 42%, transparent 72%)',
            filter: 'blur(8px)',
            animation: 'apma-halo 2.4s ease-in-out infinite',
          }} />
          <div style={{
            position: 'relative',
            width: 94,
            height: 94,
            borderRadius: 28,
            background: 'linear-gradient(145deg, rgba(99,102,241,.16), rgba(56,189,248,.07))',
            boxShadow: '0 18px 56px rgba(56,189,248,.14), 0 10px 34px rgba(99,102,241,.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="apma-mark-gradient" x1="10" y1="10" x2="55" y2="55" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#22D3EE" />
                  <stop offset="1" stopColor="#D946EF" />
                </linearGradient>
              </defs>
              <g stroke="url(#apma-mark-gradient)" strokeWidth="3.5" strokeLinecap="round">
                <path d="M32 10 18 29M32 10l14 19M18 29 9 53M18 29l37 24M46 29 9 53M46 29l9 24" />
              </g>
              <g fill="url(#apma-mark-gradient)">
                <circle cx="32" cy="10" r="5" />
                <circle cx="18" cy="29" r="5" />
                <circle cx="46" cy="29" r="5" />
                <circle cx="9" cy="53" r="5" />
                <circle cx="55" cy="53" r="5" />
              </g>
            </svg>
          </div>
        </div>

        <div style={{ fontSize: 48, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.02em', marginBottom: 4, lineHeight: 1 }}>
          APMA
        </div>
        <div style={{ fontSize: 10.5, color: '#6366f1', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 6 }}>
          Autonomous Political Marketing Agent
        </div>
        <div style={{ fontSize: 11, color: '#334155', fontWeight: 500, marginBottom: 52 }}>
          from <span style={{ color: '#475569' }}>Adirum AI</span>
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
