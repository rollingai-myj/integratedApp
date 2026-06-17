import type { PromoActivityType, PromoMechanicParams } from '@myj/shared';
import type { PricerOffer } from './stacking.js';

const TYPE_LABEL: Record<PromoActivityType, string> = {
  member_price: '会员价',
  weekend_beer: '周末啤酒日',
  brand_coupon: '品牌满减券',
  tuesday_member: '周二会员日',
  regular_coupon: '常规优惠券',
};

function fmtBase(t: PromoActivityType, p: PromoMechanicParams): string {
  const L = TYPE_LABEL[t];
  switch (p.kind) {
    case 'flat_price':       return `${L} 特价 ${p.target_price} 元/件`;
    case 'bundle_price':
      switch (p.subtype) {
        case 'fixed_total':  return `${L} ${p.qty_required} 件 ${p.total_price} 元`;
        case 'nth_ratio':    return `${L} 第 ${p.nth} 件半价`;
        case 'add_extra':    return `${L} 加 ${p.add_amount} 元多 1 件`;
        case 'buy_m_get_n':  return `${L} 买 ${p.m} 送 ${p.n}`;
      }
    case 'percent_discount': return `${L} ${Math.round(p.pay_ratio * 100)}% 折`;
    case 'pool_threshold':   return `${L} 满 ${p.threshold} 减 ${p.discount}`;
  }
}

function fmtAddon(t: PromoActivityType, p: PromoMechanicParams): string {
  const L = TYPE_LABEL[t];
  if (p.kind === 'percent_discount') return `${L} ${Math.round(p.pay_ratio * 100)}% 折`;
  if (p.kind === 'pool_threshold')   return `${L} 满 ${p.threshold} 减 ${p.discount}`;
  return `${L}`;  // 不应到这里——非可叠 add-on
}

export function buildDefaultCopy(base: PricerOffer, addon: PricerOffer | null): string {
  const baseStr = fmtBase(base.activityType, base.mechanicParams);
  if (!addon) return baseStr;
  return `${baseStr} 到店领券 ${fmtAddon(addon.activityType, addon.mechanicParams)}`;
}
