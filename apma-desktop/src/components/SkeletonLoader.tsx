import React from 'react';

const SHIMMER_CSS = `
  @keyframes apma-shimmer {
    0%   { background-position: 200% center; }
    100% { background-position: -200% center; }
  }
`;

let shimmerInjected = false;
function ensureShimmer() {
  if (shimmerInjected || typeof document === 'undefined') return;
  if (document.getElementById('__apma_shimmer__')) { shimmerInjected = true; return; }
  const s = document.createElement('style');
  s.id = '__apma_shimmer__';
  s.textContent = SHIMMER_CSS;
  document.head.appendChild(s);
  shimmerInjected = true;
}

ensureShimmer();

interface SkeletonProps {
  width?: string | number;
  height?: number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 14, borderRadius = 4, style }: SkeletonProps) {
  return (
    <div style={{
      width,
      height,
      borderRadius,
      background: 'linear-gradient(90deg, #131c2e 0%, #1e2d45 40%, #263348 50%, #1e2d45 60%, #131c2e 100%)',
      backgroundSize: '300% 100%',
      animation: 'apma-shimmer 1.8s ease-in-out infinite',
      flexShrink: 0,
      ...style,
    }} />
  );
}

export function SkeletonCard({ lines = 3, gap = 10 }: { lines?: number; gap?: number }) {
  return (
    <div style={{
      background: '#131c2e', borderRadius: 12, padding: 18,
      border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap,
    }}>
      <Skeleton width="55%" height={15} borderRadius={5} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '72%' : '100%'} height={12} />
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          background: '#131c2e', borderRadius: 8, padding: '14px 16px',
          border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <Skeleton width={44} height={28} borderRadius={6} />
          <Skeleton width="60%" height={10} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 10, padding: '11px 0',
          borderBottom: '1px solid #1e293b',
        }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={c === 0 ? '80%' : '55%'} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
