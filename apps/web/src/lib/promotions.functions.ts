/**
 * Shim：兼容原 poster repo 引用的 @/lib/promotions.functions
 *
 * 老 repo 这套是超管侧的促销批次管理（上传 / 列表 / 激活 / 删除 / 推荐）。
 * 整合后超管功能去 apps/admin（暂未实现），店长侧只需要"读当前生效批次 + 推荐"。
 *
 * 这里把店长真正会用的 `getPersonalizedPromotions` 实现成调统一后端的
 * `/promotions/recommend`（按近 30 天用户海报品类偏好排序）。后端把两条独立计算路径
 * 都返回：`results`(允许叠券) + `resultsMemberOnly`(只算会员价、忽略其它优惠)。
 * shim 把两路各自做成一份 categories tree，由 poster-app 按 promoMode 选用。
 */
import type {
  ActivePromotionsResponse,
  PromoActivityType,
  PromoBestResult,
  RecommendPromotionsResponse,
} from '@myj/shared';
import { mapCategoryToGroup } from '@/lib/categoryGroups';
import { formatPromotionDisplayText } from '@/utils/promoDisplayText';

const ACTIVITY_LABEL: Record<PromoActivityType, string> = {
  member_price: '会员价',
  weekend_beer: '周末啤酒日',
  brand_coupon: '品牌满减券',
  tuesday_member: '周二会员日',
  regular_coupon: '常规优惠券',
};

function comboLabel(base: PromoActivityType, addon: PromoActivityType | null): string {
  const b = ACTIVITY_LABEL[base] ?? base;
  if (!addon) return b;
  const a = ACTIVITY_LABEL[addon] ?? addon;
  return `${b} + ${a}`;
}

/**
 * 把 7-bit weekday mask 转成 JS Date.getDay() 维度的数组。
 * mask bit 6 = 周一 (ISODOW=1) → JS day 1
 * mask bit 0 = 周日 (ISODOW=7) → JS day 0
 * 通用映射: bit b → JS day = b === 0 ? 0 : 7 - b
 */
function maskToDays(mask: number): number[] {
  const days: number[] = [];
  for (let bit = 0; bit <= 6; bit++) {
    if (mask & (1 << bit)) days.push(bit === 0 ? 0 : 7 - bit);
  }
  return days.sort((a, b) => a - b);
}

const BASE = '/api/v1';

interface CategoryItem {
  sku: string;
  product_name: string;
  unit?: string | null;
  original_price?: number | null;
  category?: string | null;
  // base × addon 的活动类型(供 validityBadge 决定走「周二会员日」/「周末啤酒日」黄标)
  base_activity_type?: PromoActivityType | null;
  addon_activity_type?: PromoActivityType | null;
  best_label?: string | null;
  best_qty?: number | null;
  best_total?: number | null;
  best_effective_price?: number | null;
  best_saving_percent?: number | null;
  display_text?: string | null;
  best_valid_from?: string | null;
  best_valid_to?: string | null;
  best_valid_dates?: string[] | null;
  all_options?: Array<{
    label: string;
    requiredQty: number;
    totalPrice: number;
    effectiveUnitPrice: number;
    savingPercent: number;
    validFrom?: string | null;
    validTo?: string | null;
    validDayOfWeek?: number[] | null;
  }> | null;
  is_group?: boolean;
  group_id?: string | null;
  brand_label?: string | null;
  group_members?: Array<{ sku: string; productName: string }> | null;
  best_applies_to_skus?: string[] | null;
}

export interface PersonalizedPromotionsResult {
  upload: { id: string; filename: string; created_at: string } | null;
  /** 允许叠券模式下展示的品类树 */
  categories: Array<{ name: string; items: CategoryItem[] }>;
  /** 「只用会员价」模式下展示的品类树（后端只解析了 member_price 一路） */
  categoriesMemberOnly: Array<{ name: string; items: CategoryItem[] }>;
}

function rowToCategoryItem(p: PromoBestResult): CategoryItem {
  const savePct = (p.bestSavingPercent ?? 0) * 100;
  const label = comboLabel(p.baseActivityType, p.addonActivityType);
  const displayText = formatPromotionDisplayText({
    label,
    totalPrice: p.bestBundleTotal,
    requiredQty: p.bestQty,
    effectiveUnitPrice: p.bestUnitPrice,
    originalPrice: p.originalPrice,
    unit: p.unit ?? null,
    productName: p.productName,
    fallback: null,
  });
  const days = maskToDays(p.validWeekdayMask);
  return {
    sku: p.skuCode,
    product_name: p.productName,
    unit: p.unit ?? null,
    original_price: p.originalPrice,
    category: p.categoryName ?? null,
    base_activity_type: p.baseActivityType,
    addon_activity_type: p.addonActivityType,
    best_label: label,
    best_qty: p.bestQty,
    best_total: p.bestBundleTotal,
    best_effective_price: p.bestUnitPrice,
    best_saving_percent: savePct,
    display_text: displayText,
    best_valid_from: p.validFrom,
    best_valid_to: p.validTo,
    best_valid_dates: null,
    all_options: [{
      label,
      requiredQty: p.bestQty,
      totalPrice: p.bestBundleTotal,
      effectiveUnitPrice: p.bestUnitPrice,
      savingPercent: savePct,
      validFrom: p.validFrom,
      validTo: p.validTo,
      validDayOfWeek: days,
    }],
  };
}

