/**
 * Dify virtual-shelf 工作流输出解析（从 main 上 difyVirtualShelfApi.ts 抽出来）。
 * 接受 `outputs.sku_lct` (新格式：[{sub_category, skus:[...]}]) 或老的扁平格式，
 * 转成 VirtualShelfGroup[] 供 VirtualShelfView 渲染。
 */
import {
  VIRTUAL_SHELF_COLORS,
  type VirtualShelfBlock,
  type VirtualShelfGroup,
} from './types';

/** SKU 码统一补齐 8 位；非纯数字按原样返回；用在 Dify agent 输出回来后的边界处 */
export function padSkuCode(input: unknown): string {
  if (input === null || input === undefined) return '';
  let s = String(input).trim();
  if (!s) return '';
  s = s.replace(/\.0+$/, '');
  if (s.length >= 8) return s;
  if (!/^\d+$/.test(s)) return s;
  return s.padStart(8, '0');
}

/** SKU 官方图：阿里云 OSS 直链；找不到时 VirtualShelfView 会用色块兜底 */
const STORAGE_BASE = 'https://rollingai-meiyijia.oss-cn-shanghai.aliyuncs.com';
export function getSkuImageUrl(skuCode: string | undefined): string | null {
  if (!skuCode) return null;
  const padded = /^\d+$/.test(skuCode) && skuCode.length < 8
    ? skuCode.padStart(8, '0')
    : skuCode;
  return `${STORAGE_BASE}/product_pic/${padded}.png`;
}

/** parseDifyOutput 用得到的 SKU 维度数据（仅 sku_code/depth/height） */
export interface SkuDimLite {
  skuCode: string;
  depth?: number | null;
  height?: number | null;
}

interface DifySkuBlock {
  sku_name: string;
  sku_code?: string;
  shelf_id: number;
  layer: number;
  start_x: number;
  end_x: number;
  width_cm: number;
  height_cm?: number;
  facing: number;
  upfacing?: number;
  reason?: string;
  promo?: string;
  promoset?: string;
}

interface DifySubCategoryOutput {
  sub_category: string;
  reason?: string;
  skus: DifySkuBlock[];
}

