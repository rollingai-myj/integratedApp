import type { SkuRow } from "@/components/shelves/data/skuData";
import { isStaleSku } from "@/components/shelves/lib/staleSku";

/** 问题单品判定：滞销 / 高降幅(快速下滑) / 低销额 */
export function isProblemSku(s: SkuRow, lowSalesThreshold: number): boolean {
  if (isStaleSku(s)) return true;
  const chg = parseFloat(s.salesChange30d || "");
  if (!Number.isNaN(chg) && chg <= -0.15) return true; // 快速下滑
  const sales = parseFloat(s.sales30d || "0") || 0;
  if (sales <= lowSalesThreshold) return true;
  return false;
}

/** 返回该批 SKU 中问题单品的 skuCode 集合 */
export function problemSkuCodes(skus: SkuRow[]): Set<string> {
  // 低销额阈值：销额非零样本的 25 分位
  const sales = skus
    .map((s) => parseFloat(s.sales30d || "0") || 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const lowThreshold = sales.length ? sales[Math.floor(sales.length * 0.25)] : 0;
  const set = new Set<string>();
  for (const s of skus) if (isProblemSku(s, lowThreshold)) set.add(s.skuCode);
  return set;
}
