// apps/api/src/services/promo/parser/xlsx.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbook } from './xlsx.js';

function makeWb(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('readWorkbook', () => {
  it('会员价: 10 列 → RawSheetRow 全字段', () => {
    const buf = makeWb({
      会员价: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','促销组','开始时间','结束时间'],
        ['39饼干','39080306','奥利奥87g','盒',6.5,'9.9元/任意2盒',2,9.9,23,'2026-06-15','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.activityType).toBe('member_price');
    expect(r.skuCode).toBe('39080306');
    expect(r.qtyRequired).toBe(2);
    expect(r.promoTotalPrice).toBe(9.9);
    expect(r.promoGroupCode).toBe('23');
    expect(r.categoryName).toBe('39饼干');
  });

  it('商品代码为 7 位数字时补前导 0', () => {
    const buf = makeWb({
      会员价: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','促销组','开始时间','结束时间'],
        ['39饼干',1174953,'黄鹤楼(硬8度)香烟(包)','包',20,'18元/1包',1,18,23,'2026-06-15','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.skuCode).toBe('01174953');
  });

  it('周末啤酒日: activity_type=weekend_beer', () => {
    const buf = makeWb({
      周末啤酒日: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','开始时间','结束时间'],
        ['28啤酒／预调酒','28012389','珠江纯生500ml','罐',6.5,'本品买3送1','4',19.5,'2026-06-15','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.activityType).toBe('weekend_beer');
    expect(rows[0]!.qtyRequired).toBe(4);
    expect(rows[0]!.promoGroupCode).toBeNull();
  });

  it('品牌满减券: 无大类列、无包含商品数列', () => {
    const buf = makeWb({
      品牌满减券: [
        ['商品代码','品名及规格','单位','原零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金500ml','罐',9,'百威系列\n满25减5元','2026-06-01','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.activityType).toBe('brand_coupon');
    expect(rows[0]!.categoryName).toBeNull();
    expect(rows[0]!.qtyRequired).toBeNull();
  });

  it('常规优惠券: 列名是"零售价"不是"原零售价"', () => {
    const buf = makeWb({
      常规优惠券: [
        ['商品代码','品名及规格','单位','零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金500ml','罐',9,'75%折扣券','2026-06-01','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.originalPrice).toBe(9);
    expect(rows[0]!.activityType).toBe('regular_coupon');
  });

  it('未知 sheet 名：跳过且报告 warning', () => {
    const buf = makeWb({ 未知活动: [['x'], ['y']] });
    const { rows, sheetWarnings } = readWorkbook(buf);
    expect(rows).toHaveLength(0);
    expect(sheetWarnings.some((w) => w.reason.includes('未识别 sheet'))).toBe(true);
  });
});