export function parseDifyOutput(
  outputData: Record<string, unknown>,
  shelfWidths: number[],
  newListedCodes: Set<string> = new Set(),
  useLengthAsHeight = false,
  skus: SkuDimLite[] = [],
): VirtualShelfGroup[] {
  let rawArray: unknown[] = [];
  const reasonLayerMap = new Map<number, string>();

  const extractArray = (obj: unknown): unknown[] | null => {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      if (Array.isArray(o.sku_lct)) return o.sku_lct;
      if (Array.isArray(o.placed)) return o.placed as unknown[];
    }
    return null;
  };

  const extractReasonLayer = (obj: unknown): Array<{ layer: number; reason: string }> | null => {
    if (obj && typeof obj === 'object' && Array.isArray((obj as { reason_layer?: unknown }).reason_layer)) {
      return (obj as { reason_layer: Array<{ layer: number; reason: string }> }).reason_layer;
    }
    return null;
  };

  const tryConsume = (val: unknown): boolean => {
    const arr = extractArray(val);
    if (arr) {
      rawArray = arr;
      const rl = extractReasonLayer(val);
      if (rl) for (const r of rl) reasonLayerMap.set(r.layer, r.reason);
      return true;
    }
    return false;
  };

  for (const val of Object.values(outputData)) {
    if (tryConsume(val)) break;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (tryConsume(parsed)) break;
      } catch { /* continue */ }
    }
  }

  if (reasonLayerMap.size === 0) {
    const topRl = extractReasonLayer(outputData);
    if (topRl) for (const r of topRl) reasonLayerMap.set(r.layer, r.reason);
  }

  if (!rawArray || rawArray.length === 0) {
    throw new Error('Dify 返回数据中未找到布局信息');
  }

  const isNewFormat = rawArray.length > 0 &&
    typeof rawArray[0] === 'object' &&
    rawArray[0] !== null &&
    'skus' in (rawArray[0] as Record<string, unknown>) &&
    Array.isArray((rawArray[0] as { skus?: unknown }).skus);

  interface UnifiedBlock {
    sub_category: string;
    sku_name?: string;
    sku_code?: string;
    shelf_id: number;
    layer: number;
    start_x: number;
    end_x: number;
    width_cm: number;
    height_cm?: number;
    facing?: number;
    upfacing?: number;
    reason?: string;
    promo?: string;
    promoset?: string;
  }

  let unifiedBlocks: UnifiedBlock[];

  if (isNewFormat) {
    unifiedBlocks = [];
    for (const group of rawArray as DifySubCategoryOutput[]) {
      for (const sku of group.skus) {
        unifiedBlocks.push({
          sub_category: group.sub_category,
          sku_name: sku.sku_name,
          sku_code: padSkuCode(sku.sku_code),
          shelf_id: sku.shelf_id,
          layer: sku.layer,
          start_x: sku.start_x,
          end_x: sku.end_x,
          width_cm: sku.width_cm,
          height_cm: sku.height_cm,
          facing: sku.facing,
          upfacing: sku.upfacing,
          reason: sku.reason || group.reason || reasonLayerMap.get(sku.layer),
          promo: sku.promo,
          promoset: sku.promoset,
        });
      }
    }
  } else {
    unifiedBlocks = (rawArray as UnifiedBlock[]).map((b) => ({
      ...b,
      sku_code: padSkuCode(b.sku_code),
      reason: b.reason || reasonLayerMap.get(b.layer),
    }));
  }

  const getShelfWidth = (shelfId: number) => shelfWidths[shelfId - 1] || 75;

  const subcategories = [...new Set(unifiedBlocks.map((b) => b.sub_category))];
  const colorMap: Record<string, string> = {};
  subcategories.forEach((sc, i) => {
    colorMap[sc] = VIRTUAL_SHELF_COLORS[i % VIRTUAL_SHELF_COLORS.length];
  });

  const shelfMap = new Map<number, Map<number, UnifiedBlock[]>>();
  for (const item of unifiedBlocks) {
    if (!shelfMap.has(item.shelf_id)) shelfMap.set(item.shelf_id, new Map());
    const layerMap = shelfMap.get(item.shelf_id)!;
    if (!layerMap.has(item.layer)) layerMap.set(item.layer, []);
    layerMap.get(item.layer)!.push(item);
  }

  for (const layerMap of shelfMap.values()) {
    for (const blocks of layerMap.values()) {
      blocks.sort((a, b) => a.start_x - b.start_x);
    }
  }

  const skuDimMap = new Map(skus.map((s) => [s.skuCode, s]));
  const shelfIds = Array.from(shelfMap.keys()).sort((a, b) => a - b);
  const groups: VirtualShelfGroup[] = [];

  for (const shelfId of shelfIds) {
    const layerMap = shelfMap.get(shelfId)!;
    const layerNums = Array.from(layerMap.keys()).sort((a, b) => a - b);
    const maxLayer = Math.max(...layerNums);
    const shelfWidth = getShelfWidth(shelfId);

    const layers: VirtualShelfGroup['layers'] = [];

    for (let li = 1; li <= maxLayer; li++) {
      const rawBlocks = layerMap.get(li);
      if (!rawBlocks || rawBlocks.length === 0) {
        layers.push({ layerIndex: li, blocks: [] });
        continue;
      }

      const convertedBlocks: VirtualShelfBlock[] = rawBlocks.map((rb, bi) => {
        let heightCm = rb.height_cm || 15;
        if (rb.sku_code) {
          const sku = skuDimMap.get(rb.sku_code);
          if (sku) {
            const dimVal = useLengthAsHeight ? sku.height : sku.depth;
            if (dimVal && dimVal > 0) heightCm = dimVal;
          }
        }
        return {
          id: `vs-g${shelfId - 1}-l${li}-b${bi}`,
          subcategory: rb.sub_category,
          skuName: rb.sku_name || rb.sub_category,
          skuCode: rb.sku_code || '',
          facing: rb.facing || 1,
          upfacing: rb.upfacing,
          widthCm: rb.width_cm,
          heightCm,
          startRatio: Math.round((rb.start_x / shelfWidth) * 1000) / 1000,
          endRatio: Math.round((rb.end_x / shelfWidth) * 1000) / 1000,
          color: colorMap[rb.sub_category] || 'hsl(0, 0%, 60%)',
          layerIndex: li,
          groupIndex: shelfId - 1,
          reason: rb.reason,
          isNewListing: rb.sku_code ? newListedCodes.has(rb.sku_code) : false,
          promo: rb.promo,
          promoset: rb.promoset,
        };
      });

      layers.push({ layerIndex: li, blocks: convertedBlocks, reason: reasonLayerMap.get(li) });
    }

    groups.push({
      groupIndex: shelfId - 1,
      layers: layers.filter((l) => l.blocks.length > 0),
      shelfWidthCm: shelfWidth,
    });
  }

  return groups;
}
