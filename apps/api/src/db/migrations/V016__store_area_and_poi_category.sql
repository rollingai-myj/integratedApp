-- =============================================================================
-- V016__store_area_and_poi_category.sql
-- stores 表新增两个门店自带的属性标签：
--   - store_area_sqm：门店面积（㎡），用户/总部维护
--   - poi_category：门店本身的商圈类型标签（HQ 主数据，与 store_insights.category
--                   不同——后者是 AI 实时分析输出，poi_category 是门店建档属性）
-- =============================================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS store_area_sqm NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS poi_category   TEXT;

COMMENT ON COLUMN stores.store_area_sqm IS '门店面积，单位 ㎡（NULL=未填）';
COMMENT ON COLUMN stores.poi_category   IS '门店商圈类型标签（HQ 主数据；区别于 store_insights.category 的 AI 分析输出）';
