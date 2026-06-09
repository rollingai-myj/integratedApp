import { apiFetch } from "@/components/shelves/lib/api-client";
import type { SkuRow } from "@/components/shelves/data/skuData";
import { padSkuCode } from "@/components/shelves/lib/skuCode";

export interface ImportedStore {
  store_id: string; store_label: string; address?: string;
}

export async function listImportedStores(): Promise<ImportedStore[]> {
  const res = await apiFetch('/api/skus/stores');
  return ((await res.json()) ?? []) as ImportedStore[];
}

export async function getImportedStoreSkusRaw(storeId: string): Promise<SkuRow[]> {
  const res = await apiFetch(`/api/skus/store-skus?storeId=${encodeURIComponent(storeId)}`);
  const data = ((await res.json()) ?? []) as any[];
  return data.map((r) => ({
    majorCategoryCode: r.major_category_code || undefined,
    majorCategory: r.major_category || "",
    midCategoryCode: r.mid_category_code || undefined,
    midCategory: r.mid_category || undefined,
    subCategoryCode: r.sub_category_code || undefined,
    subCategory: r.sub_category || "",
    skuCode: padSkuCode(r.sku_code),
    skuName: r.sku_name || "",
    brandName: r.brand_name || "",
    spec: r.spec || "",
    unit: r.unit || undefined,
    createDate: r.create_date ? String(r.create_date).slice(0, 10) : "",
    sales30d: r.sales_amt_30d != null ? String(r.sales_amt_30d) : "",
    salesChange30d: r.psd_chg_30d != null ? String(r.psd_chg_30d) : "",
    salesVolume30d: r.sales_qty_30d != null ? String(r.sales_qty_30d) : "",
    sales90d: r.sales_amt_90d != null ? String(r.sales_amt_90d) : "0",
    salesChange90d: r.psd_chg_90d != null ? String(r.psd_chg_90d) : "",
    salesVolume90d: r.sales_qty_90d != null ? String(r.sales_qty_90d) : "0",
    shelfLifeDays: r.shelf_life_days ?? undefined,
    height: r.height != null ? Number(r.height) : undefined,
    width: r.width != null ? Number(r.width) : undefined,
    depth: r.depth != null ? Number(r.depth) : undefined,
  }));
}

export async function getImportedStoreSkus(storeId: string): Promise<SkuRow[]> {
  const all = await getImportedStoreSkusRaw(storeId);
  return all.filter((s) => { const v = parseFloat(s.sales30d || "0"); return Number.isFinite(v) && v > 0; });
}

export interface ImportRow {
  storeId: string;
  major_category_code: string; major_category: string;
  mid_category_code: string; mid_category: string;
  sub_category_code: string; sub_category: string;
  sku_code: string; sku_name: string; brand_name: string;
  spec: string; unit: string; shelf_life_days: number | null;
  create_date: string | null;
  sales_30d: number; sales_change_30d: number | null; sales_volume_30d: number;
  sales_90d: number; sales_change_90d: number | null; sales_volume_90d: number;
}

export function parseExcelRows(json: any[]): ImportRow[] {
  return json.map((r) => {
    const display = String(r["门店编号"] ?? "").trim();
    return {
      storeId: display,
      major_category_code: String(r["大类编号"] ?? "").trim(),
      major_category: String(r["大类名称"] ?? "").trim(),
      mid_category_code: String(r["中类编号"] ?? "").trim(),
      mid_category: String(r["中类名称"] ?? "").trim(),
      sub_category_code: String(r["小类编号"] ?? "").trim(),
      sub_category: String(r["小类名称"] ?? "").trim(),
      sku_code: padSkuCode(r["商品编号"]),
      sku_name: String(r["商品名称"] ?? "").trim(),
      brand_name: String(r["品牌"] ?? "").trim(),
      spec: String(r["规格"] ?? "").trim(),
      unit: String(r["计量单位"] ?? "").trim(),
      shelf_life_days: r["保质期"] != null && r["保质期"] !== "" ? Number(r["保质期"]) : null,
      create_date: r["createdate"] ? new Date(r["createdate"]).toISOString() : null,
      sales_30d: Number(r["30日销售额"] ?? 0) || 0,
      sales_change_30d: r["30日销售额环比"] != null && r["30日销售额环比"] !== "" ? Number(r["30日销售额环比"]) : null,
      sales_volume_30d: Number(r["30日销量"] ?? 0) || 0,
      sales_90d: Number(r["90日销售额"] ?? 0) || 0,
      sales_change_90d: r["90日销售额环比"] != null && r["90日销售额环比"] !== "" ? Number(r["90日销售额环比"]) : null,
      sales_volume_90d: Number(r["90日销量"] ?? 0) || 0,
    };
  });
}

export async function createImportedStores(opts: {
  storeMeta: { storeId: string; storeLabel: string }[];
  skuRows: ImportRow[];
}): Promise<{ created: number; skipped: string[] }> {
  const { storeMeta, skuRows } = opts;

  const importedRes = await apiFetch('/api/skus/stores');
  const existingImported = new Set(((await importedRes.json()) as any[]).map((r) => r.store_id));

  const skipped: string[] = [];
  const toCreate = storeMeta.filter((m) => {
    if (existingImported.has(m.storeId)) {
      skipped.push(m.storeId); return false;
    }
    return true;
  });
  if (toCreate.length === 0) return { created: 0, skipped };

  for (const m of toCreate) {
    await apiFetch('/api/skus/stores', {
      method: 'POST',
      body: JSON.stringify({ store_id: m.storeId, store_label: m.storeLabel }),
    });
  }

  const allowed = new Set(toCreate.map((m) => m.storeId));
  const skuPayload = skuRows.filter((r) => allowed.has(r.storeId)).map((r) => ({
    store_id: r.storeId,
    major_category_code: r.major_category_code, major_category: r.major_category,
    mid_category_code: r.mid_category_code, mid_category: r.mid_category,
    sub_category_code: r.sub_category_code, sub_category: r.sub_category,
    sku_code: r.sku_code, sku_name: r.sku_name, brand_name: r.brand_name,
    spec: r.spec, unit: r.unit, shelf_life_days: r.shelf_life_days,
    create_date: r.create_date,
    sales_30d: r.sales_30d, sales_change_30d: r.sales_change_30d, sales_volume_30d: r.sales_volume_30d,
    sales_90d: r.sales_90d, sales_change_90d: r.sales_change_90d, sales_volume_90d: r.sales_volume_90d,
  }));

  if (skuPayload.length > 0) {
    await apiFetch('/api/skus/store-skus/batch', {
      method: 'POST',
      body: JSON.stringify({ skus: skuPayload }),
    });
  }

  for (const m of toCreate) {
    await apiFetch('/api/accounts/create-imported', {
      method: 'POST',
      body: JSON.stringify({ storeId: m.storeId, storeLabel: m.storeLabel }),
    });
  }

  return { created: toCreate.length, skipped };
}
