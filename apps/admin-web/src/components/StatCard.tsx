/**
 * KPI 卡片 — 大数字 + 标签 + 环比箭头。
 */
import { TOKENS } from '@/tokens';
import type { KpiBlock } from '@/lib/dashboard';

export function StatCard({
  label,
  sub,
  block,
  loading,
}: {
  label: string;
  sub: string;
  block?: KpiBlock;
  loading?: boolean;
}) {
  return (
    <div style={{
      background: TOKENS.card,
      border: `1px solid ${TOKENS.line}`,
      borderRadius: TOKENS.r5,
      padding: '18px 20px',
      boxShadow: TOKENS.shadow1,
    }}>
      <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted }}>{label}</div>
      <div style={{
        fontSize: TOKENS.f3xl, fontWeight: 800, color: TOKENS.ink,
        margin: '8px 0 4px',
        fontVariantNumeric: 'tabular-nums',
        minHeight: TOKENS.f3xl + 4,
      }}>
        {loading ? <Skeleton width={80} height={28} /> : (block?.value ?? '—').toLocaleString()}
      </div>
      <div style={{
        fontSize: TOKENS.fXs, color: TOKENS.inkMuted,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>{sub}</span>
        {!loading && block && <DeltaChip delta={block.delta} prev={block.prevValue} />}
      </div>
    </div>
  );
}

function DeltaChip({ delta, prev }: { delta: number; prev: number }) {
  if (delta === 0 && prev === 0) return null;
  const positive = delta > 0;
  const neutral = delta === 0;
  const color = neutral ? TOKENS.inkMuted : positive ? TOKENS.success : TOKENS.danger;
  const arrow = neutral ? '—' : positive ? '▲' : '▼';
  // 用上一窗口做分母,prev=0 时不算百分比(只展示绝对值)
  const pct = prev === 0 ? null : Math.round((delta / prev) * 100);
  return (
    <span style={{
      color,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <span style={{ fontSize: 10 }}>{arrow}</span>
      {pct === null ? Math.abs(delta) : `${Math.abs(pct)}%`}
    </span>
  );
}

function Skeleton({ width, height }: { width: number; height: number }) {
  return (
    <span style={{
      display: 'inline-block',
      width, height,
      background: `linear-gradient(110deg, ${TOKENS.bgWarm} 30%, #efe9df 50%, ${TOKENS.bgWarm} 70%)`,
      backgroundSize: '200% 100%',
      borderRadius: 6,
      animation: 'sc-shimmer 1.4s linear infinite',
    }} />
  );
}
