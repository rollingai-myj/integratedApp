/**
 * 简单 SVG 折线图 — 两条线(added / removed)。
 *
 * 数据少(30 天内)、需求轻,不引图表库;手绘 path + 轴标。
 * 视觉风格:暖白底 + 美宜佳红(added) + 灰(removed)+ 浅色网格。
 */
import * as React from 'react';
import { TOKENS } from '@/tokens';

interface Point {
  date: string;
  added: number;
  removed: number;
}

export function LineChart({
  data,
  height = 240,
}: {
  data: Point[];
  height?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(600);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const paddingL = 36, paddingR = 12, paddingT = 12, paddingB = 28;
  const W = Math.max(width, 300);
  const H = height;
  const plotW = W - paddingL - paddingR;
  const plotH = H - paddingT - paddingB;

  if (data.length === 0) {
    return <div ref={containerRef} style={emptyStyle(height)}>暂无数据</div>;
  }

  const maxV = Math.max(1, ...data.flatMap(d => [d.added, d.removed]));
  // 把 maxV 上取整到"友好"刻度:5 / 10 / 20 / 50 / 100 ...
  const step = niceStep(maxV);
  const yMax = Math.ceil(maxV / step) * step;
  const gridLines = Math.min(5, Math.ceil(yMax / step));

  const xPos = (i: number) =>
    paddingL + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const yPos = (v: number) => paddingT + plotH - (v / yMax) * plotH;

  const pathOf = (key: 'added' | 'removed') =>
    data
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(d[key]).toFixed(1)}`)
      .join(' ');

  // 折线下方半透明填充(美化)
  const areaOf = (key: 'added' | 'removed') => {
    const top = pathOf(key);
    const baseY = paddingT + plotH;
    return `${top} L ${xPos(data.length - 1).toFixed(1)} ${baseY} L ${xPos(0).toFixed(1)} ${baseY} Z`;
  };

  // X 轴刻度:5 等分
  const xTickStep = Math.max(1, Math.floor(data.length / 5));
  const xTicks = data
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => i % xTickStep === 0 || i === data.length - 1);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Y 轴网格 */}
        {Array.from({ length: gridLines + 1 }, (_, i) => {
          const v = (yMax / gridLines) * i;
          const y = yPos(v);
          return (
            <g key={i}>
              <line x1={paddingL} y1={y} x2={W - paddingR} y2={y}
                    stroke={TOKENS.lineSoft} strokeWidth={1} />
              <text x={paddingL - 6} y={y + 3} textAnchor="end"
                    fontSize={11} fill={TOKENS.inkMuted}>
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        {/* X 轴刻度 */}
        {xTicks.map(({ i, d }) => (
          <text key={i} x={xPos(i)} y={paddingT + plotH + 18}
                textAnchor="middle" fontSize={11} fill={TOKENS.inkMuted}>
            {formatMD(d.date)}
          </text>
        ))}
        {/* removed 折线(灰)+ 区域 */}
        <path d={areaOf('removed')} fill={`${TOKENS.inkMuted}10`} />
        <path d={pathOf('removed')} fill="none"
              stroke={TOKENS.inkMuted} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />
        {/* added 折线(红)+ 区域 */}
        <path d={areaOf('added')} fill={`${TOKENS.red}18`} />
        <path d={pathOf('added')} fill="none"
              stroke={TOKENS.red} strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {/* 图例 */}
      <div style={{
        display: 'flex', gap: 16, marginTop: 8, paddingLeft: paddingL,
        fontSize: TOKENS.fXs, color: TOKENS.inkSoft,
      }}>
        <Legend dot={TOKENS.red} label="上架" />
        <Legend dot={TOKENS.inkMuted} label="下架" />
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 5, background: dot,
        display: 'inline-block',
      }} />
      {label}
    </span>
  );
}

function emptyStyle(h: number): React.CSSProperties {
  return {
    height: h,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: TOKENS.inkMuted,
    fontSize: TOKENS.fSm,
  };
}

function niceStep(maxV: number): number {
  if (maxV <= 5) return 1;
  if (maxV <= 20) return 5;
  if (maxV <= 50) return 10;
  if (maxV <= 100) return 20;
  if (maxV <= 500) return 100;
  if (maxV <= 1000) return 200;
  return Math.pow(10, Math.floor(Math.log10(maxV)));
}

function formatMD(iso: string): string {
  // 'YYYY-MM-DD' -> 'M/D'
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}
