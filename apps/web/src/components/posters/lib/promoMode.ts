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
  base_activity_type?: string | null;
  addon_activity_type?: string | null;
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
  validDayOfWeek: number[] | null;
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
    validDayOfWeek: opt.validDayOfWeek ?? null,
  };
}

/**
 * 从 CategoryItem 推出"当前最佳"档显示。
 *
 * 注:promoMode 不在这里分支了 — 后端把"允许叠券"和"只用会员价"算成两条独立的
 * categories tree,Home.tsx 在外层按 mode 选 tree 后再喂给这里。所以这里只剩一份
 * "用服务端 best_*,validOnly 时退而求其次挑 all_options 里今/明仍有效的最优档"逻辑。
 *
 * mode 参数保留只为签名兼容(调用点暂未全部清理)。
 */
export function deriveBest(
  it: CategoryItemLike,
  _mode: PromoMode,
  opts?: { validOnly?: boolean },
): DerivedBest | null {
  const validOnly = !!opts?.validOnly;
  const allOptions = Array.isArray(it.all_options) ? it.all_options : [];

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
  // server best 没把 validDayOfWeek 直接挂在顶层,从 all_options[0] 取(shim 把它放那里)
  const topOpt = allOptions[0];
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
    validDayOfWeek: topOpt?.validDayOfWeek ?? null,
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

