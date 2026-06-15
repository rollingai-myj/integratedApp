/**
 * Shim：兼容原 poster repo 引用的 @/lib/promotions.functions
 *
 * 老 repo 这套是超管侧的促销批次管理（上传 / 列表 / 激活 / 删除 / 推荐）。
 * 整合后超管功能去 apps/admin（暂未实现），店长侧只需要"读当前生效批次 + 推荐"。
 *
 * 这里把店长真正会用的 `getPersonalizedPromotions` 实现成调统一后端的
 * `/promotions/recommend`（按近 30 天用户海报品类偏好排序）+ 重新整形成
 * 原 repo 期望的 `{ upload, categories }` 结构，poster-app 子树零修改。
 *
 * 其它超管 API（listUploads/activateUpload/deleteUpload）poster-app 店长流程
 * 不调，留空导出以满足 TS 解析即可。
 */
import type {
  ActivePromotionsResponse,
  ProductPromotion,
  ProductPromotionDealOption,
  PromotionGroupRow,
  RecommendPromotionsResponse,
} from '@myj/shared';
import { mapCategoryToGroup } from '@/lib/categoryGroups';

const BASE = '/api/v1';

interface CategoryItem {
  sku: string;
  product_name: string;
  unit?: string | null;
  original_price?: number | null;
  category?: string | null;
  best_label?: string | null;
  best_qty?: number | null;
  best_total?: number | null;
  best_effective_price?: number | null;
  best_saving_percent?: number | null;
  display_text?: string | null;
  best_valid_from?: string | null;
  best_valid_to?: string | null;
  best_valid_dates?: string[] | null;
  /** poster-app 的 deriveBest 需要这个 fallback；shim 必须从 API 透传过去 */
  all_options?: ProductPromotionDealOption[] | null;
  is_group?: boolean;
  group_id?: string | null;
  brand_label?: string | null;
  group_members?: Array<{ sku: string; productName: string }> | null;
  best_applies_to_skus?: string[] | null;
}

export interface PersonalizedPromotionsResult {
  upload: { id: string; filename: string; created_at: string } | null;
  categories: Array<{ name: string; items: CategoryItem[] }>;
}

/**
 * pg numeric 列在 node-postgres 默认序列化为 string。后端 mapPromotion 没做转换，
 * 所以 wire 上 originalPrice / bestTotalPrice / bestEffectiveUnitPrice 等是字符串。
 * poster-app 的 deriveBest 走数值比较（savingPercent 排序、价格比对），string 上去
 * 会要么 NaN 要么按字典序排，过滤剩 0 项。这里全部 toNumber 一次。
 */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * pg DATE 列在 pg 驱动里反序列化成 JS Date，再被 JSON.stringify 转成
 * '2026-05-31T16:00:00.000Z'（UTC 时间，对应北京 6/1）。poster-app 里
 * 大量地方按 YYYY-MM-DD 比较或拼显示文案（fmtMD），所以这里截断到日。
 * 用 Beijing 时区（+8）取日，避免 UTC 偏移一天。
 */
