/**
 * 场景基准 SKU 实时计算（spec api-to-be.md #6 GET /scenes/:scene/benchmark）
 *
 * 规则：
 *   1. 范围：所有 active 门店，排除当前门店本身
 *   2. 最新一轮：每店各自最新 snapshot_date
 *   3. 选中：出现在最新快照 AND hq_products.status='active'
 *   4. 品类：场景的 L1 子类目名集合（hq_categories WHERE parent_id=scene_root AND level=1）
 *   5. 加权：以 sales_amount_30d 为权重；权重和为 0 时退化简单平均
 *   6. 主属性：从 hq_products 直接取
 */
import { query } from '../db/index.js';

export interface BenchmarkSkuRow {
  skuCode: string;
  skuName: string;
  spec: string;
  majorCategory: string;
  midCategory: string;
  subCategory: string;
  sales30d: string;
  salesVolume30d: string;
  psdChangetb: string;
  shelfLifeDays: number | null;
}

interface AggRow {
  sku_code: string;
  product_name: string;
  spec: string | null;
  shelf_life_days: number | null;
  cat_path: string | null;
  w_qty: string | null;
  w_amt: string | null;
}

async function getSceneL1CategoryNames(scene: number): Promise<string[]> {
  const res = await query<{ name: string }>(
    `SELECT c.category_name AS name
       FROM hq_categories root
       JOIN hq_categories c ON c.parent_id = root.id AND c.level = 1 AND c.is_active
      WHERE root.level = 0 AND root.scene = $1 AND root.is_active`,
    [scene],
  );
  return res.rows.map((r) => r.name);
}

export async function computeBenchmarkForScene(
  currentStoreId: string,
  scene: number,
): Promise<BenchmarkSkuRow[]> {
  const l1Names = await getSceneL1CategoryNames(scene);
  if (l1Names.length === 0) return [];

  const sql = `
    WITH latest_snap AS (
      SELECT DISTINCT ON (store_id, product_id)
             store_id, product_id,
             sales_qty_30d, sales_amount_30d
        FROM store_sku_snapshots
       WHERE store_id <> $1
    ORDER BY store_id, product_id, snapshot_date DESC
    ),
    filtered AS (
      SELECT ls.product_id,
             COALESCE(ls.sales_qty_30d, 0)::numeric    AS qty,
             COALESCE(ls.sales_amount_30d, 0)::numeric AS amt
        FROM latest_snap ls
        JOIN hq_products p ON p.id = ls.product_id
        JOIN stores      s ON s.id = ls.store_id
       WHERE p.deleted_at IS NULL
         AND p.status = 'active'::product_status
         AND s.deleted_at IS NULL
         AND s.status = 'active'::user_status
         AND split_part(fn_category_path(p.category_id), '/', 1) = ANY($2::text[])
    ),
    aggregated AS (
      SELECT product_id,
             CASE WHEN SUM(amt) = 0 THEN AVG(qty)
                  ELSE SUM(qty * amt) / SUM(amt) END AS w_qty,
             CASE WHEN SUM(amt) = 0 THEN AVG(amt)
                  ELSE SUM(amt * amt) / SUM(amt) END AS w_amt
        FROM filtered
       GROUP BY product_id
    )
    SELECT p.sku_code, p.product_name, p.spec,
           p.shelf_life_days,
           fn_category_path(p.category_id) AS cat_path,
           a.w_qty, a.w_amt
      FROM aggregated a
      JOIN hq_products p ON p.id = a.product_id
  ORDER BY p.sku_code
  `;
  const res = await query<AggRow>(sql, [currentStoreId, l1Names]);

  return res.rows.map((r) => {
    const parts = (r.cat_path ?? '').split('/').filter(Boolean);
    return {
      skuCode: r.sku_code,
      skuName: r.product_name || r.sku_code,
      spec: r.spec ?? '',
      majorCategory: parts[0] ?? '',
      midCategory: parts[1] ?? '',
      subCategory: parts[2] ?? parts[1] ?? '',
      sales30d: Number(r.w_amt ?? 0).toFixed(2),
      salesVolume30d: Number(r.w_qty ?? 0).toFixed(2),
      psdChangetb: '0',
      shelfLifeDays: r.shelf_life_days,
    };
  });
}
