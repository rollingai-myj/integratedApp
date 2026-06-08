-- =============================================================================
-- V020__competitor_extras.sql
-- 域：竞品数据 — 增量字段
-- 内容：
--   - dim_competitor_product 增加 series 列（系列名，如"经典系列"、"限定款"等）
-- 背景：
--   按 docs/modules/competitor-collector.md 约定 E，V020+ 留给业务模块自己的
--   schema 增量。本文件追加"系列"维度，便于竞品采集模块按系列做归类、对比。
-- =============================================================================

ALTER TABLE dim_competitor_product
  ADD COLUMN series TEXT;

COMMENT ON COLUMN dim_competitor_product.series IS '商品所属系列（如"经典系列"、"夏日限定"），无系列时为 NULL';

-- 系列名通常用于品牌侧分组浏览，命中范围小，加普通 btree 即可；
-- 加 WHERE NOT NULL 部分索引避免大量 NULL 进索引。
CREATE INDEX idx_competitor_product_series
  ON dim_competitor_product (series)
  WHERE series IS NOT NULL;
