/**
 * 场景基准 SKU 实时计算（spec api-to-be.md #6 GET /scenes/:scene/benchmark）
 *
 * 规则（V023 起按 category_id 走树；销量/销售额用"占比规模分离"的归一化平均）：
 *   1. 范围：所有 active 门店，排除当前门店本身
 *   2. 选品筛选：fn_category_scene(p.category_id) = $scene（V012 函数沿 parent_id 走到 L0）
 *   3. 每店每 SKU 最近两期快照：latest = rn=1，prev = rn=2
 *   4. 门店规模：store_amt / store_qty = 该店在本场景内所有 SKU 的 latest 之和
 *      （只用本场景，烘焙 SKU 不能拿百货门店总额做分母）
 *   5. 跨店聚合（GROUP BY product_id）：
 *        norm_avg_amt = AVG(item_amt / store_amt) × AVG(store_amt)
 *        norm_avg_qty = AVG(item_qty / store_qty) × AVG(store_qty)
 *        含义：「SKU 在门店内的平均占比 × 门店在本场景的平均规模」。
 *        与朴素 AVG(item_amt) 的差别：解耦"占比"与"门店规模"的潜在正相关，
 *        避免"这 SKU 恰好在大店里占比也高"的偏估。当两者独立时两者等价。
 *        psd_change = (Σ paired_latest_amt − Σ prev_amt) / Σ prev_amt × 100
 *                    // 全网该 SKU 销售额环比变化%；prev 总和 0 → null
 *   6. status='active' / deleted_at IS NULL
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
  /** 销售环比 (%);V031 起字段名改为 psdChange 给智能体用,值来自 latest snapshot.psd_hb_30d (ERP 灌入) */
  psdChange: string;
  shelfLifeDays: number | null;
}

interface AggRow {
  sku_code: string;
  product_name: string;
  spec: string | null;
  shelf_life_days: number | null;
  l1_name: string | null;
  l2_name: string | null;
  l3_name: string | null;
  avg_qty: string | null;
  avg_amt: string | null;
  /** 跨店本场景 SKU 销售环比 % (V031 起改读 snapshot.psd_hb_30d 而不是后端 LAG 自算) */
  psd_change: string | null;
}

export async function computeBenchmarkForScene(
  currentStoreId: string,
  scene: number,
): Promise<BenchmarkSkuRow[]> {
  const sql = `
    WITH ranked AS (
      -- 提早在 JOIN 处筛 scene：store_scene_totals 只统计本场景内的 SKU
      -- V031:sales_amount_30d → sales_realamt_30d; psd_hb_30d 来自 ERP 直接灌入
      SELECT s.store_id, s.product_id,
             COALESCE(s.sales_qty_30d, 0)::numeric     AS qty,
             COALESCE(s.sales_realamt_30d, 0)::numeric AS amt,
             s.psd_hb_30d                              AS psd_hb_30d,
             ROW_NUMBER() OVER (
               PARTITION BY s.store_id, s.product_id
               ORDER BY s.snapshot_date DESC,
                        CASE s.source WHEN 'manual' THEN 1 ELSE 2 END,
                        s.created_at DESC
             ) AS rn
        FROM store_sku_snapshots s
        JOIN stores st ON st.id = s.store_id
                      AND st.deleted_at IS NULL
                      AND st.status = 'active'::user_status
        JOIN hq_products pj ON pj.id = s.product_id
                           AND pj.deleted_at IS NULL
                           AND pj.status = 'active'::product_status
                           AND fn_category_scene(pj.category_id) = $2
       WHERE s.store_id <> $1
    ),
    pairs AS (
      SELECT latest.store_id, latest.product_id,
             latest.qty        AS latest_qty,
             latest.amt        AS latest_amt,
             latest.psd_hb_30d AS latest_psd_hb_30d
        FROM ranked latest
       WHERE latest.rn = 1
    ),
    store_scene_totals AS (
      -- 每店本场景内 SKU 的最新一期之和 = 该店在本场景的"规模"
      SELECT store_id,
             SUM(latest_amt) AS store_amt,
             SUM(latest_qty) AS store_qty
        FROM pairs
       GROUP BY store_id
    ),
    joined AS (
      -- 占比基数为 0 的店剔掉（store_amt = 0 → 整店本场景没销量，没有比较意义）
      SELECT p.product_id, p.store_id,
             p.latest_amt AS item_amt,
             p.latest_qty AS item_qty,
             t.store_amt,
             t.store_qty,
             p.latest_psd_hb_30d
        FROM pairs p
        JOIN store_scene_totals t ON t.store_id = p.store_id
       WHERE t.store_amt > 0
    ),
    aggregated AS (
      SELECT product_id,
             -- norm_avg_amt = E[占比金额] × E[门店金额规模]
             AVG(item_amt / store_amt) * AVG(store_amt) AS norm_avg_amt,
             -- 销量分母可能为 0（store_qty 全 null/0）→ NULLIF 让该店占比为 NULL，AVG 自动忽略
             AVG(item_qty / NULLIF(store_qty, 0)) * AVG(NULLIF(store_qty, 0)) AS norm_avg_qty,
             -- V031:跨店环比改为平均各店 ERP 直接灌入的 psd_hb_30d, 不再后端 LAG 自算
             AVG(latest_psd_hb_30d) FILTER (WHERE latest_psd_hb_30d IS NOT NULL) AS avg_psd_hb_30d
        FROM joined
       GROUP BY product_id
    )
    SELECT p.sku_code, p.product_name, p.spec,
           p.shelf_life_days,
           fn_category_ancestor_name(p.category_id, 1::smallint) AS l1_name,
           fn_category_ancestor_name(p.category_id, 2::smallint) AS l2_name,
           fn_category_ancestor_name(p.category_id, 3::smallint) AS l3_name,
           a.norm_avg_qty AS avg_qty,
           a.norm_avg_amt AS avg_amt,
           a.avg_psd_hb_30d AS psd_change
      FROM aggregated a
      JOIN hq_products p ON p.id = a.product_id
                        AND p.deleted_at IS NULL
                        AND p.status = 'active'::product_status
  ORDER BY p.sku_code
  `;
  const res = await query<AggRow>(sql, [currentStoreId, scene]);

  return res.rows.map((r) => ({
    skuCode: r.sku_code,
    skuName: r.product_name || r.sku_code,
    spec: r.spec ?? '',
    majorCategory: r.l1_name ?? '',
    midCategory: r.l2_name ?? '',
    subCategory: r.l3_name ?? '',
    sales30d: Number(r.avg_amt ?? 0).toFixed(2),
    salesVolume30d: Number(r.avg_qty ?? 0).toFixed(2),
    // V031:环比来自 ERP 直接灌入的 snapshot.psd_hb_30d (跨店平均);null = 全店都没值
    psdChange: r.psd_change != null ? Number(r.psd_change).toFixed(1) : '0',
    shelfLifeDays: r.shelf_life_days,
  }));
}
