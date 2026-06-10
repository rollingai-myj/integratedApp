import { type SkuRow } from "@/components/shelves/data/skuData";

const DEFAULT_SHELF_LIFE_DAYS = 21;
const ON_SALE_MIN_DAYS = 28; // 上架 ≥ 4 周才算"在售"

export const getStaleThreshold = (shelfLifeDays = DEFAULT_SHELF_LIFE_DAYS): number => {
  if (shelfLifeDays <= 30) return Math.floor(30 / shelfLifeDays) * 2;
  return 2;
};

/** 30 日销量 = 数据源直接提供 */
export const getRecent30Volume = (sku: SkuRow): number => {
  return parseFloat(sku.salesVolume30d || "0");
};

export const isStaleSku = (sku: SkuRow, shelfLifeDays?: number): boolean => {
  const days = shelfLifeDays ?? sku.shelfLifeDays ?? DEFAULT_SHELF_LIFE_DAYS;
  return getRecent30Volume(sku) <= getStaleThreshold(days);
};

export const isOnSaleSku = (sku: SkuRow): boolean => {
  if (!sku.createDate) return true;
  const created = new Date(sku.createDate).getTime();
  if (isNaN(created)) return true;
  return (Date.now() - created) / 86400000 >= ON_SALE_MIN_DAYS;
};

/** 销量为空（未填/无效）的商品不计入滞销率分母 */
const hasSalesVolumeData = (s: SkuRow): boolean => {
  const raw = s.salesVolume30d;
  if (raw === undefined || raw === null || String(raw).trim() === "") return false;
  const n = parseFloat(String(raw));
  return !isNaN(n);
};

export const computeStaleRate = (skus: SkuRow[]) => {
  const onSale = skus.filter((s) => isOnSaleSku(s) && hasSalesVolumeData(s));
  if (onSale.length === 0) return { rate: 0, staleCount: 0, total: 0 };
  const stale = onSale.filter((s) => isStaleSku(s));
  return { rate: (stale.length / onSale.length) * 100, staleCount: stale.length, total: onSale.length };
};

export type StaleLevel = { label: "健康" | "预警" | "不健康"; color: "green" | "yellow" | "red" };

export const getStaleLevel = (rate: number): StaleLevel => {
  if (rate <= 15) return { label: "健康", color: "green" };
  if (rate <= 35) return { label: "预警", color: "yellow" };
  return { label: "不健康", color: "red" };
};
