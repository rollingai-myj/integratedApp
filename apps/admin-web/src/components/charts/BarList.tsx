/**
 * Top N 排行 — 简单的横向条形图(纯 div + width %)。
 *
 * 用来渲染 Top 5 活跃门店,左边店名/编号、中间条、右边数值。
 */
import { TOKENS } from '@/tokens';

export interface BarItem {
  /** 唯一 id,用作 key */
  id: string;
  /** 主标题(店名) */
  label: string;
  /** 副标题(店编号,可选) */
  sub?: string;
  value: number;
}

export function BarList({ items }: { items: BarItem[] }) {
  if (items.length === 0) {
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
  const max = Math.max(1, ...items.map(it => it.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it, i) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 18, fontSize: TOKENS.fXs, color: TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums',
            textAlign: 'right', flexShrink: 0,
          }}>
            {i + 1}.
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: TOKENS.fSm, color: TOKENS.ink, marginBottom: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {it.label}
            </div>
            <div style={{
              position: 'relative',
              height: 8,
              background: TOKENS.bgWarm,
              borderRadius: 4,
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                inset: 0,
                width: `${(it.value / max) * 100}%`,
                background: `linear-gradient(90deg, ${TOKENS.red}, ${TOKENS.redDark})`,
                borderRadius: 4,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
          <div style={{
            width: 60, fontSize: TOKENS.fSm, fontWeight: 700, color: TOKENS.ink,
            fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0,
          }}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}
