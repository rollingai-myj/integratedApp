/**
 * Dify virtual shelf layout API service.
 * Calls the Dify workflow to generate shelf layout arrangement.
 */
import { type SkuRow } from "@/components/shelves/data/skuData";
import { type Strategy } from "@/components/shelves/contexts/AppContext";
import { type VirtualShelfBlock, type VirtualShelfGroup, VIRTUAL_SHELF_COLORS } from "@/components/shelves/types/virtualShelf";
import { isRemoveAction } from "@/components/shelves/lib/strategyAction";
import { padSkuCode } from "@/components/shelves/lib/skuCode";
import { difyProxyUrl } from "@/components/shelves/lib/difyProxyUrl";
import { getAuthHeaders, apiFetch } from "@/components/shelves/lib/api-client";
import { getDifyUser } from "@/components/shelves/lib/difyUser";
import { serializeDifyInputs } from "@/components/shelves/lib/difyInputs";

export interface DifyWorkflowResponse {
  workflow_run_id: string;
  task_id: string;
  data: {
    id: string;
    workflow_id: string;
    status: string;
    outputs: Record<string, unknown>;
    error?: string;
    elapsed_time: number;
    total_tokens: number;
    created_at: number;
    finished_at: number;
  };
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

/**
 * Build SKU JSON payload for the Dify workflow.
 * Produces nested structure grouped by 小类 (subcategory), enriched with dimension data.
 * Filters out delisted SKUs and includes newly listed SKUs from applied strategies.
 */
export function buildSkuJsonForDify(skus: SkuRow[], strategies: Strategy[]): string {
  const delistedCodes = new Set<string>();
  const newlyListedSkus: Array<{ skuCode: string; skuName: string }> = [];

  strategies.forEach(st => {
    if (st.applied) {
      st.skus.forEach(s => {
        if (isRemoveAction(s.action)) {
          delistedCodes.add(s.skuCode);
        } else if (s.action.includes("上架")) {
          newlyListedSkus.push({ skuCode: s.skuCode, skuName: s.skuName });
        }
      });
    }
  });

  if (delistedCodes.size > 0) {
    console.log("[VirtualShelf] Excluding delisted/stop-restock SKUs from payload:", Array.from(delistedCodes));
  }

  const skuMap = new Map(skus.map(s => [s.skuCode, s]));

  const activeCodes = new Set<string>();
  for (const s of skus) {
    if (!delistedCodes.has(s.skuCode)) activeCodes.add(s.skuCode);
  }
  for (const nl of newlyListedSkus) {
    activeCodes.add(nl.skuCode);
  }

  const result: Record<string, Record<string, Record<string, string>>> = {};

  for (const code of activeCodes) {
    const sku = skuMap.get(code);
    if (!sku) continue;

    const subCat = sku.subCategory || "未分类";
    if (!result[subCat]) result[subCat] = {};

    result[subCat][code] = {
      小类: sku.subCategory,
      大类: sku.majorCategory,
      中类: sku.midCategory || "",
      商品代码: sku.skuCode,
      高: sku.height != null ? String(sku.height) : "",
      宽: sku.width != null ? String(sku.width) : "",
      深: sku.depth != null ? String(sku.depth) : "",
      商品名称: (sku.skuName || "").replace(/^(NX|N)/, ""),
      品牌: sku.brandName,
      计量单位: sku.unit || "",
      "30日销售额": (parseFloat(sku.sales30d || "0") / 3).toFixed(4),
      "30日销量": String(Math.round(parseInt(sku.salesVolume30d || "0", 10) / 3)),
    };
  }

  return JSON.stringify(result);
}

/**
 * Filter promo groups to only include those whose SKU codes intersect with the
 * SKU codes present in skujson. This prevents passing irrelevant promos to the agent.
 */
export function filterPromoBySkus(skuJson: string, promoJson: string): string {
  try {
    const parsed = JSON.parse(skuJson);
    const promos = JSON.parse(promoJson) as Record<string, Record<string, string>>;

    const skuCodeSet = new Set<string>();
    if (Array.isArray(parsed)) {
      // Flat array format (new API)
      for (const item of parsed as Array<{ 商品代码?: string }>) {
        if (item.商品代码) skuCodeSet.add(item.商品代码);
      }
    } else {
      // Nested object format (legacy)
      for (const subCat of Object.values(parsed as Record<string, Record<string, unknown>>)) {
        for (const code of Object.keys(subCat)) skuCodeSet.add(code);
      }
    }

    const filtered: Record<string, Record<string, string>> = {};
    for (const [groupId, groupSkus] of Object.entries(promos)) {
      for (const skuCode of Object.keys(groupSkus)) {
        if (skuCodeSet.has(skuCode)) { filtered[groupId] = groupSkus; break; }
      }
    }

    return JSON.stringify(filtered);
  } catch {
    return promoJson;
  }
}

/**
 * Call Dify workflow to generate virtual shelf layout.
 */
async function fetchPromoString(majorCategory?: string): Promise<string> {
  try {
    const url = majorCategory
      ? `/api/skus/promo-full?major_category=${encodeURIComponent(majorCategory)}`
      : "/api/skus/promo-full";
    const res = await apiFetch(url);
    const data = await res.json();
    return JSON.stringify(data);
  } catch {
    return "{}";
  }
}

export async function generateVirtualShelfFromDify(
  skus: SkuRow[],
  strategies: Strategy[],
  shelfWidths: number[],
  shelfLayers: number[],
  category?: string,
): Promise<VirtualShelfGroup[]> {
  // Collect SKUs marked as "上架" (newly listed) in any applied strategy
  const newListedCodes = new Set<string>();
  strategies.forEach(st => {
    if (st.applied) {
      st.skus.forEach(s => {
        if (s.action.includes("上架")) newListedCodes.add(s.skuCode);
      });
    }
  });

  const [skujson, promoRaw] = await Promise.all([
    Promise.resolve(buildSkuJsonForDify(skus, strategies)),
    fetchPromoString(category),
  ]);

  const promoStr = filterPromoBySkus(skujson, promoRaw);

  const inputs = {
    category: category || "冷藏品",
    shelf_width: String(shelfWidths[0] ?? 120),
    shelf_layers: String(shelfLayers[0] ?? 6),
    shelf_num: shelfWidths.length || 1,
    skujson,
    promo: promoStr,
  };

  console.log("[VirtualShelf] Calling Dify workflow", {
    category: inputs.category,
    shelf_width: inputs.shelf_width,
    shelf_layers: inputs.shelf_layers,
    shelf_num: inputs.shelf_num,
    skujson_preview: `${inputs.skujson.slice(0, 200)}...`,
    promo_groups: Object.keys(JSON.parse(inputs.promo || "{}")).length,
  });

  // Use streaming mode: blocking mode keeps the edge-function proxy idle for the
  // entire workflow duration and trips Supabase's 150s idle timeout (504).
  // Streaming pushes node events continuously, keeping the proxy connection alive.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  let res: Response;
  try {
    res = await fetch(difyProxyUrl("virtual_shelf", "workflows/run"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ inputs: serializeDifyInputs(inputs), response_mode: "streaming", user: getDifyUser() }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      throw new Error("虚拟货架生成超时（超过 10 分钟），请稍后重试");
    }
    throw err;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeoutId);
    const txt = await res.text().catch(() => "");
    throw new Error(`虚拟货架生成失败 (${res.status}): ${txt}`);
  }

