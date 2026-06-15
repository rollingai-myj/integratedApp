-- =============================================================================
-- V017__hq_products_master_fields.sql
-- 对齐总部冷藏品主数据表（《冷藏品主数据.xlsx》）：
--   - barcode         国际代码 / EAN-13 等
--   - is_returnable   是否可退（退货标识）
--   - allocation_unit 配货单位（按整包数量配送）
-- =============================================================================

ALTER TABLE hq_products
  ADD COLUMN IF NOT EXISTS barcode         VARCHAR(32),
  ADD COLUMN IF NOT EXISTS is_returnable   BOOLEAN,
  ADD COLUMN IF NOT EXISTS allocation_unit INT;

COMMENT ON COLUMN hq_products.barcode         IS '国际/制造商条码（EAN-13 等）；非业务主键，允许为空';
COMMENT ON COLUMN hq_products.is_returnable   IS '是否可退（退货标识）；NULL 表示总部主数据未声明';
COMMENT ON COLUMN hq_products.allocation_unit IS '配货单位：一次最少配货的整包数量';
