// apps/api/src/services/promo/parser/xlsx.ts
import * as XLSX from 'xlsx';
import type { PromoActivityType } from '@myj/shared';
import { normalizeSkuCode } from '../../../lib/upload-input.js';

export interface RawSheetRow {
  activityType: PromoActivityType;
  sheetRowNo: number;
  skuCode: string;
  skuNameOriginal: string;
  unit: string | null;
  originalPrice: number;
  rawMethodText: string | null;
  qtyRequired: number | null;
  promoTotalPrice: number | null;
  promoGroupCode: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  validFrom: Date;
  validTo: Date;
}

const SHEET_TYPE: Record<string, PromoActivityType> = {
  会员价: 'member_price',
  周末啤酒日: 'weekend_beer',
  品牌满减券: 'brand_coupon',
  周二会员日: 'tuesday_member',
  常规优惠券: 'regular_coupon',
};

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return XLSX.SSF.parse_date_code(v) as unknown as Date;
  return new Date(String(v));
}

function parseCategory(v: unknown): { code: string | null; name: string | null } {
  if (v == null) return { code: null, name: null };
  const s = String(v).trim();
  const m = s.match(/^(\d+)(.*)$/);
  if (m) return { code: m[1]!, name: s };
  return { code: null, name: s };
}

export function readWorkbook(buf: Buffer): {
  rows: RawSheetRow[];
  sheetWarnings: Array<{ sheet: string; row: number; reason: string }>;
} {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const rows: RawSheetRow[] = [];
  const sheetWarnings: Array<{ sheet: string; row: number; reason: string }> = [];

  for (const sheetName of wb.SheetNames) {
    const activityType = SHEET_TYPE[sheetName];
    if (!activityType) {
      sheetWarnings.push({ sheet: sheetName, row: 0, reason: `未识别 sheet: ${sheetName}` });
      continue;
    }
    const ws = wb.Sheets[sheetName]!;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    if (aoa.length < 2) continue;
    const header = (aoa[0] as unknown[]).map((c) => String(c ?? '').trim());
    const idx = (col: string) => header.indexOf(col);

    const cSku    = idx('商品代码');
    const cName   = idx('品名及规格');
    const cUnit   = idx('单位');
    const cPrice  = idx('原零售价') >= 0 ? idx('原零售价') : idx('零售价');
    const cMethod = idx('具体促销方式');
    const cQty    = idx('包含商品数');
    const cTotal  = idx('促销价');
    const cGroup  = idx('促销组');
    const cCat    = idx('大类');
    const cFrom   = idx('开始时间');
    const cTo     = idx('结束时间');

    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] as unknown[];
      if (!r || r.length === 0 || r[cSku] == null || r[cSku] === '') continue;
      const cat = cCat >= 0 ? parseCategory(r[cCat]) : { code: null, name: null };
      const origPrice = toNum(r[cPrice]);
      if (origPrice == null) {
        sheetWarnings.push({ sheet: sheetName, row: i + 1, reason: '原零售价缺失或非数值' });
        continue;
      }
      const row: RawSheetRow = {
        activityType,
        sheetRowNo: i + 1,
        skuCode: normalizeSkuCode(String(r[cSku])),
        skuNameOriginal: String(r[cName] ?? '').trim(),
        unit: cUnit >= 0 ? (r[cUnit] != null ? String(r[cUnit]).trim() : null) : null,
        originalPrice: origPrice,
        rawMethodText: cMethod >= 0 && r[cMethod] != null ? String(r[cMethod]).trim() : null,
        qtyRequired: cQty >= 0 ? toNum(r[cQty]) : null,
        promoTotalPrice: cTotal >= 0 ? toNum(r[cTotal]) : null,
        promoGroupCode: cGroup >= 0 && r[cGroup] != null ? String(r[cGroup]).trim() : null,
        categoryCode: cat.code,
        categoryName: cat.name,
        validFrom: toDate(r[cFrom]),
        validTo: toDate(r[cTo]),
      };
      rows.push(row);
    }
  }

  return { rows, sheetWarnings };
}