  // Read SSE stream and look for `workflow_finished` event
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishedOutputs: Record<string, unknown> | null = null;
  let finishedStatus = "";
  let finishedError = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        // Each event may have multiple `data:` lines; collect them
        const dataLines = rawEvent
          .split("\n")
          .filter(l => l.startsWith("data:"))
          .map(l => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join("");
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(dataStr);
          if (evt.event === "workflow_finished" && evt.data) {
            finishedOutputs = evt.data.outputs || {};
            finishedStatus = evt.data.status || "";
            finishedError = evt.data.error || "";
          }
        } catch { /* ignore parse errors for ping/keepalive frames */ }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    try { reader.releaseLock(); } catch { /* noop */ }
  }

  if (!finishedOutputs) {
    throw new Error("虚拟货架生成失败：未收到完成事件");
  }
  if (finishedStatus && finishedStatus !== "succeeded") {
    throw new Error(finishedError || "虚拟货架生成失败");
  }
  const json = { data: { outputs: finishedOutputs } } as DifyWorkflowResponse;

  // Bakery items lay flat (top-down view), so the visual "height" on the shelf
  // is actually the SKU's 长 (length), not its 高 (height). Detect via category.
  const useLengthAsHeight = (category || "").includes("烘焙");
  return parseDifyOutput(json.data.outputs, shelfWidths, newListedCodes, useLengthAsHeight, skus);
}

/**
 * Parse Dify workflow output into VirtualShelfGroup[] format.
 */
