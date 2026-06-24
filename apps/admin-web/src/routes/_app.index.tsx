/**
 * Dashboard 占位 — PR 2 会接真实数据
 */
import type { CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { TOKENS } from '@/tokens';

export const Route = createFileRoute('/_app/')({
  component: DashboardPlaceholder,
});

function DashboardPlaceholder() {
  return (
    <div>
      <h1 style={{ fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px' }}>
        仪表盘
      </h1>
      <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted, marginBottom: 24 }}>
        门店调改、海报生成、价格变更 — 一眼概览
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}>
        {[
          { label: '活跃门店', value: '—', sub: '近 7 天有调改' },
          { label: '调改 SKU', value: '—', sub: '近 30 天' },
          { label: '海报生成', value: '—', sub: '近 30 天' },
          { label: '价格调整', value: '—', sub: '近 30 天' },
        ].map(card => (
          <div key={card.label} style={kpiCardStyle}>
            <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted }}>{card.label}</div>
            <div style={{
              fontSize: TOKENS.f3xl, fontWeight: 800, color: TOKENS.ink,
              margin: '8px 0 4px',
            }}>
              {card.value}
            </div>
            <div style={{ fontSize: TOKENS.fXs, color: TOKENS.inkMuted }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <PlaceholderCard title="调改趋势 / Top 5 门店 / 场景占比 / 在线大屏" />
    </div>
  );
}

const kpiCardStyle: CSSProperties = {
  background: TOKENS.card,
  border: `1px solid ${TOKENS.line}`,
  borderRadius: TOKENS.r5,
  padding: '18px 20px',
  boxShadow: TOKENS.shadow1,
};

function PlaceholderCard({ title }: { title: string }) {
  return (
    <div style={{
      background: TOKENS.card,
      border: `1px solid ${TOKENS.line}`,
      borderRadius: TOKENS.r5,
      padding: '32px',
      boxShadow: TOKENS.shadow1,
      textAlign: 'center',
      color: TOKENS.inkMuted,
      fontSize: TOKENS.fSm,
    }}>
      <div style={{ fontSize: TOKENS.fBase, color: TOKENS.inkSoft, marginBottom: 6 }}>{title}</div>
      <div>下个 PR 接真实数据</div>
    </div>
  );
}
