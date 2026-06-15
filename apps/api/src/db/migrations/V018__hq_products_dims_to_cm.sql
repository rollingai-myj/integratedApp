-- =============================================================================
-- V018__hq_products_dims_to_cm.sql
-- hq_products 商品尺寸列单位：mm → cm
--   现状：列名 length_mm/width_mm/height_mm，但 158 条存量值实际是厘米（平均 7.3）
--   本次：列名改成 *_cm 对齐实际值；同步把 V017 回填时按 mm 乘 10 的 3 条 ÷10 还原
--
-- 业务影响：仅 hq_products 商品主数据；当前业务（含虚拟陈列图智能体输入）未消费该字段
--
-- 幂等：开发环境曾用直连 psql 提前手工跑过这段（列已经是 *_cm），所以这里全程加守卫，
--      只在 mm 列仍然存在时做 UPDATE + RENAME，已经迁过的不再重跑。
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='hq_products'
       AND column_name='length_mm'
  ) THEN
    -- 1) V017 回填时按"列名 mm"乘 10 的几条 ÷10 还原回 cm
    UPDATE hq_products
       SET length_mm = length_mm / 10,
           width_mm  = width_mm / 10,
           height_mm = height_mm / 10
     WHERE deleted_at IS NULL
       AND (length_mm > 30 OR width_mm > 30 OR height_mm > 30);

    -- 2) 列改名
    ALTER TABLE hq_products RENAME COLUMN length_mm TO length_cm;
    ALTER TABLE hq_products RENAME COLUMN width_mm  TO width_cm;
    ALTER TABLE hq_products RENAME COLUMN height_mm TO height_cm;
  END IF;
END $$;

COMMENT ON COLUMN hq_products.length_cm IS '商品深 (cm)';
COMMENT ON COLUMN hq_products.width_cm  IS '商品宽 (cm)';
COMMENT ON COLUMN hq_products.height_cm IS '商品高 (cm)';
