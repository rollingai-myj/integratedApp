/**
 * 门店经营 · 现状视角
 *
 * 表：store_sku_snapshots（外部导入唯一合法入口；V027 起价格列只剩 retail_price）
 * 主数据：hq_products（wholesale_price JOIN 进 SKU 头部）
 * 查询：本店在售 SKU 最新一期 + 环比（用前一期）
 *
 * V027 起：
 *   - `originalPrice` 字段被移除（snapshot 不再有 original_price）
 *   - `wholesalePrice` 改从 `hq_products.wholesale_price` JOIN（不再来自 snapshot）
 *   - `lastPriceChangeAt` 改用 LAG 窗口函数从 snapshot 时间序列推导
 *     （= 最近一次 retail_price != lag(retail_price) 所在的 snapshot_date）
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
  /** 大/中/小类名（按 category_id 走 parent_id 链回溯，避免名字串拆分串场景） */
  categoryL1Name: string | null;
  categoryL2Name: string | null;
  categoryL3Name: string | null;
  scene: number | null;
  /** 本期实际售价（snapshot.retail_price，V027 起 snapshot 唯一价格列） */
  retailPrice: number | null;
  /** 批发价（hq_products.wholesale_price，全期同值；V027 起从主数据 JOIN，不再来自 snapshot） */
  wholesalePrice: number | null;
  salesQty30d: number | null;
  /** 近 30 日真实销售额(原 salesAmount30d, V031 起对齐 ERP 字段 sales_realamt_30d 改名) */
  salesRealamt30d: number | null;
  stockQty: number | null;
  snapshotDate: string;
  /** 近 30 日 PSD 销售环比 %; V031 起直接读 snapshot.psd_hb_30d (ERP 灌入), 不再从相邻两期 LAG 自算 */
  psdHb30d: number | null;
  /** 近 90 日 PSD 销售环比 % */
  psdHb90d: number | null;
  /** 销量(件数)环比 %; 仍由后端从两期 sales_qty_30d 自算 — ERP 未单独导销量环比 */
  salesQtyChange30d: number | null;
  /** 本店该 SKU 最近一次实际调价所在的 snapshot_date（V027 起从 retail_price 时间序列推导，
   *  不再读 store_price_changes）；null = 时间窗内 retail 未跳变 */
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

  // V027：
  //   - 价格列只取 retail_price；批发价 JOIN hq_products
  //   - "上次调价时间"改用 LAG 窗口函数从 snapshot 序列推导：
  //     last_price_change_at = MAX(snapshot_date) WHERE retail_price IS DISTINCT FROM lag(retail_price)
  const sql = `
    WITH dedup AS (
      SELECT s.store_id, s.product_id, s.snapshot_date, s.retail_price,
             s.sales_qty_30d, s.sales_realamt_30d, s.psd_hb_30d, s.psd_hb_90d, s.stock_qty,
             ROW_NUMBER() OVER (
               PARTITION BY s.store_id, s.product_id, s.snapshot_date
               ORDER BY CASE s.source WHEN 'manual' THEN 1 ELSE 2 END, s.created_at DESC
             ) AS rn_day
        FROM store_sku_snapshots s
       WHERE s.store_id = $1
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY product_id ORDER BY snapshot_date DESC
             ) AS rn
        FROM dedup WHERE rn_day = 1
    ),
    diffs AS (
      SELECT product_id, snapshot_date, retail_price,
             LAG(retail_price) OVER (
               PARTITION BY product_id ORDER BY snapshot_date
             ) AS prev_retail
        FROM dedup WHERE rn_day = 1
    ),
    last_change AS (
      SELECT product_id, MAX(snapshot_date) AS last_date
        FROM diffs
       WHERE prev_retail IS NOT NULL AND retail_price IS DISTINCT FROM prev_retail
       GROUP BY product_id
    )
    SELECT p.id AS product_id, p.sku_code, p.product_name,
           p.brand, p.spec, p.unit,
           p.length_cm, p.width_cm, p.height_cm,
           p.wholesale_price,
           fn_category_path(p.category_id) AS cat_path,
           fn_category_ancestor_name(p.category_id, 1::smallint) AS cat_l1,
           fn_category_ancestor_name(p.category_id, 2::smallint) AS cat_l2,
           fn_category_ancestor_name(p.category_id, 3::smallint) AS cat_l3,
           fn_category_scene(p.category_id) AS scene,
           latest.retail_price,
           latest.sales_qty_30d, latest.sales_realamt_30d,
           latest.psd_hb_30d, latest.psd_hb_90d,
           latest.stock_qty, latest.snapshot_date,
           prev.sales_qty_30d AS prev_qty,
           lc.last_date       AS last_price_change_at
      FROM ranked latest
      LEFT JOIN ranked prev ON prev.product_id = latest.product_id AND prev.rn = 2
      LEFT JOIN last_change lc ON lc.product_id = latest.product_id
      JOIN hq_products p ON p.id = latest.product_id AND p.deleted_at IS NULL
     WHERE latest.rn = 1 ${whereExtra}
  ORDER BY latest.sales_realamt_30d DESC NULLS LAST, p.sku_code
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
    wholesale_price: string | null;
    cat_path: string | null;
    cat_l1: string | null;
    cat_l2: string | null;
    cat_l3: string | null;
    scene: number | null;
    retail_price: string | null;
    sales_qty_30d: number | null;
    sales_realamt_30d: string | null;
    psd_hb_30d: string | null;
    psd_hb_90d: string | null;
    stock_qty: number | null;
    snapshot_date: string | Date;
    prev_qty: number | null;
    last_price_change_at: Date | string | null;
  }>(sql, params);

  return res.rows.map((r) => {
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
      categoryL1Name: r.cat_l1,
      categoryL2Name: r.cat_l2,
      categoryL3Name: r.cat_l3,
      scene: r.scene,
      retailPrice: r.retail_price ? Number(r.retail_price) : null,
      wholesalePrice: r.wholesale_price ? Number(r.wholesale_price) : null,
      salesQty30d: qty,
      salesRealamt30d: r.sales_realamt_30d ? Number(r.sales_realamt_30d) : null,
      stockQty: r.stock_qty,
      // pg 把 DATE 转 JS Date（本地 0 点）；用 getFullYear/Month/Date 避免时区漂移
      snapshotDate: r.snapshot_date instanceof Date
        ? `${r.snapshot_date.getFullYear()}-${String(r.snapshot_date.getMonth() + 1).padStart(2, '0')}-${String(r.snapshot_date.getDate()).padStart(2, '0')}`
        : String(r.snapshot_date).slice(0, 10),
      psdHb30d: r.psd_hb_30d != null ? Number(r.psd_hb_30d) : null,
      psdHb90d: r.psd_hb_90d != null ? Number(r.psd_hb_90d) : null,
      salesQtyChange30d:
        qty != null && prevQty != null && prevQty > 0
          ? round1(((qty - prevQty) / prevQty) * 100)
          : null,
      // V027：来源改成 snapshot_date（DATE），pg 把 DATE 转 Date 实例；前端按 YYYY-MM-DD 渲染
      lastPriceChangeAt:
        r.last_price_change_at instanceof Date
          ? `${r.last_price_change_at.getFullYear()}-${String(r.last_price_change_at.getMonth() + 1).padStart(2, '0')}-${String(r.last_price_change_at.getDate()).padStart(2, '0')}`
          : r.last_price_change_at
            ? String(r.last_price_change_at).slice(0, 10)
            : null,
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
  /** 本期实际售价（V027 起 snapshot 唯一价格列） */
  retailPrice?: number | null;
  salesQty30d?: number | null;
  /** 近 30 日真实销售额(V031 起对齐 ERP, 原 salesAmount30d 改名) */
  salesRealamt30d?: number | null;
  salesQty90d?: number | null;
  salesRealamt90d?: number | null;
  /** 近 30 日 PSD 销售环比(%); ERP 直接灌入 */
  psdHb30d?: number | null;
  psdHb90d?: number | null;
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
              SET retail_price = $1,
                  sales_qty_30d = $2, sales_realamt_30d = $3,
                  sales_qty_90d = $4, sales_realamt_90d = $5,
                  psd_hb_30d = $6, psd_hb_90d = $7,
                  stock_qty = $8, imported_by = $9
            WHERE id = $10`,
          [
            r.retailPrice ?? null,
            r.salesQty30d ?? null, r.salesRealamt30d ?? null,
            r.salesQty90d ?? null, r.salesRealamt90d ?? null,
            r.psdHb30d ?? null, r.psdHb90d ?? null,
            r.stockQty ?? null, importedBy,
            existing.rows[0].id,
          ],
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO store_sku_snapshots
             (store_id, product_id, sku_code, snapshot_date,
              retail_price,
              sales_qty_30d, sales_realamt_30d, sales_qty_90d, sales_realamt_90d,
              psd_hb_30d, psd_hb_90d, stock_qty, source, imported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual', $13)`,
          [
            storeId, productId, r.skuCode, r.snapshotDate,
            r.retailPrice ?? null,
            r.salesQty30d ?? null, r.salesRealamt30d ?? null,
            r.salesQty90d ?? null, r.salesRealamt90d ?? null,
            r.psdHb30d ?? null, r.psdHb90d ?? null, r.stockQty ?? null, importedBy,
          ],
        );
        inserted++;
      }
    }
  });
  return { inserted, updated, skipped, warnings };
}
