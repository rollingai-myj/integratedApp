// apps/api/src/services/promo/parser/index.ts
import type { PromoActivityType, PromoMechanic, PromoMechanicParams } from '@myj/shared';
import { readWorkbook, type RawSheetRow } from './xlsx.js';
import { parseMechanic } from './mechanic.js';

export interface ParsedRawItem extends RawSheetRow {
  fillDownAnchorRow: number | null;
}

export interface ParsedOffer {
  rawItemSheetRowNo: number;
  activityType: PromoActivityType;
  skuCode: string;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  poolLabel: string | null;
  originalPrice: number;
  validWeekdayMask: number;
  validFrom: Date;
  validTo: Date;
  isStackable: boolean;
  parseNote: string | null;
}

export interface ParseOutput {
  rawItems: ParsedRawItem[];
  offers: ParsedOffer[];
  warnings: Array<{ sheet: string; row: number; reason: string; raw?: unknown }>;
}

// Mon=64 Tue=32 Wed=16 Thu=8 Fri=4 Sat=2 Sun=1
const MASK_ALL = 0b1111111;        // 127
const MASK_WEEKEND = 0b0000111;    // 7  (Fri+Sat+Sun)
const MASK_TUESDAY = 0b0100000;    // 32

function weekdayMask(t: PromoActivityType): number {
  if (t === 'weekend_beer') return MASK_WEEKEND;
  if (t === 'tuesday_member') return MASK_TUESDAY;
  return MASK_ALL;
}

const STACKABLE_MECHANICS = new Set<PromoMechanic>(['percent_discount', 'pool_threshold']);

const SHEET_LABEL: Record<PromoActivityType, string> = {
  member_price: 'member_price',
  weekend_beer: 'weekend_beer',
  brand_coupon: 'brand_coupon',
  tuesday_member: 'tuesday_member',
  regular_coupon: 'regular_coupon',
};

function poolLabel(row: ParsedRawItem, params: PromoMechanicParams): string | null {
  // 会员价 + 有促销组 → member_price/促销组N
  if (row.activityType === 'member_price' && row.promoGroupCode) {
    return `member_price/促销组${row.promoGroupCode}`;
  }
  // 品牌满减券 → brand_coupon/<段落名>，从 raw_method_text 第一行抽
  if (row.activityType === 'brand_coupon' && row.rawMethodText) {
    const firstLine = row.rawMethodText.split(/[\n\r]/).find((s) => s.trim() && !/满.*减/.test(s));
    if (firstLine) return `brand_coupon/${firstLine.trim()}`;
    return 'brand_coupon/未命名池';
  }
  void params;
  return null;
}

export function parseWorkbook(buf: Buffer): ParseOutput {
  const { rows, sheetWarnings } = readWorkbook(buf);
  const warnings: ParseOutput['warnings'] = [...sheetWarnings];
  const rawItems: ParsedRawItem[] = [];
  const offers: ParsedOffer[] = [];

  // fill-down 仅 brand_coupon 用
  let fillDownText: string | null = null;
  let fillDownAnchor: number | null = null;

  for (const r of rows) {
    let methodText = r.rawMethodText;
    let anchor: number | null = null;
    if (r.activityType === 'brand_coupon') {
      if (methodText) {
        fillDownText = methodText;
        fillDownAnchor = r.sheetRowNo;
        anchor = r.sheetRowNo;
      } else if (fillDownText) {
        methodText = fillDownText;
        anchor = fillDownAnchor;
      } else {
        warnings.push({ sheet: 'brand_coupon', row: r.sheetRowNo, reason: 'fill-down 段落起始为空' });
      }
    }
    const rawItem: ParsedRawItem = { ...r, rawMethodText: methodText, fillDownAnchorRow: anchor };
    rawItems.push(rawItem);

    if (!methodText) continue;
    const m = parseMechanic(methodText);
    if (!m) {
      warnings.push({ sheet: SHEET_LABEL[r.activityType], row: r.sheetRowNo, reason: `无法识别话术: ${methodText}` });
      continue;
    }

    // buy_m_get_n 对账：m*原价 ≈ 促销价?
    if (m.params.kind === 'bundle_price' && m.params.subtype === 'buy_m_get_n' && r.promoTotalPrice != null) {
      const expected = m.params.m * r.originalPrice;
      if (Math.abs(expected - r.promoTotalPrice) > 0.01) {
        warnings.push({
          sheet: SHEET_LABEL[r.activityType],
          row: r.sheetRowNo,
          reason: `买${m.params.m}送${m.params.n}对账失败: ${m.params.m}×${r.originalPrice}=${expected} 但促销价=${r.promoTotalPrice}`,
        });
      }
    }

    offers.push({
      rawItemSheetRowNo: r.sheetRowNo,
      activityType: r.activityType,
      skuCode: r.skuCode,
      mechanic: m.mechanic,
      mechanicParams: m.params,
      poolLabel: poolLabel(rawItem, m.params),
      originalPrice: r.originalPrice,
      validWeekdayMask: weekdayMask(r.activityType),
      validFrom: r.validFrom,
      validTo: r.validTo,
      isStackable: STACKABLE_MECHANICS.has(m.mechanic),
      parseNote: m.note,
    });
  }

  return { rawItems, offers, warnings };
}
