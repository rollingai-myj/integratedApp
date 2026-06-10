-- =============================================================================
-- V024__sku_selection_patch.sql
-- 域：货盘选品（skuSelection 模块整合）
-- 起因：原 repo 在 V011__last_snapshot.sql 给 shelf_runtime_state 加了
--      last_snapshot JSONB 列，供 v2/LastRecordPage 一次性拿"上一轮调改"快照
--      （照片 + matches + diagnosis + strategy + virtual_shelf 输出）。
--      整合 app 的 V008__shelves.sql 没有这列，这里补上。
--
-- 形态约定：
--   last_snapshot = {
--     at:        ISO 时间
--     summary:   "上架了 N 个品，停止进货了 M 个品"
--     photos:    Array<{ url, matches?: DetectMatch[] }>
--     diagnosis: DiagnosisResult        // Dify align 输出
--     strategy:  StrategyResult         // Dify selection 输出（含 skus / metrics）
--     virtual_shelf_raw_outputs?: 任意  // 一键生成后追加
--     virtual_shelf_context?:    任意
--   }
-- 不强校验子结构 —— Dify 输出会演化，前端按需读字段即可。
-- =============================================================================

ALTER TABLE shelf_runtime_state
  ADD COLUMN IF NOT EXISTS last_snapshot JSONB;

COMMENT ON COLUMN shelf_runtime_state.last_snapshot IS
  '最近一次完成调改的快照（照片/诊断/选品/虚拟货架），供 LastRecordPage 回看';
