-- =============================================================================
-- V029__stores_city_project_flag.sql
-- 域：基础数据 · 门店
-- 起因：
--   原 skuSelection repo 在前端 difyAlignApi.ts 里写死 15 家门店的 city 映射
--   + 4 家"项目店"（PROJECT_STORES）。这是硬编码 —— 改一家门店要发版前端。
--
--   现在把数据搬到 stores 表的 city 列（已有，PR #29 没填）+ 新增
--   is_project_store 列；前端从 /auth/me 取 currentStore.city/isProjectStore，
--   不再硬编码。
--
-- 注：UPDATE 语句对不存在的 store_code 是 no-op，不会失败 —— 安全可重跑。
-- =============================================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS is_project_store BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN stores.is_project_store IS
  '是否项目店：影响 Dify ALIGN/SELECTION 工作流 prompt 分支（项目店有定制陈列规则）';

CREATE INDEX IF NOT EXISTS idx_stores_project_store
  ON stores (is_project_store) WHERE is_project_store = TRUE AND deleted_at IS NULL;

-- ---- 数据迁移：city ----------------------------------------------------------
-- 把原 repo 的 STORE_CITY_MAP 写入 stores.city
UPDATE stores SET city = '东莞' WHERE store_code IN
  ('粤37893', '粤39476', '粤39128', '粤32839', '粤28999', '粤28399', '粤39608');
UPDATE stores SET city = '深圳' WHERE store_code IN
  ('粤32826', '粤38788', '粤32156', '粤35176', '1534');
UPDATE stores SET city = '肇庆' WHERE store_code IN ('粤35853', '粤29790');
UPDATE stores SET city = '韶关' WHERE store_code IN ('粤39620');
UPDATE stores SET city = '清远' WHERE store_code IN ('粤34083');

-- ---- 数据迁移：is_project_store ---------------------------------------------
-- 把原 repo 的 PROJECT_STORES set 写入 stores.is_project_store
UPDATE stores SET is_project_store = TRUE WHERE store_code IN
  ('粤28999', '粤29790', '粤32826', '粤39128');
