// apps/api/src/services/promo/parser/index.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from './index.js';

function makeWb(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseWorkbook', () => {
  it('品牌满减券 fill-down: 第二行空话术继承第一行', () => {
    const buf = makeWb({
      品牌满减券: [
        ['商品代码','品名及规格','单位','原零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金500ml','罐',9,'百威系列\n满25减5元','2026-06-01','2026-06-30'],
        ['28051568','百威236ml',     '瓶',5,null,                  '2026-06-01','2026-06-30'],
      ],
    });
    const { rawItems, offers } = parseWorkbook(buf);
    expect(rawItems).toHaveLength(2);
    expect(rawItems[1]!.rawMethodText).toContain('满25减5');
    expect(rawItems[1]!.fillDownAnchorRow).toBe(2);
    expect(offers).toHaveLength(2);
    expect(offers[0]!.poolLabel).toBe('brand_coupon/百威系列');
    expect(offers[1]!.poolLabel).toBe('brand_coupon/百威系列');
    expect(offers[0]!.mechanic).toBe('pool_threshold');
    expect(offers[0]!.isStackable).toBe(true);
  });

  it('会员价 promo_group_code → pool_label', () => {
    const buf = makeWb({
      会员价: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','促销组','开始时间','结束时间'],
        ['39饼干','39080306','奥利奥A','盒',6.5,'9.9元/任意2盒',2,9.9,23,'2026-06-15','2026-06-30'],
        ['39饼干','39044451','奥利奥B','盒',6.5,'9.9元/任意2盒',2,9.9,23,'2026-06-15','2026-06-30'],
      ],
    });
    const { offers } = parseWorkbook(buf);
    expect(offers[0]!.poolLabel).toBe('member_price/促销组23');
    expect(offers[1]!.poolLabel).toBe('member_price/促销组23');
  });

  it('周末啤酒日: 星期掩码=五六日, buy_m_get_n 对账成功', () => {
    const buf = makeWb({
      周末啤酒日: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','开始时间','结束时间'],
        ['28啤酒','28012389','珠江500ml','罐',6.5,'本品买3送1','4',19.5,'2026-06-15','2026-06-30'],
      ],
    });
    const { offers, warnings } = parseWorkbook(buf);
    // Mon=64 Tue=32 Wed=16 Thu=8 Fri=4 Sat=2 Sun=1 → Fri+Sat+Sun = 7
    expect(offers[0]!.validWeekdayMask).toBe(7);
    expect(warnings).toHaveLength(0);
  });

  it('周末啤酒日: buy_m_get_n 对账失败 → 报告 warning 但仍入库', () => {
    const buf = makeWb({
      周末啤酒日: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','开始时间','结束时间'],
        ['28啤酒','28012389','珠江500ml','罐',6.5,'本品买3送1','4',99,'2026-06-15','2026-06-30'],
      ],
    });
    const { offers, warnings } = parseWorkbook(buf);
    expect(offers).toHaveLength(1);
    expect(warnings.some((w) => w.reason.includes('对账'))).toBe(true);
  });

  it('周二会员日: 星期掩码=仅周二（=32）', () => {
    const buf = makeWb({
      周二会员日: [
        ['商品代码','品名及规格','单位','原零售价','具体促销方式','开始时间','结束时间'],
        ['26059606','东鹏奶茶','瓶',4.5,'50%折扣券','2026-06-01','2026-06-30'],
      ],
    });
    const { offers } = parseWorkbook(buf);
    expect(offers[0]!.validWeekdayMask).toBe(32);
    expect(offers[0]!.mechanic).toBe('percent_discount');
    expect(offers[0]!.isStackable).toBe(true);
  });

  it('话术匹配失败：写 warning，offer 不写', () => {
    const buf = makeWb({
      常规优惠券: [
        ['商品代码','品名及规格','单位','零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金','罐',9,'胡说八道一通','2026-06-01','2026-06-30'],
      ],
    });
    const { rawItems, offers, warnings } = parseWorkbook(buf);
    expect(rawItems).toHaveLength(1);
    expect(offers).toHaveLength(0);
    expect(warnings.some((w) => w.reason.includes('无法识别'))).toBe(true);
  });
});
