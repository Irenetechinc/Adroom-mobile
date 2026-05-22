import { useEffect } from 'react';

const SHIMMER_ID = '__apma_shimmer__';

function injectShimmer() {
  if (document.getElementById(SHIMMER_ID)) return;
  const s = document.createElement('style');
  s.id = SHIMMER_ID;
  s.textContent = `
    @keyframes apma-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(s);
}

interface SkeletonProps {
  width?: string | number;
  height?: number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 14, borderRadius = 4, style }: SkeletonProps) {
  useEffect(() => { injectShimmer(); }, []);
  return (
    <div style={{
      width, height, borderRadius,
      background: 'linear-gradient(90deg, #1a2540 25%, #263348 50%, #1a2540 75%)',
      backgroundSize: '200% 100%',
      animation: 'apma-shimmer 1.6s ease-in-out infinite',
      flexShrink: 0,
      ...style,
    }} />
  );
}

export function SkeletonCard({ lines = 3, gap = 10 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ background: '#131c2e', borderRadius: 12, padding: 16, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap }}>
      <Skeleton width="55%" height={15} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '75%' : '100%'} height={12} />
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: '#131c2e', borderRadius: 8, padding: '14px 16px', border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton width={48} height={30} borderRadius={6} />
          <Skeleton width="65%" height={10} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={c === 0 ? '80%' : '60%'} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
