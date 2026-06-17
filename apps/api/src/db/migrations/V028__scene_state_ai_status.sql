-- V028: store_scene_state 加 diagnose / strategy 后台任务状态字段
--
-- 背景:目前 5 个 Dify 工作流里 align(诊断) / selection(选品) / virtual-shelf(虚拟陈列)
-- 仍走"前端 fetch SSE → 浏览器 IIFE 读流 → 完成后写 DB"模式。关 tab/刷新页面 → IIFE 没了
-- → DB 中的状态字段卡 'processing' 永远转不到 'completed'。
--
-- 范式与 virtual_status / virtual_raw_outputs (V006) + ensureStoreInsight (PR #41)
-- 对齐:
--   - {workflow}_status: scene_virtual_status enum,默认 'idle'
--   - {workflow}_raw_outputs: JSONB,存 Dify 输出原始结构(失败时也存 error 上下文)
-- 后端 ensureDiagnose / ensureStrategy 函数从前端"点上传"或"触发开始调改"事件 fire-
-- and-forget 拉起,前端只读状态,不再 SSE 透传。

BEGIN;

ALTER TABLE store_scene_state
  ADD COLUMN diagnose_status      scene_virtual_status NOT NULL DEFAULT 'idle',
  ADD COLUMN diagnose_raw_outputs JSONB,
  ADD COLUMN strategy_status      scene_virtual_status NOT NULL DEFAULT 'idle',
  ADD COLUMN strategy_raw_outputs JSONB;

COMMENT ON COLUMN store_scene_state.diagnose_status      IS 'Dify align 工作流(三段诊断)进度: idle/processing/completed/failed';
COMMENT ON COLUMN store_scene_state.diagnose_raw_outputs IS 'Dify align 输出 (失败时存 {error,...} 给前端展示)';
COMMENT ON COLUMN store_scene_state.strategy_status      IS 'Dify selection 工作流(选品策略)进度,同 diagnose';
COMMENT ON COLUMN store_scene_state.strategy_raw_outputs IS 'Dify selection 输出';

COMMIT;
