-- =============================================================================
-- V026__hq_products_market_min_and_tags.sql
-- 给 hq_products 加三个跟 Dify 选品/诊断入参 sku_attributes 直接对应的字段：
--   - market_min_price          NUMERIC(12,2)   外部市场最低零售价（元），可空
--   - market_min_price_source   TEXT            来源（示例："好享来"），可空
--   - tags                      TEXT[] NOT NULL 商品标签数组（示例：{'引流品','S级'}）
--                               默认 '{}'（保持现有行可写）
--   - tags GIN 索引：未来按标签筛选用
-- 注：tags 选 TEXT[] 而非 JSONB —— node-pg 自动把 TEXT[] 映成 JS string[]，
--     被 serializeInputs JSON.stringify 时正好是自然 JSON 数组，跟 Dify 期望一致。
-- =============================================================================

BEGIN;

ALTER TABLE hq_products
  ADD COLUMN market_min_price        NUMERIC(12,2),
  ADD COLUMN market_min_price_source TEXT,
  ADD COLUMN tags                    TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX hq_products_tags_idx ON hq_products USING gin (tags);

COMMENT ON COLUMN hq_products.market_min_price        IS '外部市场最低零售价（元）';
COMMENT ON COLUMN hq_products.market_min_price_source IS '外部市场最低价来源（示例："好享来"）';
COMMENT ON COLUMN hq_products.tags                    IS '商品标签数组（示例：{"引流品","S级"}），Dify 选品/诊断入参 sku_attributes.tags';

COMMIT;
