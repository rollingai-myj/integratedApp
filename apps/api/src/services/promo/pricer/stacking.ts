// apps/api/src/services/promo/pricer/stacking.ts
import type { PromoActivityType, PromoMechanic, PromoMechanicParams } from '@myj/shared';

export interface PricerOffer {
  activityType: PromoActivityType;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  originalPrice: number;
  poolLabel: string | null;
  isStackable: boolean;
  /** 7-bit weekday mask;用来排除 base × addon mask 不相交(交集=0)的不合法组合 */
  validWeekdayMask: number;
}

const BASE_TYPES = new Set<PromoActivityType>(['member_price', 'weekend_beer']);

function bundleTotal(p: PromoMechanicParams, original: number): { total: number; qty: number } {
  switch (p.kind) {
    case 'flat_price':       return { total: p.target_price, qty: 1 };
    case 'percent_discount': return { total: original * p.pay_ratio, qty: 1 };
    case 'pool_threshold':   return { total: original, qty: 1 };
    case 'bundle_price':
      switch (p.subtype) {
        case 'fixed_total':  return { total: p.total_price, qty: p.qty_required };
        case 'nth_ratio':    return { total: (p.qty_required - 1) * original + original * p.ratio, qty: p.qty_required };
        case 'add_extra':    return { total: original + p.add_amount, qty: p.qty_required };
        case 'buy_m_get_n':  return { total: p.m * original, qty: p.m + p.n };
      }
  }
}

export function computeBest(
  offers: PricerOffer[],
  _poolPeers: Record<string, number[]>,
): {
  baseIdx: number;
  addonIdx: number | null;
  /** base 单独的总价(不含 addon);用于"会员价 11/2罐"这一段单独展示 */
  baseTotal: number;
  /** base × addon 叠完后的总价(== baseTotal 当 addonIdx=null) */
  bundleTotal: number;
  qty: number;
  /** base 单独的折后单价(= baseTotal / qty);用于不叠券时展示 */
  baseUnitPrice: number;
  /** 叠完后的实际成交单价(= bundleTotal / qty) */
  unitPrice: number;
  savingPercent: number;
} | null {
  if (offers.length === 0) return null;
  const bases: number[] = [];
  const addons: number[] = [];
  for (let i = 0; i < offers.length; i++) {
    if (BASE_TYPES.has(offers[i]!.activityType)) bases.push(i);
    else if (offers[i]!.isStackable) addons.push(i);
    else bases.push(i);  // 非 base 且不可叠 → 也作为 base 候选（独立活动）
  }

  let best: {
    baseIdx: number; addonIdx: number | null;
    baseTotal: number; bundleTotal: number; qty: number;
    baseUnitPrice: number; unitPrice: number; savingPercent: number;
  } | null = null;

  for (const bi of bases) {
    const b = offers[bi]!;
    const baseRes = bundleTotal(b.mechanicParams, b.originalPrice);
    const candidates: Array<{ addonIdx: number | null; total: number }> = [{ addonIdx: null, total: baseRes.total }];
    for (const ai of addons) {
      const a = offers[ai]!;
      // base × addon weekday mask 交集 = 0 → 永远凑不到同一天生效,不合法组合
      if ((b.validWeekdayMask & a.validWeekdayMask) === 0) continue;
      let total = baseRes.total;
      if (a.mechanic === 'percent_discount' && a.mechanicParams.kind === 'percent_discount') {
        total = baseRes.total * a.mechanicParams.pay_ratio;
      } else if (a.mechanic === 'pool_threshold' && a.mechanicParams.kind === 'pool_threshold') {
        // 近似:假设凑单恰好达到 threshold(满 T 减 D),按每元 D/T 的比例摊到本 SKU。
        // 实际收银是池子级触发的,但 UI 要让"允许叠券"价格能直观体现出叠后更低,
        // 否则切换 mode 看不出区别 — 这跟单池满减只在池子层算的本意是不一样的,
        // 是一个有意的展示侧近似。
        const { threshold, discount } = a.mechanicParams;
        if (threshold > 0) total = baseRes.total * (1 - discount / threshold);
      }
      candidates.push({ addonIdx: ai, total });
    }
    for (const c of candidates) {
      const unit = c.total / baseRes.qty;
      const saving = (b.originalPrice - unit) / b.originalPrice;
      if (!best || unit < best.unitPrice || (unit === best.unitPrice && best.baseIdx === bi && c.addonIdx !== null && best.addonIdx === null)) {
        best = {
          baseIdx: bi,
          addonIdx: c.addonIdx,
          baseTotal: baseRes.total,
          bundleTotal: c.total,
          qty: baseRes.qty,
          baseUnitPrice: baseRes.total / baseRes.qty,
          unitPrice: unit,
          savingPercent: saving,
        };
      }
    }
  }
  return best;
}
