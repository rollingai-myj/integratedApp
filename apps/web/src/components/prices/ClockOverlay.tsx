import { useEffect } from 'react';

interface Props {
  direction: 'forward' | 'reverse';
  durationMs?: number;
  onDone: () => void;
}

/** 全屏中央时钟动效：指针走一圈（快进顺时针 / 重置逆时针） */
export function ClockOverlay({ direction, durationMs = 750, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDone]);

  const fromTo = direction === 'forward' ? '0deg, 360deg' : '0deg, -360deg';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(20, 14, 10, 0.28)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="relative flex h-24 w-24 items-center justify-center rounded-full"
        style={{
          background: 'white',
          boxShadow: 'var(--shadow-brand)',
          border: '3px solid var(--brand)',
          animation: 'clk-pop 200ms ease-out',
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="absolute left-1/2 top-1.5 h-1.5 w-[2px] -translate-x-1/2 rounded-full"
            style={{
              background: i % 3 === 0 ? 'var(--brand)' : 'color-mix(in oklab, var(--ink) 30%, transparent)',
              transformOrigin: '50% 42px',
              transform: `translateX(-50%) rotate(${i * 30}deg)`,
            }}
          />
        ))}
        <span
          className="absolute left-1/2 top-1/2 origin-bottom rounded-full"
          style={{
            width: 3,
            height: 32,
            background: 'var(--brand)',
            transform: 'translate(-50%, -100%)',
            animation: `clk-spin ${durationMs}ms cubic-bezier(0.4, 0.0, 0.2, 1) forwards`,
          }}
        />
        <span
          className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'var(--brand)' }}
        />
      </div>
      <style>{`
        @keyframes clk-spin {
          from { transform: translate(-50%, -100%) rotate(${fromTo.split(',')[0]!}); }
          to   { transform: translate(-50%, -100%) rotate(${fromTo.split(',')[1]!.trim()}); }
        }
        @keyframes clk-pop {
          from { transform: scale(0.7); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
