-- =============================================================================
-- V031__snapshot_rename_amt_add_psd_hb.sql
-- 销售快照字段对齐 ERP 真实导入口径:
--   - sales_amount_30d / 90d → sales_realamt_30d / 90d (本期真实销售额)
--   - gross_margin_30d 删 — ERP 不导入毛利率,自行去掉
--   - 新增 psd_hb_30d / 90d — ERP 直接灌入"销售环比 (%)",后端不再 LAG 自算
-- 顺带:store_competitor_products 加 tags (店主自由标签)
--
-- 影响视图:
--   - v_store_product_curve (V027 创建,投影 sales_amount_30d / gross_margin_30d)
--   - v_poster_product_sales (V010 创建,投影 sales_amount_30d)
-- 必须先 DROP 再 CREATE,列名变更 PG 不支持原地改视图列名。
-- =============================================================================

BEGIN;

-- 1) 拆视图(都依赖即将改名/删除的列)
DROP VIEW IF EXISTS v_poster_product_sales;
DROP VIEW IF EXISTS v_store_product_curve;

-- 2) snapshot 列改:重命名 + 删毛利 + 新加两个环比列
ALTER TABLE store_sku_snapshots
  RENAME COLUMN sales_amount_30d TO sales_realamt_30d;
ALTER TABLE store_sku_snapshots
  RENAME COLUMN sales_amount_90d TO sales_realamt_90d;
ALTER TABLE store_sku_snapshots
  DROP COLUMN gross_margin_30d;
ALTER TABLE store_sku_snapshots
  ADD COLUMN psd_hb_30d NUMERIC(8,4);
ALTER TABLE store_sku_snapshots
  ADD COLUMN psd_hb_90d NUMERIC(8,4);

COMMENT ON COLUMN store_sku_snapshots.sales_realamt_30d IS
  '近 30 日真实销售额(元);ERP 导入;原 sales_amount_30d, V031 改名对齐 ERP 字段口径';
COMMENT ON COLUMN store_sku_snapshots.sales_realamt_90d IS
  '近 90 日真实销售额(元);ERP 导入';
COMMENT ON COLUMN store_sku_snapshots.psd_hb_30d IS
  '近 30 日 PSD(每店每日)销售环比百分比;ERP 直接灌入,后端不再从相邻两期 LAG 自算';
COMMENT ON COLUMN store_sku_snapshots.psd_hb_90d IS
  '近 90 日 PSD 销售环比百分比;ERP 直接灌入';

-- 3) 视图重建:列定义同步换名 + 加 psd_hb_* + 去 gross_margin
CREATE OR REPLACE VIEW v_store_product_curve AS
WITH ranked AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s.store_id, s.product_id, s.snapshot_date
      ORDER BY CASE s.source WHEN 'manual' THEN 1 ELSE 2 END, s.created_at DESC
    ) AS rn
  FROM store_sku_snapshots s
)
SELECT
  store_id, product_id, sku_code, snapshot_date,
  retail_price,
  sales_qty_30d, sales_realamt_30d,
  sales_qty_90d, sales_realamt_90d,
  psd_hb_30d, psd_hb_90d,
  stock_qty, source
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW v_store_product_curve IS
  '门店 × SKU 价格/销量曲线(同日多源取一);V031 起 sales_amount_* 改名为 sales_realamt_*, 删 gross_margin_30d, 新增 psd_hb_30d/90d';

CREATE OR REPLACE VIEW v_poster_product_sales AS
SELECT
  t.store_id,
  g.task_id,
  g.id            AS generation_id,
  tp.product_id,
  tp.sku_code,
  g.adopted_at,
  bef.snapshot_date     AS before_snapshot_date,
  bef.sales_qty_30d     AS before_sales_qty_30d,
  bef.sales_realamt_30d AS before_sales_realamt_30d,
  aft.snapshot_date     AS after_snapshot_date,
  aft.sales_qty_30d     AS after_sales_qty_30d,
  aft.sales_realamt_30d AS after_sales_realamt_30d,
  CASE
    WHEN bef.sales_qty_30d IS NULL OR aft.sales_qty_30d IS NULL OR bef.sales_qty_30d = 0 THEN NULL
    ELSE ROUND((aft.sales_qty_30d - bef.sales_qty_30d)::numeric * 100 / bef.sales_qty_30d, 1)
  END AS qty_delta_percent
FROM store_poster_generations g
JOIN store_poster_tasks t          ON t.id = g.task_id
JOIN store_poster_task_products tp ON tp.task_id = g.task_id
LEFT JOIN LATERAL (
  SELECT snapshot_date, sales_qty_30d, sales_realamt_30d
  FROM store_sku_snapshots s
  WHERE s.store_id = t.store_id AND s.product_id = tp.product_id
    AND s.snapshot_date <= g.adopted_at::date
  ORDER BY s.snapshot_date DESC
  LIMIT 1
) bef ON true
LEFT JOIN LATERAL (
  SELECT snapshot_date, sales_qty_30d, sales_realamt_30d
  FROM store_sku_snapshots s
  WHERE s.store_id = t.store_id AND s.product_id = tp.product_id
    AND s.snapshot_date > g.adopted_at::date
  ORDER BY s.snapshot_date DESC
  LIMIT 1
) aft ON true
WHERE g.is_adopted;

COMMENT ON VIEW v_poster_product_sales IS
  '海报采用前后 30 日销量对比(同店同 SKU 邻期);V031 起 sales_amount_30d → sales_realamt_30d';

-- 4) 竞品商品加自由标签
ALTER TABLE store_competitor_products
  ADD COLUMN tags TEXT;
COMMENT ON COLUMN store_competitor_products.tags IS
  '店主对竞品商品的自由标签(自定义文本,如"主推""引流款""价签丢失")';

COMMIT;