function toISODate(d: string | null | undefined): string | null {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  // 加 8h 偏移到北京时区，再切 YYYY-MM-DD
  return new Date(parsed.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function normalizeOption(o: ProductPromotionDealOption): ProductPromotionDealOption {
  return {
    ...o,
    requiredQty: toNum(o.requiredQty) ?? 0,
    totalPrice: toNum(o.totalPrice) ?? 0,
    effectiveUnitPrice: toNum(o.effectiveUnitPrice) ?? 0,
    savingPercent: toNum(o.savingPercent) ?? 0,
    validFrom: toISODate(o.validFrom),
    validTo: toISODate(o.validTo),
  };
}

function rowToCategoryItem(p: ProductPromotion): CategoryItem {
  return {
    sku: p.skuCode,
    product_name: p.productName,
    unit: p.unit ?? null,
    original_price: toNum(p.originalPrice),
    category: p.categoryName ?? null,
    best_label: p.bestLabel ?? null,
    best_qty: p.bestRequiredQty ?? null,
    best_total: toNum(p.bestTotalPrice),
    best_effective_price: toNum(p.bestEffectiveUnitPrice),
    best_saving_percent: toNum(p.bestSavingPercent),
    display_text: p.displayText ?? null,
    best_valid_from: toISODate(p.validFrom),
    best_valid_to: toISODate(p.validTo),
    best_valid_dates: p.validDates ?? null,
    all_options: p.allOptions ? p.allOptions.map(normalizeOption) : null,
  };
}

export async function getPersonalizedPromotions(): Promise<PersonalizedPromotionsResult> {
  try {
    // 优先走 /promotions/recommend（按个性化排序）；空 → fallback /promotions/active
    let products: ProductPromotion[] = [];
    let groups: PromotionGroupRow[] = [];
    let upload: { id: string; filename: string; created_at: string } | null = null;

    const recoRes = await fetch(`${BASE}/promotions/recommend`, { credentials: 'include' });
    if (recoRes.ok) {
      const body = (await recoRes.json()) as RecommendPromotionsResponse;
      products = body.products ?? [];
      groups = body.groups ?? [];
      if (body.upload) {
        upload = { id: body.upload.id, filename: body.upload.fileName, created_at: body.upload.createdAt };
      }
    }
    if (products.length === 0) {
      const actRes = await fetch(`${BASE}/promotions/active`, { credentials: 'include' });
      if (actRes.ok) {
        const body = (await actRes.json()) as ActivePromotionsResponse;
        products = body.products ?? [];
        groups = body.groups ?? [];
        if (body.upload) {
          upload = { id: body.upload.id, filename: body.upload.fileName, created_at: body.upload.createdAt };
        }
      }
    }

    // SKU → product 反查表（折叠 group 时用）
    // 注：故意不做"组成员 SKU 在单品列表里去重"——group 卡和成员单品卡需要各自独立展示，
    // 因为它们代表两种不同促销玩法（凑单组合价 vs 单品最优档），店长选品时两者均需可见。
    const skuToProduct = new Map<string, ProductPromotion>();
    for (const p of products) skuToProduct.set(p.skuCode, p);

    const byCategory = new Map<string, CategoryItem[]>();
    const pushTo = (groupName: string, item: CategoryItem) => {
      if (!byCategory.has(groupName)) byCategory.set(groupName, []);
      byCategory.get(groupName)!.push(item);
    };

    // 1) 先入 groups（让它们排在每个 category 的最前面）
    for (const g of groups) {
      const groupName = mapCategoryToGroup(g.categoryName ?? '');
      const members = (g.skuCodes ?? []).map((sku) => skuToProduct.get(sku));
      const firstMember = members.find((m): m is ProductPromotion => m != null);
      const origSum = members.reduce((s, m) => s + (toNum(m?.originalPrice) ?? 0), 0);
      const total = toNum(g.bestTotalPrice);
      const item: CategoryItem = {
        sku: `group:${g.id}`,
        product_name: g.displayName ?? '凑单组',
        unit: firstMember?.unit ?? null,
        original_price: origSum > 0 ? origSum : null,
        category: g.categoryName,
        best_label: g.bestLabel,
        best_qty: g.productCount,
        best_total: total,
        best_effective_price: total != null && g.productCount > 0 ? total / g.productCount : null,
        best_saving_percent: toNum(g.bestSavingPercent),
        display_text: null,
        best_valid_from: null,
        best_valid_to: null,
        best_valid_dates: null,
        all_options: null,
        is_group: true,
        group_id: g.id,
        brand_label: g.displayName,
        group_members: (g.skuCodes ?? []).map((sku) => ({
          sku,
          productName: skuToProduct.get(sku)?.productName ?? sku,
        })),
        best_applies_to_skus: null,
      };
      pushTo(groupName, item);
    }

    // 2) 再入全部单品（不排除 group 成员——见上方注释）
    for (const p of products) {
      const item = rowToCategoryItem(p);
      pushTo(mapCategoryToGroup(item.category ?? ''), item);
    }

    const categories = Array.from(byCategory.entries()).map(([name, items]) => ({
      name,
      items,
    }));

    return { upload, categories };
  } catch (err) {
    console.error('[promotions shim] getPersonalizedPromotions failed:', err);
    return { upload: null, categories: [] };
  }
}

// 占位：超管侧 API，店长流程不调，仅保留 import 路径兼容
export async function listUploads(): Promise<{ uploads: [] }> {
  return { uploads: [] };
}
export async function activateUpload(): Promise<{ ok: true }> {
  return { ok: true };
}
export async function getActivePromotions(): Promise<PersonalizedPromotionsResult> {
  return getPersonalizedPromotions();
}
export async function deleteUpload(): Promise<{ ok: true }> {
  return { ok: true };
}
export async function setActiveUpload(): Promise<{ ok: true }> {
  return { ok: true };
}
