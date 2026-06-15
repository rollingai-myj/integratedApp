/**
 * 虚拟陈列图渲染入口（main 上 v2/VirtualShelfRenderer 的等价物）。
 * 把 Dify 工作流原始 outputs + 货架配置 → 解析成 VirtualShelfGroup → 用 VirtualShelfView 渲染。
 */
import { useMemo } from 'react';
import { parseDifyOutput, type SkuDimLite } from './parseDifyOutput';
import { VirtualShelfView } from './VirtualShelfView';

interface Ctx {
  /** 每个 shelf_id 的宽度（cm），按数组索引对应 shelf_id-1 */
  shelfWidths?: number[];
  /** 应用调改"上架"的 SKU codes（用于点亮新品） */
  newListedCodes?: string[];
  /** 烘焙类用 长 (length) 作为视觉高度 */
  useLengthAsHeight?: boolean;
}

interface Props {
  rawOutputs: unknown;
  context: Ctx | null | undefined;
  /** 可选：提供 SKU 维度，让真实高度回填到 block.heightCm */
  skus?: SkuDimLite[];
}

export function VirtualShelfRenderer({ rawOutputs, context, skus = [] }: Props) {
  const ctx = context ?? {};
  const shelfWidths = ctx.shelfWidths && ctx.shelfWidths.length ? ctx.shelfWidths : [120];
  const layout = useMemo(() => {
    if (!rawOutputs || typeof rawOutputs !== 'object') return [];
    try {
      return parseDifyOutput(
        rawOutputs as Record<string, unknown>,
        shelfWidths,
        new Set(ctx.newListedCodes ?? []),
        !!ctx.useLengthAsHeight,
        skus,
      );
    } catch {
      return [];
    }
  }, [rawOutputs, shelfWidths, ctx.newListedCodes, ctx.useLengthAsHeight, skus]);

  if (!layout.length) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 13 }}>
        暂无可渲染的货架布局
      </div>
    );
  }
  return <VirtualShelfView layout={layout} shelfWidthCm={shelfWidths[0]} />;
}
