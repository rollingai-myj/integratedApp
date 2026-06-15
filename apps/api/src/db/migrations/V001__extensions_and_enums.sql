-- =============================================================================
-- V001__extensions_and_enums.sql
-- 全新基线（2026-06，对应 docs/database-to-be.md）
-- 内容：扩展 + 全部 22 个 ENUM
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- 商品名/门店名模糊检索
CREATE EXTENSION IF NOT EXISTS unaccent;   -- 检索辅助

-- ───────────────────────── B1/B2 身份与横切 ─────────────────────────

CREATE TYPE system_role AS ENUM ('super_admin', 'store_owner', 'analyst', 'account_manager');
CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE auth_method AS ENUM ('feishu_qr', 'feishu_h5', 'legacy_password');
CREATE TYPE client_type AS ENUM ('feishu_h5', 'feishu_pc', 'browser');
CREATE TYPE usage_session_status AS ENUM ('active', 'ended', 'timeout');
CREATE TYPE setting_value_type AS ENUM ('string', 'int', 'float', 'bool', 'json');

CREATE TYPE audit_event_kind AS ENUM (
  -- 认证与账号
  'user_login', 'user_logout', 'user_session_refresh',
  'feishu_oauth_success', 'feishu_oauth_fail',
  'user_create', 'user_update', 'user_disable', 'user_delete',
  'user_password_reset', 'user_role_change', 'user_store_bind', 'user_store_unbind',
  -- 门店与导入
  'store_create', 'store_update', 'sku_import',
  -- 促销批次
  'promotion_batch_upload', 'promotion_batch_activate', 'promotion_batch_delete',
  -- 选品（场景维度）
  'scene_config_change', 'scene_photo_upload', 'scene_detect',
  'scene_qa_submit', 'scene_env_update',
  'scene_ai_diagnose', 'scene_ai_strategy',
  'scene_assortment_apply', 'scene_virtual_generate',
  'sku_correction_submit',
  -- 洞察
  'survey_submit', 'insight_generate', 'store_insight_update',
  -- 价盘
  'price_change', 'price_ai_diagnose',
  -- 海报
  'poster_task_submit', 'poster_generation_complete', 'poster_generation_fail',
  'poster_adopt', 'poster_download', 'poster_asset_upload', 'poster_asset_delete',
  -- 竞品
  'competitor_update', 'competitor_product_update', 'competitor_price_collect',
  -- 系统
  'super_admin_action', 'app_setting_change', 'ai_model_switch', 'ai_stress_test'
);

-- ───────────────────────── G1/G2 总部 ─────────────────────────

CREATE TYPE store_ownership AS ENUM ('direct', 'franchise');
CREATE TYPE product_status AS ENUM ('active', 'delisted');
CREATE TYPE benchmark_segment AS ENUM ('core', 'innovation');
CREATE TYPE promotion_scope AS ENUM ('all_stores', 'city', 'store_list');

-- ───────────────────────── S1/S2/S3 门店域 ─────────────────────────

CREATE TYPE scene_state_status AS ENUM ('empty', 'photo_uploaded', 'detected', 'reviewing', 'confirmed');
CREATE TYPE scene_virtual_status AS ENUM ('idle', 'processing', 'completed', 'failed');

-- 调改动作：仅 add/remove
CREATE TYPE assortment_action AS ENUM ('add', 'remove');
CREATE TYPE assortment_reason AS ENUM (
  'ai_recommend_core', 'ai_recommend_innovation', 'low_sales',
  'competitor_replace', 'shelf_space_limit', 'manual_keep', 'manual_remove', 'other'
);

-- 勘误：'observe' 历史枚举值已废弃（保留观察选项 2026-06-15 移除），保留在 ENUM 中只为不破坏既有数据；
-- 应用层 zod / KIND_BY_SCOPE 已不再接受 'observe'。
CREATE TYPE sku_correction_kind AS ENUM ('missed', 'false_positive', 'remove', 'add', 'observe');
CREATE TYPE sku_correction_scope AS ENUM ('detection', 'decision');

CREATE TYPE price_change_source AS ENUM ('manual', 'ai_suggest', 'rule_engine');

CREATE TYPE competitor_kind AS ENUM ('online', 'offline');

CREATE TYPE poster_mode AS ENUM ('photo_compose', 'official_bg_only', 'multi_product');
CREATE TYPE poster_template AS ENUM ('vibrant', 'premium', 'minimal', 'custom');
CREATE TYPE poster_generation_status AS ENUM ('queued', 'claimed', 'processing', 'succeeded', 'failed', 'canceled');
