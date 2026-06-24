/**
 * 调改记录(表格)占位 — PR 3 会接真实接口 + 筛选 + 分页 + 导出
 */
import { createFileRoute } from '@tanstack/react-router';
import { TOKENS } from '@/tokens';

export const Route = createFileRoute('/_app/changes')({
  component: ChangesPlaceholder,
});

function ChangesPlaceholder() {
  return (
    <div>
      <h1 style={{ fontSize: TOKENS.f2xl, fontWeight: 700, color: TOKENS.ink, margin: '0 0 6px' }}>
        调改记录
      </h1>
      <div style={{ fontSize: TOKENS.fSm, color: TOKENS.inkMuted, marginBottom: 24 }}>
        各门店 SKU 上架 / 下架的明细 — 支持筛选、排序、导出
      </div>

      <div style={{
        background: TOKENS.card,
        border: `1px solid ${TOKENS.line}`,
        borderRadius: TOKENS.r5,
        padding: '60px 32px',
        boxShadow: TOKENS.shadow1,
        textAlign: 'center',
        color: TOKENS.inkMuted,
      }}>
        表格筛选 + 行展开 + CSV 导出 — 下个 PR 接 <code>store_assortment_changes</code> 表
      </div>
    </div>
  );
}