function buildCategoriesTree(results: PromoBestResult[]): Array<{ name: string; items: CategoryItem[] }> {
  // 先按 poolLabel 聚一遍 — size > 1 的池子要发一张'凑单组'卡(放在该 category 的最前面)
  const poolGroups = new Map<string, PromoBestResult[]>();
  for (const p of results) {
    if (!p.poolLabel) continue;
    if (!poolGroups.has(p.poolLabel)) poolGroups.set(p.poolLabel, []);
    poolGroups.get(p.poolLabel)!.push(p);
  }

  const byCategory = new Map<string, CategoryItem[]>();
  const pushTo = (g: string, item: CategoryItem) => {
    if (!byCategory.has(g)) byCategory.set(g, []);
    byCategory.get(g)!.push(item);
  };

  // 1) 凑单组卡(每个 size > 1 的池子一张) — 成员单品仍会另出单品卡,故意不去重
  for (const [poolLabel, members] of poolGroups) {
    if (members.length < 2) continue;
    const rep = members.reduce((a, b) => (b.bestSavingPercent > a.bestSavingPercent ? b : a));
    const origSum = members.reduce((s, m) => s + (m.originalPrice ?? 0), 0);
    const repSavePct = (rep.bestSavingPercent ?? 0) * 100;
    const repLabel = comboLabel(rep.baseActivityType, rep.addonActivityType);
    const repDays = maskToDays(rep.validWeekdayMask);
    const groupName = poolLabel.split('/')[1] ?? poolLabel;
    const repDisplay = formatPromotionDisplayText({
      label: repLabel,
      totalPrice: rep.bestBundleTotal,
      requiredQty: rep.bestQty,
      effectiveUnitPrice: rep.bestUnitPrice,
      originalPrice: rep.originalPrice,
      unit: rep.unit ?? null,
      productName: groupName,
      fallback: null,
    });
    const item: CategoryItem = {
      sku: `group:${poolLabel}`,
      product_name: groupName,
      unit: rep.unit ?? null,
      original_price: origSum > 0 ? origSum : null,
      category: rep.categoryName ?? null,
      base_activity_type: rep.baseActivityType,
      addon_activity_type: rep.addonActivityType,
      best_label: repLabel,
      best_qty: members.length,
      best_total: rep.bestBundleTotal,
      best_effective_price: rep.bestUnitPrice,
      best_saving_percent: repSavePct,
      display_text: repDisplay,
      best_valid_from: rep.validFrom,
      best_valid_to: rep.validTo,
      best_valid_dates: null,
      all_options: [{
        label: repLabel,
        requiredQty: rep.bestQty,
        totalPrice: rep.bestBundleTotal,
        effectiveUnitPrice: rep.bestUnitPrice,
        savingPercent: repSavePct,
        validFrom: rep.validFrom,
        validTo: rep.validTo,
        validDayOfWeek: repDays,
      }],
      is_group: true,
      group_id: poolLabel,
      brand_label: poolLabel.split('/')[1] ?? poolLabel,
      group_members: members.map((m) => ({ sku: m.skuCode, productName: m.productName })),
      best_applies_to_skus: members.map((m) => m.skuCode),
    };
    pushTo(mapCategoryToGroup(item.category ?? ''), item);
  }

  // 2) 全部单品卡
  for (const p of results) {
    const item = rowToCategoryItem(p);
    pushTo(mapCategoryToGroup(item.category ?? ''), item);
  }

  return Array.from(byCategory.entries()).map(([name, items]) => ({ name, items }));
}

export async function getPersonalizedPromotions(): Promise<PersonalizedPromotionsResult> {
  try {
    let results: PromoBestResult[] = [];
    let resultsMemberOnly: PromoBestResult[] = [];
    let upload: { id: string; filename: string; created_at: string } | null = null;

    const recoRes = await fetch(`${BASE}/promotions/recommend`, { credentials: 'include' });
    if (recoRes.ok) {
      const body = (await recoRes.json()) as RecommendPromotionsResponse;
      results = body.results ?? [];
      resultsMemberOnly = body.resultsMemberOnly ?? [];
      const first = body.batches?.[0];
      if (first) upload = { id: first.id, filename: first.fileName, created_at: first.createdAt };
    }
    if (results.length === 0 && resultsMemberOnly.length === 0) {
      const actRes = await fetch(`${BASE}/promotions/active`, { credentials: 'include' });
      if (actRes.ok) {
        const body = (await actRes.json()) as ActivePromotionsResponse;
        results = body.results ?? [];
        resultsMemberOnly = body.resultsMemberOnly ?? [];
        const first = body.batches?.[0];
        if (first) upload = { id: first.id, filename: first.fileName, created_at: first.createdAt };
      }
    }

    return {
      upload,
      categories: buildCategoriesTree(results),
      categoriesMemberOnly: buildCategoriesTree(resultsMemberOnly),
    };
  } catch (err) {
    console.error('[promotions shim] getPersonalizedPromotions failed:', err);
    return { upload: null, categories: [], categoriesMemberOnly: [] };
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
