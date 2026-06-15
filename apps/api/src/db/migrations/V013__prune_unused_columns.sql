-- =============================================================================
-- V013__prune_unused_columns.sql
-- 三处裁剪：
--   1) audit_event_kind 移除 'price_ai_diagnose'（功能整体下线）
--   2) hq_products 移除 official_image_url 列（图片改为按命名约定从 OSS 拼）
--   3) （device_bindings 表早已不存在，不在此处理）
-- =============================================================================

-- 1a) 把 price_change_source 收窄到 'manual' | 'rule_engine'（删 'ai_suggest'）
--     先把残留行迁回 'manual'（开发库里 0 行；生产兜底用）
UPDATE store_price_changes SET source = 'manual' WHERE source = 'ai_suggest';

CREATE TYPE price_change_source_new AS ENUM ('manual', 'rule_engine');
ALTER TABLE store_price_changes
  ALTER COLUMN source DROP DEFAULT,
  ALTER COLUMN source TYPE price_change_source_new
  USING source::text::price_change_source_new;
ALTER TABLE store_price_changes
  ALTER COLUMN source SET DEFAULT 'manual';
DROP TYPE price_change_source;
ALTER TYPE price_change_source_new RENAME TO price_change_source;

-- 1b) 删除历史 audit 行后重建 enum 不含 price_ai_diagnose
DELETE FROM sys_audit_events WHERE event_kind = 'price_ai_diagnose';

-- 1c) 删 store_price_changes 里 AI 相关的两列
ALTER TABLE store_price_changes DROP COLUMN IF EXISTS ai_advice;
ALTER TABLE store_price_changes DROP COLUMN IF EXISTS ai_model;

-- 必须先 drop 引用 event_kind 列的视图，否则 ALTER COLUMN TYPE 失败
DROP VIEW IF EXISTS v_login_events;

CREATE TYPE audit_event_kind_new AS ENUM (
  'user_login', 'user_logout', 'user_session_refresh',
  'feishu_oauth_success', 'feishu_oauth_fail',
  'user_create', 'user_update', 'user_disable', 'user_delete',
  'user_password_reset', 'user_role_change', 'user_store_bind', 'user_store_unbind',
  'store_create', 'store_update', 'sku_import',
  'promotion_batch_upload', 'promotion_batch_activate', 'promotion_batch_delete',
  'scene_config_change', 'scene_photo_upload', 'scene_detect',
  'scene_qa_submit', 'scene_env_update',
  'scene_ai_diagnose', 'scene_ai_strategy',
  'scene_assortment_apply', 'scene_virtual_generate',
  'sku_correction_submit',
  'survey_submit', 'insight_generate', 'store_insight_update',
  'price_change',
  'poster_task_submit', 'poster_generation_complete', 'poster_generation_fail',
  'poster_adopt', 'poster_download', 'poster_asset_upload', 'poster_asset_delete',
  'competitor_update', 'competitor_product_update', 'competitor_price_collect',
  'super_admin_action', 'app_setting_change', 'ai_model_switch', 'ai_stress_test'
);

ALTER TABLE sys_audit_events
  ALTER COLUMN event_kind TYPE audit_event_kind_new
  USING event_kind::text::audit_event_kind_new;

DROP TYPE audit_event_kind;
ALTER TYPE audit_event_kind_new RENAME TO audit_event_kind;

-- 重建 v_login_events（与 V010 同源定义）
CREATE OR REPLACE VIEW v_login_events AS
SELECT
  id,
  created_at,
  actor_user_id,
  actor_display_name,
  target_store_id,
  client_type,
  ip,
  user_agent,
  payload
FROM sys_audit_events
WHERE event_kind = 'user_login';

COMMENT ON VIEW v_login_events IS '登录事件投影（登录事件单源，不另建表）';

-- 2) 删 official_image_url 列（先 drop 引用它的视图，再删列，再重建视图）
DROP VIEW IF EXISTS v_promotion_active;

ALTER TABLE hq_products DROP COLUMN IF EXISTS official_image_url;

CREATE OR REPLACE VIEW v_promotion_active AS
SELECT
  i.*,
  p.id                       AS resolved_product_id,
  p.suggested_retail_price
FROM hq_promo_batch_items i
JOIN hq_promo_batches b ON b.id = i.batch_id AND b.is_active
LEFT JOIN hq_products p ON p.sku_code = i.sku_code AND p.deleted_at IS NULL;

COMMENT ON VIEW v_promotion_active IS '当前激活批次的全部促销商品（批次冻结快照）。商品图按 OSS 命名约定拼接，DB 不再缓存 URL。';
