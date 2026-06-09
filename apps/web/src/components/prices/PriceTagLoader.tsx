import { useEffect, useState } from 'react';

/** 跳动价签 loader：红色价签 + 预设数字滚动 + 上下浮动 */
const FRAMES: Array<[number, number, number]> = [
  [3, 1, 4], [5, 9, 2], [6, 5, 3], [8, 9, 7], [9, 3, 2],
  [4, 6, 2], [7, 1, 8], [2, 8, 1], [1, 4, 1], [5, 7, 7],
  [3, 6, 0], [2, 7, 1], [8, 2, 8], [4, 5, 9], [9, 0, 4],
];

export function PriceTagLoader() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);

  const [d1, d2, d3] = FRAMES[i]!;

  return (
    <div className="relative inline-flex" style={{ animation: 'pt-float 1.2s ease-in-out infinite' }}>
      <span
        className="absolute left-1/2 -top-3 h-3 w-[2px] -translate-x-1/2"
        style={{ background: 'color-mix(in oklab, var(--ink) 30%, transparent)' }}
      />
      <div
        className="relative flex items-center justify-center px-4 py-3 text-brand-foreground"
        style={{
          background: 'linear-gradient(135deg, var(--brand), #8a1224)',
          borderRadius: '14px',
          boxShadow: 'var(--shadow-brand)',
          minWidth: 96,
        }}
      >
        <span
          className="absolute left-1/2 top-1.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        />
        <span className="num text-[22px] font-bold leading-none tracking-tight tabular-nums">
          ¥{d1}.{d2}{d3}
        </span>
      </div>
      <style>{`
        @keyframes pt-float {
          0%, 100% { transform: translateY(-3px); }
          50% { transform: translateY(3px); }
        }
      `}</style>
    </div>
  );
}
