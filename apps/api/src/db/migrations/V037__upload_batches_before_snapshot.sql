-- V037 — upload_batches 加 before_snapshot 列
--
-- apply 操作前,把会被覆盖的字段值快照下来塞 jsonb,rollback 时还原。
-- 数组元素分两种:
--   { "kind": "inserted", "table": "hq_products", "key": { "sku_code": "..." } }
--     → rollback = DELETE WHERE key
--   { "kind": "updated",  "table": "hq_products", "key": { "sku_code": "..." }, "before": { 字段...: 旧值... } }
--     → rollback = UPDATE SET 字段=旧值 WHERE key
--
-- snapshots 表是 insert-only(unique on store+product+date+source),
-- apply 用 ON CONFLICT DO NOTHING,before_snapshot 全是 inserted 类。

ALTER TABLE upload_batches
  ADD COLUMN before_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN upload_batches.before_snapshot IS
  'apply 前每行的旧状态,rollback 时按 kind 还原';
