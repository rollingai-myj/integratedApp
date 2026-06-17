import { formatPromotionDisplayText } from '@/utils/promoDisplayText';

export type PromoMode = 'stack' | 'memberOnly';

const STORAGE_KEY = 'promoMode';

export function loadPromoMode(): PromoMode {
  if (typeof window === 'undefined') return 'stack';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'memberOnly' ? 'memberOnly' : 'stack';
  } catch { return 'stack'; }
}

export function savePromoMode(m: PromoMode) {
  try { localStorage.setItem(STORAGE_KEY, m); } catch { /* ignore */ }
}

export type DealOptionLike = {
  label: string;
  requiredQty: number;
  totalPrice: number;
  effectiveUnitPrice: number;
  channel?: string;
  savingPercent: number;
  validFrom?: string | null;
  validTo?: string | null;
  validDates?: string[] | null;
  validDayOfWeek?: number[] | null;
};

export type CategoryItemLike = {
  sku: string;
  product_name: string;
  unit: string | null;
  original_price: number | null;
  category: string | null;
  best_label: string | null;
  best_qty: number | null;
  best_total: number | null;
  best_effective_price: number | null;
  best_saving_percent: number | null;
  display_text: string | null;
  best_valid_from: string | null;
  best_valid_to: string | null;
  best_valid_dates: string[] | null;
  all_options?: DealOptionLike[] | null;
};

export type DerivedBest = {
  label: string;
  qty: number;
  total: number;
  effectivePrice: number;
  savingPercent: number;
  displayText: string;
  validFrom: string | null;
  validTo: string | null;
  validDates: string[] | null;
};

/** 判断某条 option 是否今/明有效。无日期信息时视为长期有效。 */
export function isOptionValidTodayOrTomorrow(opt: {
  label?: string;
  validFrom?: string | null;
  validTo?: string | null;
  validDates?: string[] | null;
  validDayOfWeek?: number[] | null;
}): boolean {
  const todayISO = new Date().toISOString().slice(0, 10);
  const tomorrowISO = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  // 仅周几生效（如周末啤酒 3 送 1 = 周五六日）
  if (opt.validDayOfWeek && opt.validDayOfWeek.length) {
    const today = new Date().getDay();
    const tomorrow = (today + 1) % 7;
    if (!opt.validDayOfWeek.includes(today) && !opt.validDayOfWeek.includes(tomorrow)) return false;
  }
  if (opt.validDates && opt.validDates.length) {
    return opt.validDates.includes(todayISO) || opt.validDates.includes(tomorrowISO);
  }
  if ((opt.label ?? '').includes('会员日')) {
    const d = new Date().getDay();
    const dNext = (d + 1) % 7;
    return d === 2 || dNext === 2;
  }
  if (opt.validFrom && opt.validTo) {
    return opt.validFrom <= tomorrowISO && opt.validTo >= todayISO;
  }
  return true;
}

function buildDerivedFromOption(
  it: CategoryItemLike,
  opt: DealOptionLike,
): DerivedBest {
  const text = formatPromotionDisplayText({
    label: opt.label,
    totalPrice: opt.totalPrice,
    requiredQty: opt.requiredQty,
    effectiveUnitPrice: opt.effectiveUnitPrice,
    originalPrice: it.original_price,
    unit: it.unit,
    productName: it.product_name,
    fallback: it.display_text,
  }) ?? '';
  return {
    label: opt.label,
    qty: opt.requiredQty,
    total: opt.totalPrice,
    effectivePrice: opt.effectiveUnitPrice,
    savingPercent: opt.savingPercent ?? 0,
    displayText: text,
    validFrom: opt.validFrom ?? null,
    validTo: opt.validTo ?? null,
    validDates: opt.validDates ?? null,
  };
}

/**
 * 根据模式从商品的 all_options 推导出"当前最佳"。
 * - stack: 默认用服务端算好的 best_* 字段；validOnly 时若 best 今/明已过期，
 *   在 all_options 里按 savingPercent 降序挑第一条今/明有效的
 * - memberOnly: 筛选 base 为 member_price 的选项（label 以「会员价」开头，含组合如
 *   「会员价 + 满减券」「会员价 + 周二会员日」），按 effectiveUnitPrice 升序挑第一条；
 *   validOnly 时先过滤掉今/明无效的候选。注：用 startsWith 而非 includes，
 *   排除「周末啤酒日 + 周二会员日」这类 base 不是会员价但 label 含「会员日」的组合。
 * 选不到返回 null。
 */
export function deriveBest(
  it: CategoryItemLike,
  mode: PromoMode,
  opts?: { validOnly?: boolean },
): DerivedBest | null {
  const validOnly = !!opts?.validOnly;
  const allOptions = Array.isArray(it.all_options) ? it.all_options : [];

  if (mode === 'stack') {
    const serverBestOk =
      !!it.best_label && it.best_total != null && it.best_qty != null && it.best_effective_price != null;
    if (!serverBestOk) {
      if (!validOnly) return null;
      const ranked = [...allOptions]
        .filter(o => o && o.label && o.totalPrice > 0 && o.effectiveUnitPrice > 0)
        .filter(o => isOptionValidTodayOrTomorrow(o))
        .sort((a, b) => (b.savingPercent ?? 0) - (a.savingPercent ?? 0));
      const pick = ranked[0];
      return pick ? buildDerivedFromOption(it, pick) : null;
    }
    const serverBest: DerivedBest = {
      label: it.best_label!,
      qty: it.best_qty!,
      total: it.best_total!,
      effectivePrice: it.best_effective_price!,
      savingPercent: it.best_saving_percent ?? 0,
      displayText: it.display_text ?? '',
      validFrom: it.best_valid_from,
      validTo: it.best_valid_to,
      validDates: it.best_valid_dates,
    };
    if (!validOnly) return serverBest;
    if (isOptionValidTodayOrTomorrow(serverBest)) return serverBest;
    const ranked = [...allOptions]
      .filter(o => o && o.label && o.totalPrice > 0 && o.effectiveUnitPrice > 0)
      .filter(o => isOptionValidTodayOrTomorrow(o))
      .sort((a, b) => (b.savingPercent ?? 0) - (a.savingPercent ?? 0));
    const pick = ranked[0];
    return pick ? buildDerivedFromOption(it, pick) : null;
  }

  // memberOnly
  let memberCandidates = allOptions
    .filter(o => o && o.label && o.label.startsWith('会员价'))
    .filter(o => o.totalPrice > 0 && o.effectiveUnitPrice > 0);
  if (validOnly) {
    memberCandidates = memberCandidates.filter(o => isOptionValidTodayOrTomorrow(o));
  }
  memberCandidates.sort((a, b) => a.effectiveUnitPrice - b.effectiveUnitPrice);
  const pick = memberCandidates[0];
  if (!pick) return null;
  return buildDerivedFromOption(it, pick);
}

