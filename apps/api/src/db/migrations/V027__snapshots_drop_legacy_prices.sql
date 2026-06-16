-- =============================================================================
-- V027__snapshots_drop_legacy_prices.sql
-- 产品定位重塑：本 app 是"模拟器 + 销售分析"工具，不写门店真实价。
--   - store_sku_snapshots：删 original_price / wholesale_price，只保留 retail_price（本期实际售价）
--   - v_store_product_curve：投影同步删两列
--   - store_price_changes：表保留不删，但 V027 起读写路径都废弃（应用层逻辑改写）
--
-- 价格归口（V027）：
--   * retail_price（snapshot）  实际销售价；价盘曲线、调价历史、涨跌对比的唯一来源
--   * wholesale_price（hq_products）  批发价；JOIN 进 SKU 头部（全期同值），成本/利润计算
--   * suggested_retail_price（hq_products）  总部建议价；不进价盘，仅选品/产品库
-- =============================================================================

BEGIN;

-- 1) 重建视图前 DROP（视图引用了即将删除的列，必须先拆）
DROP VIEW IF EXISTS v_store_product_curve;

-- 2) 删两列
ALTER TABLE store_sku_snapshots
  DROP COLUMN original_price,
  DROP COLUMN wholesale_price;

-- 3) 视图重建：列定义同步收窄
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
  sales_qty_30d, sales_amount_30d, gross_margin_30d, stock_qty, source
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW v_store_product_curve IS
  '门店 × SKU 价格/销量曲线（基于 store_sku_snapshots，同日多源取一）；V027 起只剩 retail_price（实际售价），批发价回 hq_products 读';

COMMIT;
