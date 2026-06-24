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
  PromoMechanicParams,
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
 * 从 addon 池标签里抽品牌名:"brand_coupon/怡宝饮料品牌满减" → "怡宝饮料"。
 * 拿不到牌名时返回空串(由调用方决定是否还要追加 "品牌满减券"等通用名)。
 */
function brandFromPoolLabel(poolLabel: string | null): string {
  if (!poolLabel) return '';
  const seg = poolLabel.includes('/') ? poolLabel.split('/').slice(1).join('/') : poolLabel;
  return seg.replace(/品牌满减券?$/, '').replace(/系列$/, '').trim();
}

/**
 * 把 addon 翻成顾客能看懂的具体描述:
 *  - pool_threshold (品牌满减) → "怡宝饮料 满 88 减 10"
 *  - percent_discount (周二会员 9 折 / 9 折券) → "9 折券"
 *  - 其它兜底 → addon 的活动名(如 "常规优惠券")
 *
 * 返回 null 表示"没有 addon 或无法描述",文案就不写"到店领券"那一段。
 */
function describeAddon(
  addonActivityType: PromoActivityType | null,
  addonPoolLabel: string | null,
  params: PromoMechanicParams | null,
): string | null {
  if (!addonActivityType || !params) return null;
  if (params.kind === 'pool_threshold') {
    const brand = brandFromPoolLabel(addonPoolLabel);
    const head = brand ? `${brand} ` : '';
    return `${head}满 ${params.threshold} 减 ${params.discount}`;
  }
  if (params.kind === 'percent_discount') {
    const percent = params.pay_ratio * 100;     // 0.9 → 90
    const off = 100 - percent;                  // 90 → 10(打 9 折 = 减 10%)
    void off;
    // 顾客习惯说"X 折",所以按 pay_ratio 报折:0.9 → 9 折; 0.85 → 8.5 折
    const zhe = (params.pay_ratio * 10).toFixed(1).replace(/\.0$/, '');
    return `${zhe} 折券`;
  }
  return ACTIVITY_LABEL[addonActivityType] ?? null;
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
  /** 组卡的"代表 SKU"商品名 — Home.tsx 渲染组卡商品名行用它,跟 best_label/价格保持
   *  同一权威源(rep);成员数组首位与 rep 不一定一致,所以不能用 members[0]. */
  rep_product_name?: string | null;
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
  const baseLabel = ACTIVITY_LABEL[p.baseActivityType] ?? p.baseActivityType;
  const addonDescription = describeAddon(p.addonActivityType, p.addonPoolLabel, p.addonMechanicParams);
  const displayText = formatPromotionDisplayText({
    baseLabel,
    addonDescription,
    baseTotalPrice: p.bestBaseTotalPrice,
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

/**
 * 凑单组规则
 * - member_price 促销组(p.poolLabel starts with 'member_price/'): 一组
 * - brand_coupon 池(p.addonPoolLabel 且 addonActivityType='brand_coupon'): 一组
 * - 优先级:若 SKU 同时在两类组里,优先归入 member_price 组
 * - 组的 size 必须 >=2 才出组卡;不满足则视为无组,SKU 走单品卡
 * - 已进组的 SKU 不再单独出单品卡(避免重复)
 *
 * 组卡 label 取通用形式避免代表 SKU 拽偏:
 * - member_price 组: '会员价'(成员 addon 可能异构,统一用 base label)
 * - brand_coupon 组: '会员价 + 品牌满减券'(组内 addon 一致)
 */
function buildCategoriesTree(results: PromoBestResult[]): Array<{ name: string; items: CategoryItem[] }> {
  // Pass 1: 把 SKU 候选挂到 member / brand 池
  const memberPools = new Map<string, PromoBestResult[]>();
  const brandPools = new Map<string, PromoBestResult[]>();
  for (const p of results) {
    if (p.poolLabel && p.poolLabel.startsWith('member_price/')) {
      if (!memberPools.has(p.poolLabel)) memberPools.set(p.poolLabel, []);
      memberPools.get(p.poolLabel)!.push(p);
    }
    if (p.addonActivityType === 'brand_coupon' && p.addonPoolLabel) {
      if (!brandPools.has(p.addonPoolLabel)) brandPools.set(p.addonPoolLabel, []);
      brandPools.get(p.addonPoolLabel)!.push(p);
    }
  }

  // Pass 2: 按优先级决定每个 SKU 最终归到哪个组(只看 size>=2 的池)
  const skuAssigned = new Map<string, { kind: 'member' | 'brand'; pool: string }>();
  for (const [pool, members] of memberPools) {
    if (members.length < 2) continue;
    for (const m of members) skuAssigned.set(m.skuCode, { kind: 'member', pool });
  }
  for (const [pool, members] of brandPools) {
    if (members.length < 2) continue;
    for (const m of members) if (!skuAssigned.has(m.skuCode)) skuAssigned.set(m.skuCode, { kind: 'brand', pool });
  }

  const byCategory = new Map<string, CategoryItem[]>();
  const pushTo = (g: string, item: CategoryItem) => {
    if (!byCategory.has(g)) byCategory.set(g, []);
    byCategory.get(g)!.push(item);
  };

  // 组卡构造工厂
  const buildGroupCard = (
    poolLabel: string,
    members: PromoBestResult[],
    kind: 'member' | 'brand',
  ): CategoryItem => {
    // rep 偏好:member 组先挑"纯会员价 alone"(addon 为 null)的最高省 — 避免 rep 是
    // tuesday_member combo 把组卡日期/mask 拽偏;brand 组偏好 base=member_price
    // (排除 base=weekend_beer 误显示"周末啤酒日")
    const preferred = kind === 'member'
      ? members.filter(m => m.addonActivityType == null)
      : members.filter(m => m.baseActivityType === 'member_price');
    const repPool = preferred.length > 0 ? preferred : members;
    const rep = repPool.reduce((a, b) => (b.bestSavingPercent > a.bestSavingPercent ? b : a));
    const repSavePct = (rep.bestSavingPercent ?? 0) * 100;
    // 组的 weekday 可用性 = 任一成员可用 (mask 并集),日期窗口取并集(最宽)
    const groupMask = members.reduce((m, x) => m | x.validWeekdayMask, 0);
    const groupValidFrom = members.reduce((d, x) => x.validFrom < d ? x.validFrom : d, members[0]!.validFrom);
    const groupValidTo   = members.reduce((d, x) => x.validTo   > d ? x.validTo   : d, members[0]!.validTo);
    const groupDays = maskToDays(groupMask);
    const poolName = poolLabel.split('/')[1] ?? poolLabel;

    // ── 三个槽位一律绑到 rep ───────────────────────────────────────────────
    // 旧行为:label 按 kind 硬编码("会员价" / "会员价 + 品牌满减券"),与 rep 真实
    // base/addon 类型脱钩;商品名走 members[0],价格走 rep — 三套数据源各自漂移,
    // 用户切 toggle 看到"绿标一样、价格变了"和"商品名是 SKU 但文案是组N·共三款"。
    // 现在 label / display_text(单 SKU 文案模板)/ rep_product_name 全部从 rep 算,
    // 保证 stack 与 memberOnly 两路下,任何一个槽位变就一起变。
    const label = comboLabel(rep.baseActivityType, rep.addonActivityType);
    const repBaseLabel = ACTIVITY_LABEL[rep.baseActivityType] ?? rep.baseActivityType;
    const repAddonDescription = describeAddon(rep.addonActivityType, rep.addonPoolLabel, rep.addonMechanicParams);
    const repDisplayText = formatPromotionDisplayText({
      baseLabel: repBaseLabel,
      addonDescription: repAddonDescription,
      baseTotalPrice: rep.bestBaseTotalPrice,
      requiredQty: rep.bestQty,
      effectiveUnitPrice: rep.bestUnitPrice,
      originalPrice: rep.originalPrice,
      unit: rep.unit ?? null,
      productName: null,  // 组卡商品名走 rep_product_name 字段,不进文案
      fallback: null,
    });

    // displayQty:member 组报 rep 自己的成交档(如"2 件 9.9");brand 组报凑齐池子
    // 满减所需件数(展示用,实际可混搭 member 组的同品牌 SKU 一起凑)。
    let title: string;
    let displayQty: number;
    let descriptionFallback: string;
    if (kind === 'member') {
      title = `${label} · ${poolName}`;
      displayQty = rep.bestQty;
      descriptionFallback = `${poolName} · 共 ${members.length} 款`;
    } else {
      title = `${poolName} 品牌满减券`;
      const params = rep.addonMechanicParams;
      const T = (params && params.kind === 'pool_threshold') ? params.threshold : 0;
      const D = (params && params.kind === 'pool_threshold') ? params.discount : 0;
      const lowestOrig = Math.min(...members.map(m => m.originalPrice).filter(x => x > 0));
      const computedQty = T > 0 && Number.isFinite(lowestOrig) && lowestOrig > 0
        ? Math.ceil(T / lowestOrig)
        : 0;
      displayQty = computedQty || members.length;
      descriptionFallback = T > 0 && D > 0
        ? `满 ${T} 元减 ${D} 元 · 凑齐 ${displayQty} 件即满减 · 共 ${members.length} 款`
        : `共 ${members.length} 款`;
    }

    return {
      sku: `group:${poolLabel}`,
      product_name: title,
      unit: rep.unit ?? null,
      original_price: rep.originalPrice ?? null,
      category: rep.categoryName ?? null,
      // base_activity_type:组内成员 base 可能异构(member 组里混 weekend_beer 等),
      // 保持 null,validityBadge 走 mask 兜底。
      // addon_activity_type:跟 best_label 同源,都取 rep.addonActivityType。
      // - member 组 preferred=纯会员价(addon=null)优先 → rep.addon=null → 无 QR ✅
      // - member 组成员全有 addon → preferred 空,rep 从全集挑最高省 → 用 rep.addon ✅
      // - brand 组 rep.addon 必为 brand_coupon → 贴「大牌好券」QR ✅
      base_activity_type: null,
      addon_activity_type: rep.addonActivityType ?? null,
      best_label: label,
      best_qty: displayQty,
      best_total: rep.bestBundleTotal,
      best_effective_price: rep.bestUnitPrice,
      best_saving_percent: repSavePct,
      // 单 SKU 文案模板("原价 X/罐 会员价 Y/N 罐 [到店领券 满R减S 相当于 Z/罐]"),
      // 落到 SelectedPromotion.displayText 给下游海报用;算不出时退到组级摘要。
      display_text: repDisplayText ?? descriptionFallback,
      best_valid_from: groupValidFrom,
      best_valid_to: groupValidTo,
      best_valid_dates: null,
      all_options: [{
        label,
        requiredQty: displayQty,
        totalPrice: rep.bestBundleTotal,
        effectiveUnitPrice: rep.bestUnitPrice,
        savingPercent: repSavePct,
        validFrom: groupValidFrom,
        validTo: groupValidTo,
        validDayOfWeek: groupDays,
      }],
      is_group: true,
      group_id: poolLabel,
      brand_label: poolName,
      group_members: members.map((m) => ({ sku: m.skuCode, productName: m.productName })),
      best_applies_to_skus: members.map((m) => m.skuCode),
      rep_product_name: rep.productName,
    };
  };

  // 1) member_price 组卡:按 assigned 反查实际归属此 pool 的成员
  for (const [pool, allInPool] of memberPools) {
    const actual = allInPool.filter(m => skuAssigned.get(m.skuCode)?.pool === pool
                                   && skuAssigned.get(m.skuCode)?.kind === 'member');
    if (actual.length < 2) continue;
    const card = buildGroupCard(pool, actual, 'member');
    pushTo(mapCategoryToGroup(card.category ?? ''), card);
  }

  // 2) brand_coupon 组卡:同理
  for (const [pool, allInPool] of brandPools) {
    const actual = allInPool.filter(m => skuAssigned.get(m.skuCode)?.pool === pool
                                   && skuAssigned.get(m.skuCode)?.kind === 'brand');
    if (actual.length < 2) continue;
    const card = buildGroupCard(pool, actual, 'brand');
    pushTo(mapCategoryToGroup(card.category ?? ''), card);
  }

  // 3) 单品卡:skuAssigned 里没有的才单出
  for (const p of results) {
    if (skuAssigned.has(p.skuCode)) continue;
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
