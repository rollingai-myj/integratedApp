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
  PromoActivityType,
  PromoBestResult,
  RecommendPromotionsResponse,
} from '@myj/shared';
import { mapCategoryToGroup } from '@/lib/categoryGroups';
import { formatPromotionDisplayText } from '@/utils/promoDisplayText';

/**
 * 活动类型 → 卡片绿色徽章 / promoMode 过滤用的中文 label。
 * Home.tsx 的 memberOnly 过滤认 '会员价'/'会员日' 两个字面值，
 * formatPromotionDisplayText 认 ' + ' 分隔决定 connector 走"叠券后"。
 */
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
  all_options?: Array<{
    label: string;
    requiredQty: number;
    totalPrice: number;
    effectiveUnitPrice: number;
    savingPercent: number;
    validFrom?: string | null;
    validTo?: string | null;
  }> | null;
  // 凑单组字段(仅 is_group=true 时填充;池子里 N 个 sku 共享同一条促销规则)
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
  // 「只用会员价」模式专用备选档:label 严格为 '会员价'(strict),即使 best 本身就是
  // member alone 也独立挂一条,promoMode.ts 走 `=== '会员价'` 拿这条。
  const memberOnlyOption = p.memberOnly ? [{
    label: '会员价',
    requiredQty: p.memberOnly.qty,
    totalPrice: p.memberOnly.bundleTotal,
    effectiveUnitPrice: p.memberOnly.unitPrice,
    savingPercent: (p.memberOnly.savingPercent ?? 0) * 100,
    validFrom: null as string | null,
    validTo: null as string | null,
  }] : [];
  return {
    sku: p.skuCode,
    product_name: p.productName,
    unit: p.unit ?? null,
    original_price: p.originalPrice,
    category: p.categoryName ?? null,
    best_label: label,
    best_qty: p.bestQty,
    best_total: p.bestBundleTotal,
    best_effective_price: p.bestUnitPrice,
    best_saving_percent: savePct,
    display_text: displayText,
    best_valid_from: null,
    best_valid_to: null,
    best_valid_dates: null,
    all_options: [
      {
        label,
        requiredQty: p.bestQty,
        totalPrice: p.bestBundleTotal,
        effectiveUnitPrice: p.bestUnitPrice,
        savingPercent: savePct,
        validFrom: null,
        validTo: null,
      },
      ...memberOnlyOption,
    ],
  };
}

export async function getPersonalizedPromotions(): Promise<PersonalizedPromotionsResult> {
  try {
    // 优先走 /promotions/recommend（按个性化排序）；空 → fallback /promotions/active
    let results: PromoBestResult[] = [];
    let upload: { id: string; filename: string; created_at: string } | null = null;

    const recoRes = await fetch(`${BASE}/promotions/recommend`, { credentials: 'include' });
    if (recoRes.ok) {
      const body = (await recoRes.json()) as RecommendPromotionsResponse;
      results = body.results ?? [];
      const first = body.batches?.[0];
      if (first) upload = { id: first.id, filename: first.fileName, created_at: first.createdAt };
    }
    if (results.length === 0) {
      const actRes = await fetch(`${BASE}/promotions/active`, { credentials: 'include' });
      if (actRes.ok) {
        const body = (await actRes.json()) as ActivePromotionsResponse;
        results = body.results ?? [];
        const first = body.batches?.[0];
        if (first) upload = { id: first.id, filename: first.fileName, created_at: first.createdAt };
      }
    }

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

    // 1) 凑单组卡(每个 size > 1 的池子一张) — 注:成员单品仍会另出单品卡,故意不去重
    for (const [poolLabel, members] of poolGroups) {
      if (members.length < 2) continue;
      const rep = members.reduce((a, b) => (b.bestSavingPercent > a.bestSavingPercent ? b : a));
      const origSum = members.reduce((s, m) => s + (m.originalPrice ?? 0), 0);
      const repSavePct = (rep.bestSavingPercent ?? 0) * 100;
      const repLabel = comboLabel(rep.baseActivityType, rep.addonActivityType);
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
        best_label: repLabel,
        best_qty: members.length,
        best_total: rep.bestBundleTotal,
        best_effective_price: rep.bestUnitPrice,
        best_saving_percent: repSavePct,
        display_text: repDisplay,
        best_valid_from: null,
        best_valid_to: null,
        best_valid_dates: null,
        all_options: [
          {
            label: repLabel,
            requiredQty: rep.bestQty,
            totalPrice: rep.bestBundleTotal,
            effectiveUnitPrice: rep.bestUnitPrice,
            savingPercent: repSavePct,
            validFrom: null,
            validTo: null,
          },
          ...(rep.memberOnly ? [{
            label: '会员价',
            requiredQty: rep.memberOnly.qty,
            totalPrice: rep.memberOnly.bundleTotal,
            effectiveUnitPrice: rep.memberOnly.unitPrice,
            savingPercent: (rep.memberOnly.savingPercent ?? 0) * 100,
            validFrom: null,
            validTo: null,
          }] : []),
        ],
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

    const categories = Array.from(byCategory.entries()).map(([name, items]) => ({ name, items }));
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
