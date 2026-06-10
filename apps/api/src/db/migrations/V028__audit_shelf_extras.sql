-- =============================================================================
-- V028__audit_shelf_extras.sql
-- 域：审计 · 选品流程埋点
-- 起因：
--   原 skuSelection repo 有 7 类细粒度埋点（diagnose / re_diagnose / reupload /
--   optimize_selection / apply_strategy / generate_layout / re_generate_layout）。
--   现有 audit_event_kind 覆盖了拍照上传 / 一键应用 / 虚拟货架生成，但
--   "AI 选品工作流（Dify SELECTION 调用）"和"AI 诊断工作流（Dify ALIGN 调用）"
--   没有专用 enum 值 —— 之前 PR #29 把整个埋点做成 no-op 也是出于这个借口。
--
-- 新增：
--   - 'shelf_ai_diagnose'   AI 诊断工作流调用（独立于检测 shelf_detect）
--   - 'shelf_ai_selection'  AI 选品工作流调用
--
-- 7 个 frontend action_type → audit_event_kind 映射（写在 service）：
--   diagnose / re_diagnose       → shelf_ai_diagnose（payload.actionType 保留细分）
--   reupload                     → shelf_photo_upload
--   optimize_selection           → shelf_ai_selection
--   apply_strategy               → shelf_assortment_apply
--   generate_layout / re_generate_layout → shelf_virtual_generate
-- =============================================================================

ALTER TYPE audit_event_kind ADD VALUE IF NOT EXISTS 'shelf_ai_diagnose';
ALTER TYPE audit_event_kind ADD VALUE IF NOT EXISTS 'shelf_ai_selection';