export function parseDifyOutput(
  outputData: Record<string, unknown>,
  shelfWidths: number[],
  newListedCodes: Set<string> = new Set(),
  useLengthAsHeight = false,
  skus: SkuRow[] = [],
): VirtualShelfGroup[] {
  // Extract raw array (sku_lct) and reason_layer from outputs
  let rawArray: unknown[] = [];
  const reasonLayerMap = new Map<number, string>();

  const extractArray = (obj: unknown): unknown[] | null => {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === "object") {
      const o = obj as any;
      if (Array.isArray(o.sku_lct)) return o.sku_lct;
      if (Array.isArray(o.placed)) return o.placed;
    }
    return null;
  };

  const extractReasonLayer = (obj: unknown): Array<{ layer: number; reason: string }> | null => {
    if (obj && typeof obj === "object" && Array.isArray((obj as any).reason_layer)) {
      return (obj as any).reason_layer;
    }
    return null;
  };

  const tryConsume = (val: unknown): boolean => {
    const arr = extractArray(val);
    if (arr) {
      rawArray = arr;
      const rl = extractReasonLayer(val);
      if (rl) {
        for (const r of rl) reasonLayerMap.set(r.layer, r.reason);
      }
      return true;
    }
    return false;
  };

  for (const val of Object.values(outputData)) {
    if (tryConsume(val)) break;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (tryConsume(parsed)) break;
      } catch { /* continue */ }
    }
  }

  // Also scan top-level for reason_layer if not yet captured
  if (reasonLayerMap.size === 0) {
    const topRl = extractReasonLayer(outputData);
    if (topRl) for (const r of topRl) reasonLayerMap.set(r.layer, r.reason);
  }

  if (!rawArray || rawArray.length === 0) {
    throw new Error("Dify 返回数据中未找到布局信息");
  }

  // Detect format: new SKU-level format vs legacy flat format
  const isNewFormat = rawArray.length > 0 &&
    typeof rawArray[0] === "object" &&
    rawArray[0] !== null &&
    "skus" in rawArray[0] &&
    Array.isArray((rawArray[0] as any).skus);

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
    unifiedBlocks = (rawArray as UnifiedBlock[]).map(b => ({
      ...b,
      sku_code: padSkuCode(b.sku_code),
      reason: b.reason || reasonLayerMap.get(b.layer),
    }));
  }

  const getShelfWidth = (shelfId: number) => shelfWidths[shelfId - 1] || 75;

  // Build color map
  const subcategories = [...new Set(unifiedBlocks.map(b => b.sub_category))];
  const colorMap: Record<string, string> = {};
  subcategories.forEach((sc, i) => {
    colorMap[sc] = VIRTUAL_SHELF_COLORS[i % VIRTUAL_SHELF_COLORS.length];
  });

  // Group by shelf_id → layer
  const shelfMap = new Map<number, Map<number, UnifiedBlock[]>>();
  for (const item of unifiedBlocks) {
    if (!shelfMap.has(item.shelf_id)) shelfMap.set(item.shelf_id, new Map());
    const layerMap = shelfMap.get(item.shelf_id)!;
    if (!layerMap.has(item.layer)) layerMap.set(item.layer, []);
    layerMap.get(item.layer)!.push(item);
  }

  // Sort blocks within each layer by start_x
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

    const layers: VirtualShelfGroup["layers"] = [];

    for (let li = 1; li <= maxLayer; li++) {
      const rawBlocks = layerMap.get(li);
      if (!rawBlocks || rawBlocks.length === 0) {
        layers.push({ layerIndex: li, blocks: [] });
        continue;
      }

      const convertedBlocks: VirtualShelfBlock[] = rawBlocks.map((rb, bi) => {
        // Look up real height from dimension data; fall back to Dify output or default 15cm.
        // For bakery (top-down view), use 长 (length) instead of 高 (height).
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
          skuCode: rb.sku_code || "",
          facing: rb.facing || 1,
          upfacing: rb.upfacing,
          widthCm: rb.width_cm,
          heightCm,
          startRatio: Math.round((rb.start_x / shelfWidth) * 1000) / 1000,
          endRatio: Math.round((rb.end_x / shelfWidth) * 1000) / 1000,
          color: colorMap[rb.sub_category] || "hsl(0, 0%, 60%)",
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
      layers: layers.filter(l => l.blocks.length > 0),
      shelfWidthCm: shelfWidth,
    });
  }

  return groups;
}
