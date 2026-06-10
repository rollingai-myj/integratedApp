/**
 * 虚拟货架生成（shim）
 *
 * 原 repo 走自建 /api/generate-virtual-shelf 由 Node 后端代调 Dify 并落库。
 * 整合 app 的同名端点 schema 只接受 storeId(UUID) + sceneCode + currentSkus[]，
 * inputs 由后端自行构造 —— 不接受原前端富 inputs (shelf_width 数组 / promo /
 * sku_json …)。强行对齐会牺牲业务表达力。
 *
 * 这里改走 dify-proxy 流式：前端构造完整 inputs，直接 POST 到
 * /api/v1/dify-proxy?app=virtual_shelf&path=workflows/run，AI key 由后端注入；
 * 拿到 outputs 后：
 *   1. 写 localStorage（saveSceneRuntime: virtual_shelf_status=completed + raw_outputs + context）
 *      → PhotoPage 的 pollVirtual 立即看到
 *   2. POST /api/v1/scenes/:sceneId/virtual-shelf 持久化历史，跨设备 VirtualPage 可看
 */
import { type SkuRow } from '@/components/shelves/data/skuData';
import { type Strategy } from '@/components/shelves/contexts/AppContext';
import { isRemoveAction } from '@/components/shelves/lib/strategyAction';
import { difyProxyUrl } from '@/components/shelves/lib/difyProxyUrl';
import { readWorkflowFinished } from '@/components/shelves/lib/difyWorkflowStream';
import { getDifyUser } from '@/components/shelves/lib/difyUser';
import { apiFetch } from '@/components/shelves/lib/api-client';
import { filterPromoBySkus } from '@/components/shelves/services/difyVirtualShelfApi';
import { saveSceneRuntime } from '@/components/shelves/services/sceneRuntime';
import { recordVirtualHistory, type PlanPosition, type ShelfGroup } from '@/components/shelves/services/scenes';

export interface VirtualShelfJobParams {
  storeId: string;
  shelfId: string;
  skus: SkuRow[];
  strategies: Strategy[];
  shelfGroups: ShelfGroup[];
  position?: PlanPosition | null;
}

function buildSkuJson(skus: SkuRow[], strategies: Strategy[], category?: string): string {
  const delistedCodes = new Set<string>();
  const newlyListedCodes = new Set<string>();

  strategies.forEach((st) => {
    if (st.applied) {
      st.skus.forEach((s) => {
        if (isRemoveAction(s.action)) delistedCodes.add(s.skuCode);
        else if (s.action.includes('上架')) newlyListedCodes.add(s.skuCode);
      });
    }
  });

  const skuMap = new Map(skus.map((s) => [s.skuCode, s]));
  const activeCodes = new Set<string>();
  for (const s of skus) {
    if (!delistedCodes.has(s.skuCode)) activeCodes.add(s.skuCode);
  }
  for (const code of newlyListedCodes) {
    if (skuMap.has(code)) activeCodes.add(code);
  }

  const result: Record<string, unknown>[] = [];
  for (const code of activeCodes) {
    const s = skuMap.get(code);
    if (!s) continue;
    if (category && s.majorCategory !== category) continue;
    result.push({
      商品代码: s.skuCode,
      商品名称: (s.skuName || '').replace(/^(NX|N)/, ''),
      大类: s.majorCategory,
      中类: s.midCategory || '',
      品牌: s.brandName || '',
      单位: s.unit || '',
      宽cm: s.width ?? null,
      高cm: s.height ?? null,
      小类: s.subCategory,
      '30日销售量': parseFloat(s.salesVolume30d || '0') || 0,
      '30日销售额': parseFloat(s.sales30d || '0') || 0,
    });
  }
  return JSON.stringify(result);
}

