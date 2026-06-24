/**
 * 环形图 — 用于「场景占比」。
 *
 * SVG arc 手画;左边圆环,右边图例 + 数值。
 */
import { TOKENS } from '@/tokens';

export interface DonutSlice {
  /** 唯一 id */
  id: string | number;
  label: string;
  value: number;
}

const PALETTE = [
  TOKENS.red,
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  TOKENS.inkSoft,
];

export function DonutChart({ slices, size = 180 }: { slices: DonutSlice[]; size?: number }) {
  if (slices.length === 0) {
    return (
      <div style={{
        padding: '40px 0',
        textAlign: 'center',
        color: TOKENS.inkMuted,
        fontSize: TOKENS.fSm,
      }}>
        暂无数据
      </div>
    );
  }
  const total = slices.reduce((s, x) => s + x.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const innerR = r * 0.62;

  let acc = 0;
  const arcs = slices.map((sl, i) => {
    const startA = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += sl.value;
    const endA = (acc / total) * Math.PI * 2 - Math.PI / 2;
    return {
      slice: sl,
      color: PALETTE[i % PALETTE.length]!,
      d: donutPath(cx, cy, r, innerR, startA, endA),
    };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} />
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle"
              fontSize={11} fill={TOKENS.inkMuted}>
          合计
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle"
              fontSize={20} fontWeight={800} fill={TOKENS.ink}>
          {total}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {arcs.map((a) => (
          <div key={a.slice.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: TOKENS.fSm,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: 3, background: a.color, flexShrink: 0,
            }} />
            <span style={{
              flex: 1, minWidth: 0, color: TOKENS.ink,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {a.slice.label}
            </span>
            <span style={{
              color: TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums', fontSize: TOKENS.fXs,
            }}>
              {a.slice.value} · {percent(a.slice.value, total)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function donutPath(cx: number, cy: number, ro: number, ri: number,
                   start: number, end: number): string {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const ox1 = cx + ro * Math.cos(start), oy1 = cy + ro * Math.sin(start);
  const ox2 = cx + ro * Math.cos(end),   oy2 = cy + ro * Math.sin(end);
  const ix1 = cx + ri * Math.cos(end),   iy1 = cy + ri * Math.sin(end);
  const ix2 = cx + ri * Math.cos(start), iy2 = cy + ri * Math.sin(start);
  return [
    `M ${ox1} ${oy1}`,
    `A ${ro} ${ro} 0 ${largeArc} 1 ${ox2} ${oy2}`,
    `L ${ix1} ${iy1}`,
    `A ${ri} ${ri} 0 ${largeArc} 0 ${ix2} ${iy2}`,
    'Z',
  ].join(' ');
}

function percent(v: number, total: number): string {
  if (total === 0) return '0';
  const p = (v / total) * 100;
  return p < 1 ? '<1' : p.toFixed(0);
}
