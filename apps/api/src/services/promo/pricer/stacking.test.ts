// apps/api/src/services/promo/pricer/stacking.test.ts
import { describe, it, expect } from 'vitest';
import { computeBest, type PricerOffer } from './stacking.js';

const baseMember: PricerOffer = {
  activityType: 'member_price',
  mechanic: 'bundle_price',
  mechanicParams: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: 2, total_price: 9.9 },
  originalPrice: 6.5,
  poolLabel: 'member_price/促销组23',
  isStackable: false, validWeekdayMask: 127,
};

describe('computeBest', () => {
  it('单 base (member_price B1)', () => {
    const r = computeBest([baseMember], {})!;
    expect(r.bundleTotal).toBe(9.9);
    expect(r.qty).toBe(2);
    expect(r.unitPrice).toBeCloseTo(4.95);
    expect(r.savingPercent).toBeCloseTo((6.5 - 4.95) / 6.5);
  });

  it('B base + C add-on：套餐总价 ×0.5', () => {
    const addon: PricerOffer = {
      activityType: 'tuesday_member',
      mechanic: 'percent_discount',
      mechanicParams: { kind: 'percent_discount', pay_ratio: 0.5 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: true, validWeekdayMask: 127,
    };
    const r = computeBest([baseMember, addon], {})!;
    expect(r.addonIdx).toBe(1);
    expect(r.bundleTotal).toBeCloseTo(9.9 * 0.5);
  });

  it('B base + D add-on：按每元 D/T 比例摊到单 sku(满25减5 = 20% off)', () => {
    const addon: PricerOffer = {
      activityType: 'brand_coupon',
      mechanic: 'pool_threshold',
      mechanicParams: { kind: 'pool_threshold', threshold: 25, discount: 5 },
      originalPrice: 6.5,
      poolLabel: 'brand_coupon/百威系列',
      isStackable: true, validWeekdayMask: 127,
    };
    const r = computeBest([baseMember, addon], {})!;
    expect(r.addonIdx).toBe(1);
    // 9.9 × (1 - 5/25) = 9.9 × 0.8 = 7.92
    expect(r.bundleTotal).toBeCloseTo(7.92);
  });

  it('两个 base 候选: 会员价 (B1 总价 9.9 / 2 件) vs 啤酒日 (B4 买3送1)', () => {
    const beer: PricerOffer = {
      activityType: 'weekend_beer',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: 3, n: 1 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: false, validWeekdayMask: 127,
    };
    const r = computeBest([baseMember, beer], {})!;
    // 会员价单价摊销 = 4.95；啤酒日单价摊销 = (3*6.5)/4 = 4.875
    expect(r.baseIdx).toBe(1);  // 啤酒日略胜
    expect(r.unitPrice).toBeCloseTo(4.875);
  });

  it('flat_price base 无 add-on', () => {
    const flat: PricerOffer = {
      activityType: 'regular_coupon',
      mechanic: 'flat_price',
      mechanicParams: { kind: 'flat_price', target_price: 6.9 },
      originalPrice: 10,
      poolLabel: null,
      isStackable: false, validWeekdayMask: 127,
    };
    const r = computeBest([flat], {})!;
    expect(r.bundleTotal).toBe(6.9);
    expect(r.qty).toBe(1);
    expect(r.unitPrice).toBe(6.9);
  });

  it('B2 nth_ratio 本品: 单价 6.5 → 总价 = 6.5 + 6.5*0.5 = 9.75', () => {
    const o: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'nth_ratio', qty_required: 2, nth: 2, ratio: 0.5 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: false, validWeekdayMask: 127,
    };
    const r = computeBest([o], {})!;
    expect(r.bundleTotal).toBeCloseTo(9.75);
  });

  it('B3 add_extra: 单价 5 + 加 1 → 总价 6', () => {
    const o: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'add_extra', qty_required: 2, add_amount: 1 },
      originalPrice: 5,
      poolLabel: null,
      isStackable: false, validWeekdayMask: 127,
    };
    const r = computeBest([o], {})!;
    expect(r.bundleTotal).toBe(6);
  });

  it('B4 buy_m_get_n: 买3送1, 总价 = 3×6.5 = 19.5, qty=4', () => {
    const o: PricerOffer = {
      activityType: 'weekend_beer',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: 3, n: 1 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: false, validWeekdayMask: 127,
    };
    const r = computeBest([o], {})!;
    expect(r.bundleTotal).toBe(19.5);
    expect(r.qty).toBe(4);
  });

  it('空 → null', () => {
    expect(computeBest([], {})).toBeNull();
  });
});
