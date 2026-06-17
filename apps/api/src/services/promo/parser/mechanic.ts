// apps/api/src/services/promo/parser/mechanic.ts
import type { PromoMechanic, PromoMechanicParams } from '@myj/shared';

export interface MechanicMatch {
  mechanic: PromoMechanic;
  params: PromoMechanicParams;
  note: string;
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
function cnDigit(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return CN_DIGITS[s] ?? null;
}

const PATTERNS: Array<{ name: string; test: (t: string) => MechanicMatch | null }> = [
  // pool_threshold: 满 X 减 Y 元（最先匹配，话术里含"满...减"就一定是这一类）
  {
    name: 'pool_threshold',
    test: (t) => {
      const m = t.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/);
      if (!m) return null;
      return {
        mechanic: 'pool_threshold',
        params: { kind: 'pool_threshold', threshold: parseFloat(m[1]!), discount: parseFloat(m[2]!) },
        note: m[0]!,
      };
    },
  },
  // percent_discount: X% 折扣券
  {
    name: 'percent_discount',
    test: (t) => {
      const m = t.match(/(\d+)\s*%\s*折扣券/);
      if (!m) return null;
      return {
        mechanic: 'percent_discount',
        params: { kind: 'percent_discount', pay_ratio: parseInt(m[1]!, 10) / 100 },
        note: m[0]!,
      };
    },
  },
  // bundle buy_m_get_n: 买 M 送 N / 本品买 M 送 N
  {
    name: 'buy_m_get_n',
    test: (t) => {
      const m = t.match(/(?:本品)?买\s*([一二两三四五\d]+)\s*送\s*([一二两三四五\d]+)/);
      if (!m) return null;
      const M = cnDigit(m[1]!); const N = cnDigit(m[2]!);
      if (M == null || N == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: M, n: N },
        note: m[0]!,
      };
    },
  },
  // bundle nth_ratio: 第N件半价 / 本品第N支半价 / 任意第N瓶半价
  {
    name: 'nth_ratio',
    test: (t) => {
      const m = t.match(/(?:本品|任意)?第\s*([一二两三四五\d]+)\s*[支瓶包盒袋件个]半价/);
      if (!m) return null;
      const k = cnDigit(m[1]!);
      if (k == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'nth_ratio', qty_required: k, nth: k, ratio: 0.5 },
        note: m[0]!,
      };
    },
  },
  // bundle add_extra: 加 ΔY 元多任意 1 件 / 加 ΔY 元多 1 件
  {
    name: 'add_extra',
    test: (t) => {
      const m = t.match(/加\s*(\d+(?:\.\d+)?)\s*元多(?:任意)?\s*([一二两三四五\d]+)\s*[支瓶包盒袋件个]/);
      if (!m) return null;
      const add = parseFloat(m[1]!); const more = cnDigit(m[2]!);
      if (more == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'add_extra', qty_required: 1 + more, add_amount: add },
        note: m[0]!,
      };
    },
  },
  // bundle fixed_total: N件Y元 / Y元/任意N件 / N件特价Y元
  {
    name: 'fixed_total_qty_first',
    test: (t) => {
      // "两件特价9元" "3件特价9元" "4件特价24元" "2件特价5.2元"
      const m = t.match(/([一二两三四五\d]+)\s*件特价\s*(\d+(?:\.\d+)?)\s*元/);
      if (!m) return null;
      const q = cnDigit(m[1]!);
      if (q == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: q, total_price: parseFloat(m[2]!) },
        note: m[0]!,
      };
    },
  },
  {
    name: 'fixed_total_price_first',
    test: (t) => {
      // "9.9元/任意2盒" "8元/任意2瓶" "15元/任意2罐"
      const m = t.match(/(\d+(?:\.\d+)?)\s*元\s*\/\s*(?:任意)?\s*([一二两三四五\d]+)\s*[支瓶包盒袋件个罐]/);
      if (!m) return null;
      const q = cnDigit(m[2]!);
      if (q == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: q, total_price: parseFloat(m[1]!) },
        note: m[0]!,
      };
    },
  },
  // flat_price: X元抢 / 特价 X 元/件
  {
    name: 'flat_price',
    test: (t) => {
      let m = t.match(/(\d+(?:\.\d+)?)\s*元抢/);
      if (m) return {
        mechanic: 'flat_price',
        params: { kind: 'flat_price', target_price: parseFloat(m[1]!) },
        note: m[0]!,
      };
      m = t.match(/特价\s*(\d+(?:\.\d+)?)\s*元/);
      if (m) return {
        mechanic: 'flat_price',
        params: { kind: 'flat_price', target_price: parseFloat(m[1]!) },
        note: m[0]!,
      };
      return null;
    },
  },
];

export function parseMechanic(text: string): MechanicMatch | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  for (const p of PATTERNS) {
    const r = p.test(cleaned);
    if (r) return r;
  }
  return null;
}
