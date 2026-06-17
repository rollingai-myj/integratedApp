// apps/api/src/services/promo/pricer/stacking.ts
import type { PromoActivityType, PromoMechanic, PromoMechanicParams } from '@myj/shared';

export interface PricerOffer {
  activityType: PromoActivityType;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  originalPrice: number;
  poolLabel: string | null;
  isStackable: boolean;
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
  bundleTotal: number;
  qty: number;
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
    bundleTotal: number; qty: number; unitPrice: number; savingPercent: number;
  } | null = null;

  for (const bi of bases) {
    const b = offers[bi]!;
    const baseRes = bundleTotal(b.mechanicParams, b.originalPrice);
    const candidates: Array<{ addonIdx: number | null; total: number }> = [{ addonIdx: null, total: baseRes.total }];
    for (const ai of addons) {
      const a = offers[ai]!;
      let total = baseRes.total;
      if (a.mechanic === 'percent_discount' && a.mechanicParams.kind === 'percent_discount') {
        total = baseRes.total * a.mechanicParams.pay_ratio;
      }
      // pool_threshold 不在单 sku 计算，调用方在池子层算
      candidates.push({ addonIdx: ai, total });
    }
    for (const c of candidates) {
      const unit = c.total / baseRes.qty;
      const saving = (b.originalPrice - unit) / b.originalPrice;
      if (!best || unit < best.unitPrice || (unit === best.unitPrice && best.baseIdx === bi && c.addonIdx !== null && best.addonIdx === null)) {
        best = {
          baseIdx: bi,
          addonIdx: c.addonIdx,
          bundleTotal: c.total,
          qty: baseRes.qty,
          unitPrice: unit,
          savingPercent: saving,
        };
      }
    }
  }
  return best;
}