export async function startVirtualShelfJob(p: VirtualShelfJobParams): Promise<void> {
  const newListedCodes = new Set<string>();
  p.strategies.forEach((st) => {
    if (st.applied) st.skus.forEach((s) => { if (s.action.includes('上架')) newListedCodes.add(s.skuCode); });
  });

  const positionCode = p.position?.position_code ?? 0;

  // 按 category 分组，每组单独跑（与原 repo 一致）
  const categoryGroups = new Map<string, ShelfGroup[]>();
  for (const g of p.shelfGroups) {
    const cat = g.category || '__all__';
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
    categoryGroups.get(cat)!.push(g);
  }

  await saveSceneRuntime(p.storeId, p.shelfId, { virtual_shelf_status: 'processing' });

  try {
    if (categoryGroups.size === 0 || (categoryGroups.size === 1 && categoryGroups.has('__all__'))) {
      const all = p.shelfGroups;
      await runOneCategory(p, positionCode, undefined,
        all.map((g) => Number(g.shelf_width)),
        all.map((g) => Number(g.shelf_layers)),
        newListedCodes);
    } else {
      // 多 category：串行跑，最后一个覆盖写入（与原 repo 行为一致）
      for (const [cat, groups] of categoryGroups) {
        await runOneCategory(p, positionCode, cat === '__all__' ? undefined : cat,
          groups.map((g) => Number(g.shelf_width)),
          groups.map((g) => Number(g.shelf_layers)),
          newListedCodes);
      }
    }
  } catch (err) {
    await saveSceneRuntime(p.storeId, p.shelfId, {
      virtual_shelf_status: 'failed',
      virtual_shelf_raw_outputs: { error: (err as Error).message },
    });
    throw err;
  }
}

/**
 * 拉当前 store 当前品类的全部 promo_text，reshape 成原 repo 期望的
 * `{ groupCode: { skuCode: promoText } }` 形态，给 filterPromoBySkus 过滤。
 * 失败返回 '{}'（Dify 容错），但失败原因写 console.warn 以便排查。
 */
async function fetchPromoBlob(category: string | undefined, skuJson: string): Promise<string> {
  try {
    const url = category
      ? `/master/promotions-text?categoryPath=${encodeURIComponent(category)}`
      : '/master/promotions-text';
    const res = await apiFetch(url);
    if (!res.ok) {
      console.warn('[virtualShelfJob.fetchPromoBlob] non-ok', res.status);
      return '{}';
    }
    const data = (await res.json()) as {
      promotions?: Array<{ groupCode: string; skuCode: string; promoText: string }>;
    };
    const grouped: Record<string, Record<string, string>> = {};
    for (const p of data.promotions ?? []) {
      if (!grouped[p.groupCode]) grouped[p.groupCode] = {};
      grouped[p.groupCode]![p.skuCode] = p.promoText;
    }
    return filterPromoBySkus(skuJson, JSON.stringify(grouped));
  } catch (err) {
    console.warn('[virtualShelfJob.fetchPromoBlob] threw', err);
    return '{}';
  }
}

async function runOneCategory(
  p: VirtualShelfJobParams,
  positionCode: number,
  category: string | undefined,
  shelfWidths: number[],
  shelfLayers: number[],
  newListedCodes: Set<string>,
): Promise<void> {
  const skuJson = buildSkuJson(p.skus, p.strategies, category);
  const promo = await fetchPromoBlob(category, skuJson);

  const inputs = {
    position_code: positionCode,
    category: category || '',
    shelf_width: JSON.stringify(shelfWidths),
    shelf_layers: JSON.stringify(shelfLayers),
    sku_json: skuJson,
    promo,
    store_id: p.storeId,
  };

  const res = await fetch(difyProxyUrl('virtual_shelf', 'workflows/run'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, response_mode: 'streaming', user: getDifyUser() }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`虚拟货架 Dify 调用失败 (${res.status}): ${txt}`);
  }
  const outputs = await readWorkflowFinished(res);

  const parseContext = {
    shelfWidths,
    newListedCodes: Array.from(newListedCodes),
    useLengthAsHeight: (category || '').includes('烘焙'),
    category,
  };

  await saveSceneRuntime(p.storeId, p.shelfId, {
    virtual_shelf_status: 'completed',
    virtual_shelf_raw_outputs: outputs,
    virtual_shelf_context: parseContext,
  });

  // 同步落库，跨设备 VirtualPage 可看（失败不阻塞）
  try {
    await recordVirtualHistory({
      storeId: p.storeId,
      positionCode,
      rawOutputs: outputs,
      context: parseContext,
    });
  } catch (err) {
    console.warn('[shelves/virtualShelfJob.record] backend write failed', err);
  }
}
