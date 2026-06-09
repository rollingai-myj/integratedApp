/**
 * 门店 SKU 内存缓存（保持同步 API）
 *
 * 原 repo 通过 ImportStoreDialog 把 Excel 导入后塞进 IMPORTED_CACHE。整合 app
 * 在 ShelvesAppShell 里 useQuery /api/v1/skus 拉到后调用 `setImportedStoreSkus`
 * 写入此缓存；各 page/component 仍按原同步 API `getStoreSkuData()` 读，无修改。
 */
import { type SkuRow } from './skuData';

const IMPORTED_CACHE: Record<string, SkuRow[]> = {};

export const setImportedStoreSkus = (storeId: string, rows: SkuRow[]) => {
  IMPORTED_CACHE[storeId] = rows;
};

export const getStoreSkuDataRaw = (storeId: string): SkuRow[] => {
  return IMPORTED_CACHE[storeId] ?? [];
};

export const getStoreSkuData = (storeId: string): SkuRow[] => {
  return getStoreSkuDataRaw(storeId).filter((s) => {
    const v = parseFloat(s.sales30d || '0');
    return Number.isFinite(v) && v > 0;
  });
};

export const getBenchmarkSkuData = (_storeId: string): SkuRow[] =>
  IMPORTED_CACHE['benchmark'] ?? [];

export const getBenchmarkStoreId = (_storeId: string): string => 'benchmark';

// ---- 从后端拉 SKU 并写入缓存 ---------------------------------------------

interface BackendStoreSku {
  skuCode: string;
  productName?: string;
  brand?: string | null;
  spec?: string | null;
  unit?: string | null;
  categoryPath?: string | null;
  shelfLifeDays?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  salesQty30d?: number | string | null;
  salesAmount30d?: number | string | null;
  salesQty90d?: number | string | null;
  salesAmount90d?: number | string | null;
}

function splitCategory(path: string | null | undefined): {
  majorCategory: string;
  midCategory: string;
  subCategory: string;
} {
  const parts = (path ?? '').split('/').map((s) => s.trim()).filter(Boolean);
  return {
    majorCategory: parts[0] ?? '',
    midCategory: parts[1] ?? '',
    subCategory: parts[2] ?? parts[1] ?? '',
  };
}

function backendToSkuRow(b: BackendStoreSku): SkuRow {
  const cat = splitCategory(b.categoryPath);
  return {
    majorCategory: cat.majorCategory,
    midCategory: cat.midCategory,
    subCategory: cat.subCategory,
    skuCode: b.skuCode,
    skuName: b.productName ?? b.skuCode,
    brandName: b.brand ?? '',
    spec: b.spec ?? '',
    unit: b.unit ?? '',
    createDate: '',
    sales30d: b.salesAmount30d != null ? String(b.salesAmount30d) : '0',
    salesChange30d: '0',
    salesVolume30d: b.salesQty30d != null ? String(b.salesQty30d) : '0',
    sales90d: b.salesAmount90d != null ? String(b.salesAmount90d) : undefined,
    salesVolume90d: b.salesQty90d != null ? String(b.salesQty90d) : undefined,
    shelfLifeDays: b.shelfLifeDays ?? undefined,
    height: b.heightMm != null ? Number(b.heightMm) / 10 : undefined,  // mm → cm
    width: b.widthMm != null ? Number(b.widthMm) / 10 : undefined,
    depth: b.lengthMm != null ? Number(b.lengthMm) / 10 : undefined,
  };
}

/** 拉当前 store 的全部 SKU 写入缓存。失败返回 0；上层失败时仍可渲染（空 SKU 列表） */
export async function loadStoreSkus(storeCode: string): Promise<number> {
  if (!storeCode) return 0;
  const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
  try {
    const res = await fetch(`${BASE}/api/v1/skus`, { credentials: 'include' });
    if (!res.ok) return 0;
    const data = (await res.json()) as { skus?: BackendStoreSku[] };
    const rows = (data.skus ?? []).map(backendToSkuRow);
    setImportedStoreSkus(storeCode, rows);
    return rows.length;
  } catch (err) {
    console.warn('[shelves/skuDataByStore.loadStoreSkus] failed', err);
    return 0;
  }
}
