/**
 * 门店经营 · 现状视角
 *
 * 表：store_sku_snapshots（外部导入，唯一合法写入入口；调价不写快照）
 * 视图：v_store_product_curve（同日多源去重）
 * 查询：本店在售 SKU 最新一期 + 环比（用前一期）
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export interface StoreSkuRow {
  productId: string;
  skuCode: string;
  productName: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  /** 商品尺寸（cm）；虚拟陈列图智能体输入需要 */
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  categoryPath: string | null;
  scene: number | null;
  /** 本店实际售价 */
  retailPrice: number | null;
  originalPrice: number | null;
  wholesalePrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
  stockQty: number | null;
  snapshotDate: string;
  /** 环比（上一期 → 本期，按金额）；null = 无上一期 */
  salesAmountChange30d: number | null;
  /** 同上，按销量件数 */
  salesQtyChange30d: number | null;
  /** 本店在 store_price_changes 里最后一次调价的时刻；null = 从未调过价 */
  lastPriceChangeAt: string | null;
}

export interface ListStoreSkusArgs {
  storeId: string;
  scene?: number;
  q?: string;
  productIds?: string[];
}

export async function listStoreSkus(args: ListStoreSkusArgs): Promise<StoreSkuRow[]> {
  const params: unknown[] = [args.storeId];
  const filters: string[] = [];
  if (args.scene != null) {
    params.push(args.scene);
    filters.push(`fn_category_scene(p.category_id) = $${params.length}`);
  }
  if (args.q) {
    params.push(`%${args.q}%`);
    filters.push(`(p.product_name ILIKE $${params.length} OR p.sku_code ILIKE $${params.length})`);
  }
  if (args.productIds && args.productIds.length > 0) {
    params.push(args.productIds);
    filters.push(`p.id = ANY($${params.length}::uuid[])`);
  }
  const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : '';

  // 每店每商品的两期：latest = 最近一条；prev = 倒数第二条
  // last_price_change_at 来自 store_price_changes：本店该 SKU 最后一次调价的时刻，
  // 价盘"最近调整"排序就是按它倒序。
  const sql = `
    WITH ranked AS (
      SELECT s.*,
             ROW_NUMBER() OVER (
               PARTITION BY s.product_id
               ORDER BY s.snapshot_date DESC,
                        CASE s.source WHEN 'manual' THEN 1 ELSE 2 END,
                        s.created_at DESC
             ) AS rn
        FROM store_sku_snapshots s
       WHERE s.store_id = $1
    ),
    last_change AS (
      SELECT product_id, MAX(created_at) AS last_at
        FROM store_price_changes
       WHERE store_id = $1
       GROUP BY product_id
    )
    SELECT p.id AS product_id, p.sku_code, p.product_name,
           p.brand, p.spec, p.unit,
           p.length_cm, p.width_cm, p.height_cm,
           fn_category_path(p.category_id) AS cat_path,
           fn_category_scene(p.category_id) AS scene,
           latest.retail_price, latest.original_price, latest.wholesale_price,
           latest.sales_qty_30d, latest.sales_amount_30d, latest.gross_margin_30d,
           latest.stock_qty, latest.snapshot_date,
           prev.sales_qty_30d    AS prev_qty,
           prev.sales_amount_30d AS prev_amt,
           lc.last_at            AS last_price_change_at
      FROM ranked latest
      LEFT JOIN ranked prev ON prev.product_id = latest.product_id AND prev.rn = 2
      LEFT JOIN last_change lc ON lc.product_id = latest.product_id
      JOIN hq_products p ON p.id = latest.product_id AND p.deleted_at IS NULL
     WHERE latest.rn = 1 ${whereExtra}
  ORDER BY latest.sales_amount_30d DESC NULLS LAST, p.sku_code
  `;
  const res = await query<{
    product_id: string;
    sku_code: string;
    product_name: string;
    brand: string | null;
    spec: string | null;
    unit: string | null;
    length_cm: string | null;
    width_cm: string | null;
    height_cm: string | null;
    cat_path: string | null;
    scene: number | null;
    retail_price: string | null;
    original_price: string | null;
    wholesale_price: string | null;
    sales_qty_30d: number | null;
    sales_amount_30d: string | null;
    gross_margin_30d: string | null;
    stock_qty: number | null;
    snapshot_date: string | Date;
    prev_qty: number | null;
    prev_amt: string | null;
    last_price_change_at: Date | string | null;
  }>(sql, params);

  return res.rows.map((r) => {
    const amount = r.sales_amount_30d ? Number(r.sales_amount_30d) : null;
    const prevAmt = r.prev_amt ? Number(r.prev_amt) : null;
    const qty = r.sales_qty_30d;
    const prevQty = r.prev_qty;
    return {
      productId: r.product_id,
      skuCode: r.sku_code,
      productName: r.product_name,
      brand: r.brand,
      spec: r.spec,
      unit: r.unit,
      lengthCm: r.length_cm != null ? Number(r.length_cm) : null,
      widthCm: r.width_cm != null ? Number(r.width_cm) : null,
      heightCm: r.height_cm != null ? Number(r.height_cm) : null,
      categoryPath: r.cat_path,
      scene: r.scene,
      retailPrice: r.retail_price ? Number(r.retail_price) : null,
      originalPrice: r.original_price ? Number(r.original_price) : null,
      wholesalePrice: r.wholesale_price ? Number(r.wholesale_price) : null,
      salesQty30d: qty,
      salesAmount30d: amount,
      grossMargin30d: r.gross_margin_30d ? Number(r.gross_margin_30d) : null,
      stockQty: r.stock_qty,
      // pg 把 DATE 转 JS Date（本地 0 点）；用 getFullYear/Month/Date 避免时区漂移
      snapshotDate: r.snapshot_date instanceof Date
        ? `${r.snapshot_date.getFullYear()}-${String(r.snapshot_date.getMonth() + 1).padStart(2, '0')}-${String(r.snapshot_date.getDate()).padStart(2, '0')}`
        : String(r.snapshot_date).slice(0, 10),
      salesAmountChange30d:
        amount != null && prevAmt != null && prevAmt > 0
          ? round1(((amount - prevAmt) / prevAmt) * 100)
          : null,
      salesQtyChange30d:
        qty != null && prevQty != null && prevQty > 0
          ? round1(((qty - prevQty) / prevQty) * 100)
          : null,
      lastPriceChangeAt:
        r.last_price_change_at instanceof Date
          ? r.last_price_change_at.toISOString()
          : r.last_price_change_at,
    };
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---- 整店货架组（所有场景） ----------------------------------------------

export interface ShelfGroupRow {
  storeId: string;
  scene: number;
  groupIndex: number;
  shelfType: string | null;
  widthCm: number | null;
  layerCount: number | null;
  categories: string[];
  notes: string | null;
}

export async function listAllShelfGroups(storeId: string): Promise<ShelfGroupRow[]> {
  const res = await query<{
    scene: number;
    group_index: number;
    shelf_type: string | null;
    width_cm: string | null;
    layer_count: number | null;
    categories: string[] | null;
    notes: string | null;
  }>(
    `SELECT scene, group_index, shelf_type, width_cm, layer_count, categories, notes
       FROM store_scene_shelves WHERE store_id = $1
   ORDER BY scene, group_index`,
    [storeId],
  );
  return res.rows.map((r) => ({
    storeId,
    scene: r.scene,
    groupIndex: r.group_index,
    shelfType: r.shelf_type,
    widthCm: r.width_cm ? Number(r.width_cm) : null,
    layerCount: r.layer_count,
    categories: r.categories ?? [],
    notes: r.notes,
  }));
}

export async function listSceneShelfGroups(
  storeId: string,
  scene: number,
): Promise<ShelfGroupRow[]> {
  const all = await listAllShelfGroups(storeId);
  return all.filter((g) => g.scene === scene);
}

/**
 * 整组覆盖保存（场景维度）。事务内 delete + insert。
 * categories 字段如未传，自动取场景下 level1 品类名（store_scene_shelves.categories 仍是
 * "本组承载品类"，但前端不再询问，故由服务端推导）。
 */
export async function replaceSceneShelfGroups(
  storeId: string,
  scene: number,
  groups: Array<{
    shelfType?: string | null;
    widthCm?: number | null;
    layerCount?: number | null;
    categories?: string[] | null;
    notes?: string | null;
  }>,
): Promise<ShelfGroupRow[]> {
  const sceneCategoriesRes = await query<{ name: string }>(
    `SELECT category_name AS name
       FROM hq_categories
      WHERE level = 1 AND is_active
        AND parent_id = (SELECT id FROM hq_categories WHERE level = 0 AND scene = $1)
   ORDER BY display_order`,
    [scene],
  );
  const fallbackCategories = sceneCategoriesRes.rows.map((r) => r.name);

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM store_scene_shelves WHERE store_id = $1 AND scene = $2`,
      [storeId, scene],
    );
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      await client.query(
        `INSERT INTO store_scene_shelves
          (store_id, scene, group_index, shelf_type, width_cm, layer_count, categories, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)`,
        [
          storeId, scene, i,
          g.shelfType ?? '标准货架',
          g.widthCm ?? null,
          g.layerCount ?? null,
          g.categories && g.categories.length > 0 ? g.categories : fallbackCategories,
          g.notes ?? null,
        ],
      );
    }
  });
  return listSceneShelfGroups(storeId, scene);
}

/**
 * 导入门店销售快照（超管，Excel/ERP）。每行 (product_id, snapshot_date, source) UQ。
 * 已存在则 UPDATE 各数值列。返回统计。
 */
export interface SnapshotImportRow {
  skuCode: string;
  snapshotDate: string;
  retailPrice?: number | null;
  originalPrice?: number | null;
  wholesalePrice?: number | null;
  salesQty30d?: number | null;
  salesAmount30d?: number | null;
  salesQty90d?: number | null;
  salesAmount90d?: number | null;
  grossMargin30d?: number | null;
  stockQty?: number | null;
}

export async function importStoreSnapshots(
  storeId: string,
  rows: SnapshotImportRow[],
  importedBy: string,
): Promise<{ inserted: number; updated: number; skipped: number; warnings: string[] }> {
  if (rows.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '导入行不能为空');
  }
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];

  await withTransaction(async (client) => {
    for (const r of rows) {
      const prod = await client.query<{ id: string }>(
        `SELECT id FROM hq_products WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
        [r.skuCode],
      );
      const productId = prod.rows[0]?.id;
      if (!productId) {
        skipped++;
        warnings.push(`SKU ${r.skuCode} 未在商品主数据中，跳过`);
        continue;
      }
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM store_sku_snapshots
          WHERE store_id = $1 AND product_id = $2 AND snapshot_date = $3 AND source = 'manual'
          LIMIT 1`,
        [storeId, productId, r.snapshotDate],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE store_sku_snapshots
              SET retail_price = $1, original_price = $2, wholesale_price = $3,
                  sales_qty_30d = $4, sales_amount_30d = $5,
                  sales_qty_90d = $6, sales_amount_90d = $7,
                  gross_margin_30d = $8, stock_qty = $9, imported_by = $10
            WHERE id = $11`,
          [
            r.retailPrice ?? null, r.originalPrice ?? null, r.wholesalePrice ?? null,
            r.salesQty30d ?? null, r.salesAmount30d ?? null,
            r.salesQty90d ?? null, r.salesAmount90d ?? null,
            r.grossMargin30d ?? null, r.stockQty ?? null, importedBy,
            existing.rows[0].id,
          ],
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO store_sku_snapshots
             (store_id, product_id, sku_code, snapshot_date,
              retail_price, original_price, wholesale_price,
              sales_qty_30d, sales_amount_30d, sales_qty_90d, sales_amount_90d,
              gross_margin_30d, stock_qty, source, imported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'manual', $14)`,
          [
            storeId, productId, r.skuCode, r.snapshotDate,
            r.retailPrice ?? null, r.originalPrice ?? null, r.wholesalePrice ?? null,
            r.salesQty30d ?? null, r.salesAmount30d ?? null,
            r.salesQty90d ?? null, r.salesAmount90d ?? null,
            r.grossMargin30d ?? null, r.stockQty ?? null, importedBy,
          ],
        );
        inserted++;
      }
    }
  });
  return { inserted, updated, skipped, warnings };
}
