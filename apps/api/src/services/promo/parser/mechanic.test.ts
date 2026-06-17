// apps/api/src/services/promo/parser/mechanic.test.ts
import { describe, it, expect } from 'vitest';
import { parseMechanic } from './mechanic.js';

describe('parseMechanic', () => {
  it.each([
    ['0.1元抢', 0.1],
    ['9.9元抢', 9.9],
    ['特价9.9元/瓶', 9.9],
    ['16.9元抢', 16.9],
  ])('flat_price: %s → target_price=%f', (txt, price) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('flat_price');
    expect(m.params).toEqual({ kind: 'flat_price', target_price: price });
  });

  it.each([
    ['9.9元/任意2盒', 2, 9.9],
    ['8元/任意2瓶', 2, 8],
    ['两件特价9元', 2, 9],
    ['3件特价9元', 3, 9],
    ['4件特价24元', 4, 24],
    ['2件特价5.2元', 2, 5.2],
  ])('bundle fixed_total: %s', (txt, qty, total) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('bundle_price');
    expect(m.params).toMatchObject({ subtype: 'fixed_total', qty_required: qty, total_price: total });
  });

  it.each(['本品第2支半价', '任意第2瓶半价', '第2包半价', '任意第2袋半价'])(
    'bundle nth_ratio: %s',
    (txt) => {
      const m = parseMechanic(txt)!;
      expect(m.params).toMatchObject({ subtype: 'nth_ratio', qty_required: 2, nth: 2, ratio: 0.5 });
    },
  );

  it.each([
    ['加1元多1包', 2, 1],
    ['加2元多任意1瓶', 2, 2],
    ['加1元多任意1瓶', 2, 1],
  ])('bundle add_extra: %s', (txt, qty, add) => {
    const m = parseMechanic(txt)!;
    expect(m.params).toMatchObject({ subtype: 'add_extra', qty_required: qty, add_amount: add });
  });

  it('bundle buy_m_get_n: 本品买3送1', () => {
    const m = parseMechanic('本品买3送1')!;
    expect(m.params).toMatchObject({ subtype: 'buy_m_get_n', m: 3, n: 1 });
  });

  it('bundle buy_m_get_n: 买一送一', () => {
    const m = parseMechanic('买一送一')!;
    expect(m.params).toMatchObject({ subtype: 'buy_m_get_n', m: 1, n: 1 });
  });

  it.each([
    ['50%折扣券', 0.5],
    ['75%折扣券', 0.75],
  ])('percent_discount: %s', (txt, ratio) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('percent_discount');
    expect(m.params).toEqual({ kind: 'percent_discount', pay_ratio: ratio });
  });

  it.each([
    ['百威系列\n满25减5元', 25, 5],
    ['满15减3元', 15, 3],
    ['怡宝水 \n满59减15元', 59, 15],
  ])('pool_threshold: %s', (txt, thr, disc) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('pool_threshold');
    expect(m.params).toEqual({ kind: 'pool_threshold', threshold: thr, discount: disc });
  });

  it('返回 null：不可识别', () => {
    expect(parseMechanic('hello world')).toBeNull();
  });
});
