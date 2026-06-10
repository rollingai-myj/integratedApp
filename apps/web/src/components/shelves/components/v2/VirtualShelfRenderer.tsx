import { useMemo } from "react";
import { parseDifyOutput } from "@/components/shelves/services/difyVirtualShelfApi";
import { VirtualShelfView } from "@/components/shelves/components/shelf-detail/VirtualShelfView";
import type { SkuRow } from "@/components/shelves/data/skuData";

interface Ctx {
  shelfWidths?: number[];
  newListedCodes?: string[];
  useLengthAsHeight?: boolean;
  category?: string;
}

interface Props {
  rawOutputs: unknown;
  context: Ctx | null | undefined;
  skus?: SkuRow[];
}

/** 把 Dify 原始 outputs + context 解析并渲染成虚拟货架 */
export const VirtualShelfRenderer = ({ rawOutputs, context, skus = [] }: Props) => {
  const ctx = context ?? {};
  const shelfWidths = ctx.shelfWidths && ctx.shelfWidths.length ? ctx.shelfWidths : [120];
  const layout = useMemo(() => {
    if (!rawOutputs || typeof rawOutputs !== "object") return [];
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
    return <div className="text-sm text-muted-foreground py-8 text-center">暂无可渲染的货架布局</div>;
  }
  return <VirtualShelfView layout={layout} shelfWidthCm={shelfWidths[0]} />;
};
