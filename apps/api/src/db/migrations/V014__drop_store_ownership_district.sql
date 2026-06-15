-- =============================================================================
-- V014__drop_store_ownership_district.sql
-- 两处裁剪（业务上确认不再用）：
--   1) stores 移除 ownership 列（直营/加盟）—— 暂无业务逻辑依赖
--   2) stores 移除 district 列（区/县）—— 地址定位用 province+city+address 已足够
-- 同时删 store_ownership 枚举类型（仅此表用，删列后类型成孤儿）
-- =============================================================================

ALTER TABLE stores DROP COLUMN IF EXISTS ownership;
ALTER TABLE stores DROP COLUMN IF EXISTS district;

DROP TYPE IF EXISTS store_ownership;
