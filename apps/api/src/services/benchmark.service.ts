/**
 * 标杆店 SKU 数据（benchmark_sku_data）实时计算
 *
 * 业务背景：之前是基于不同门店销售数据算好的加权平均值直接存表；DB 结构改后
 * 不再落库，需要每次根据所有门店该品类 SKU 现场计算后传给 Dify selection / align
 * 工作流。
 *
 * 规则（与产品确认）：
 *   1. 范围：所有 active 门店，但排除当前门店本身（避免自己污染自己的标杆）
 *   2. "最新一轮"：每店各自最新一条 snapshot_date（不强求全公司对齐到同一天）
 *   3. "选中"：出现在最新快照 AND dim_product.status='active'
 *   4. 品类：scene 的 categories L1 名字（如「冷藏品」、「烘焙糕点」）
 *   5. SKU 集：并集（出现在任一店最新快照即纳入）
 *   6. 加权：以各店该 SKU 的 sales_amount_30d 为权重；缺值或全 0 时退化为简单平均
 *   7. 主属性：从 dim_product 直接取
 *
 * 输出 shape 与前端 sceneAnalysis.ts:fmt() 完全一致（必须，Dify 工作流按位读字段）：
 *   { skuCode, skuName, spec, majorCategory, midCategory, subCategory,
 *     sales30d, salesVolume30d, psdChangetb, shelfLifeDays }
 */
import { query } from '../db/index.js';

export interface BenchmarkSkuRow {
  skuCode: string;
  skuName: string;
  spec: string;
  majorCategory: string;
  midCategory: string;
  subCategory: string;
  /** 加权后近 30 天销售额，保留两位 */
  sales30d: string;
  /** 加权后近 30 天销售件数，保留两位 */
  salesVolume30d: string;
  /** 同比变化；目前数据源没有，统一占位 '0' 与 SKU Data 对齐 */
  psdChangetb: string;
  shelfLifeDays: number | null;
}

interface AggRow {
  sku_code: string;
  product_name: string;
  brand: string | null;
  spec: string | null;
  shelf_life_days: number | null;
  cat_path: string | null;
  w_qty: string | null;
  w_amt: string | null;
  store_count: string;
}

/**
 * 计算指定场景的标杆 SKU 列表。
 *
 * @param currentStoreId - 当前用户的门店，会被排除在加权之外
 * @param sceneCategoryL1Names - 场景对应的 L1 品类名字列表（如 ['冷藏品']、['糖果','巧克力']）
 * @returns 与 SKU Data 同 shape 的 BenchmarkSkuRow[]；无数据返回 []
 */
export async function computeBenchmarkForScene(
  currentStoreId: string,
  sceneCategoryL1Names: string[],
): Promise<BenchmarkSkuRow[]> {
  if (sceneCategoryL1Names.length === 0) return [];

  const sql = `
    WITH latest_snap AS (
      -- 每店每商品取最新一条快照（snapshot_date DESC，同日按 created_at 兜底）
      SELECT DISTINCT ON (store_id, product_id)
             store_id, product_id,
             sales_qty_30d, sales_amount_30d
        FROM fact_store_sku_weekly
       WHERE store_id <> $1
    ORDER BY store_id, product_id, snapshot_date DESC, created_at DESC
    ),
    filtered AS (
      -- 过滤：active 店、active 商品、L1 命中场景品类
      SELECT ls.product_id, ls.store_id,
             COALESCE(ls.sales_qty_30d, 0)::numeric    AS qty,
             COALESCE(ls.sales_amount_30d, 0)::numeric AS amt
        FROM latest_snap ls
        JOIN dim_product p ON p.id = ls.product_id
        JOIN stores      s ON s.id = ls.store_id
       WHERE p.deleted_at IS NULL
         AND p.status = 'active'
         AND s.deleted_at IS NULL
         AND s.status = 'active'
         AND split_part(fn_category_path(p.category_id), '/', 1) = ANY($2::text[])
    ),
    aggregated AS (
      -- 以 sales_amount_30d 为权重做加权平均；权重和为 0 时退化为简单平均（AVG）
      SELECT product_id,
             COUNT(DISTINCT store_id) AS store_count,
             CASE WHEN SUM(amt) = 0 THEN AVG(qty)
                  ELSE SUM(qty * amt) / SUM(amt) END AS w_qty,
             CASE WHEN SUM(amt) = 0 THEN AVG(amt)
                  ELSE SUM(amt * amt) / SUM(amt) END AS w_amt
        FROM filtered
       GROUP BY product_id
    )
    SELECT p.sku_code, p.product_name, p.brand, p.spec,
           p.shelf_life_days,
           fn_category_path(p.category_id) AS cat_path,
           a.w_qty, a.w_amt, a.store_count
      FROM aggregated a
      JOIN dim_product p ON p.id = a.product_id
  ORDER BY p.sku_code
  `;
  const res = await query<AggRow>(sql, [currentStoreId, sceneCategoryL1Names]);

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
