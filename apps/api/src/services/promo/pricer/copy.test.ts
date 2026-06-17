import { describe, it, expect } from 'vitest';
import { buildDefaultCopy } from './copy.js';
import type { PricerOffer } from './stacking.js';

describe('buildDefaultCopy', () => {
  it('会员价 B1 + 品牌满减券', () => {
    const base: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: 2, total_price: 9.9 },
      originalPrice: 6.5, poolLabel: null, isStackable: false,
    };
    const addon: PricerOffer = {
      activityType: 'brand_coupon',
      mechanic: 'pool_threshold',
      mechanicParams: { kind: 'pool_threshold', threshold: 25, discount: 5 },
      originalPrice: 6.5, poolLabel: 'brand_coupon/百威系列', isStackable: true,
    };
    expect(buildDefaultCopy(base, addon)).toBe('会员价 2 件 9.9 元 到店领券 品牌满减券 满 25 减 5');
  });

  it('啤酒日 B4 单独', () => {
    const base: PricerOffer = {
      activityType: 'weekend_beer',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: 3, n: 1 },
      originalPrice: 6.5, poolLabel: null, isStackable: false,
    };
    expect(buildDefaultCopy(base, null)).toBe('周末啤酒日 买 3 送 1');
  });

  it('会员价 B2 + 50% 折扣券', () => {
    const base: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'nth_ratio', qty_required: 2, nth: 2, ratio: 0.5 },
      originalPrice: 6.5, poolLabel: null, isStackable: false,
    };
    const addon: PricerOffer = {
      activityType: 'tuesday_member',
      mechanic: 'percent_discount',
      mechanicParams: { kind: 'percent_discount', pay_ratio: 0.5 },
      originalPrice: 6.5, poolLabel: null, isStackable: true,
    };
    expect(buildDefaultCopy(base, addon)).toBe('会员价 第 2 件半价 到店领券 周二会员日 50% 折');
  });

  it('flat_price A 单独', () => {
    const base: PricerOffer = {
      activityType: 'regular_coupon',
      mechanic: 'flat_price',
      mechanicParams: { kind: 'flat_price', target_price: 9.9 },
      originalPrice: 14.9, poolLabel: null, isStackable: false,
    };
    expect(buildDefaultCopy(base, null)).toBe('常规优惠券 特价 9.9 元/件');
  });
});
