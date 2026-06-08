-- =============================================================================
-- V002__enum_types.sql
-- 域：自定义枚举类型
-- 内容：
--   - app_role            用户角色（决策 D1：super_admin 拥有跨门店特权）
--   - user_status         用户状态
--   - auth_method         登录方式（决策 D2：分阶段切换）
--   - feishu_client_type  飞书客户端类型
--   - store_ownership     直营 / 加盟
--   - user_store_role     用户在门店中的角色
--   - product_status      商品状态
--   - competitor_kind     竞品渠道类型
--   - benchmark_segment   基准 SKU 段
--   - assortment_action   上下架动作（决策 D4）
--   - assortment_reason   上下架原因码
--   - price_change_source 调价来源（决策 D3）
--   - shelf_runtime_status / virtual_shelf_status
--   - sku_correction_kind / reason
--   - promotion_scope     选品 SKU 级促销文案范围
--   - poster_mode         海报生成模式（决策 D5）
--   - poster_job_status   海报队列任务状态
--   - poster_template     海报模板（决策 D9：写在代码，但 enum 用于审计字段）
--   - audit_event_kind    审计事件类型（决策 D7、D11）
--   - usage_session_status
-- =============================================================================

-- 决策 D1：super_admin 可访问所有门店，普通 store_owner 仅访问 user_stores 关联记录
CREATE TYPE app_role AS ENUM ('super_admin', 'store_owner', 'analyst', 'account_manager');

CREATE TYPE user_status AS ENUM ('active', 'disabled');

-- 决策 D2：分阶段切换 —— feishu 主路径，legacy_password 兜底
CREATE TYPE auth_method AS ENUM ('feishu_qr', 'feishu_h5', 'legacy_password');

CREATE TYPE feishu_client_type AS ENUM ('feishu_h5', 'feishu_pc', 'browser');

CREATE TYPE store_ownership AS ENUM ('direct', 'franchise');

CREATE TYPE user_store_role AS ENUM ('manager', 'viewer');

CREATE TYPE product_status AS ENUM ('active', 'delisted');

CREATE TYPE competitor_kind AS ENUM ('online', 'offline');

CREATE TYPE benchmark_segment AS ENUM ('core', 'innovation');

-- 决策 D4：上下架动作；ops_store_assortment_change 每行一个动作
CREATE TYPE assortment_action AS ENUM ('add', 'remove', 'replace');

-- 上下架原因码（与 AI 推理结果对齐，前端可显示）
CREATE TYPE assortment_reason AS ENUM (
  'ai_recommend_core',          -- AI 建议保留 / 上架（基准）
  'ai_recommend_innovation',    -- AI 建议上架（创新）
  'low_sales',                  -- 销量不达标
  'competitor_replace',         -- 竞品替换
  'shelf_space_limit',          -- 货架空间不足
  'manual_keep',                -- 店长手动保留
  'manual_remove',              -- 店长手动下架
  'other'
);

-- 决策 D3：每次调价插快照；price_change_source 记录调价来源
CREATE TYPE price_change_source AS ENUM ('manual', 'ai_suggest', 'rule_engine');

-- 货架运行时状态
CREATE TYPE shelf_runtime_status AS ENUM ('empty', 'photo_uploaded', 'detected', 'reviewing', 'confirmed');

-- 虚拟货架生成状态
CREATE TYPE virtual_shelf_status AS ENUM ('idle', 'pending', 'running', 'succeeded', 'failed');

-- 勘误类型
CREATE TYPE sku_correction_kind AS ENUM ('missed', 'false_positive');

CREATE TYPE sku_correction_reason AS ENUM (
  'obstruction',      -- 遮挡
  'low_resolution',   -- 拍照模糊
  'new_sku',          -- 新品未训练
  'similar_packaging',-- 相似包装识别混淆
  'other'
);

-- 选品 SKU 级促销文案范围
CREATE TYPE promotion_scope AS ENUM ('all_stores', 'city', 'store_list');

-- 决策 D5：海报模式
CREATE TYPE poster_mode AS ENUM ('photo_compose', 'official_bg_only', 'multi_product');

-- 海报队列任务状态
CREATE TYPE poster_job_status AS ENUM ('queued', 'claimed', 'processing', 'succeeded', 'failed', 'canceled');

-- 决策 D9：模板代码内置，此 enum 用于审计字段；未来加模板就扩这里
CREATE TYPE poster_template AS ENUM ('vibrant', 'premium', 'minimal', 'custom');

-- 决策 D7 + D11：统一审计事件类型；用 event_kind 区分关键 AI 调用
CREATE TYPE audit_event_kind AS ENUM (
  -- 身份与会话
  'user_login',
  'user_logout',
  'user_session_refresh',
  'feishu_oauth_success',
  'feishu_oauth_fail',
  -- 账号管理
  'user_create',
  'user_update',
  'user_disable',
  'user_delete',
  'user_password_reset',
  'user_role_change',
  'user_store_bind',
  'user_store_unbind',
  -- 门店主数据
  'store_create',
  'store_update',
  'store_insight_update',
  -- 商品 / 销售 / 竞品
  'sku_import',
  'competitor_price_import',
  -- 选品业务
  'shelf_config_change',
  'shelf_photo_upload',
  'shelf_detect',
  'shelf_survey_submit',
  'shelf_assortment_apply',     -- 一键应用调改
  'shelf_virtual_generate',     -- 虚拟货架生成 (AI 关键调用)
  'sku_correction_submit',
  -- 价盘业务
  'price_change',               -- 调价 (业务表 + 审计两层)
  'price_ai_diagnose',          -- 价盘 AI 诊断 (AI 关键调用)
  -- 海报业务
  'poster_generate_sync',       -- 单张同步生成
  'poster_batch_submit',        -- 批量入队
  'poster_job_complete',
  'poster_job_fail',
  'promotion_batch_upload',
  'promotion_batch_activate',
  'promotion_batch_delete',
  -- 超管 / 系统
  'super_admin_action',
  'app_setting_change',
  'ai_model_switch',
  'ai_stress_test'
);

CREATE TYPE usage_session_status AS ENUM ('active', 'ended', 'timeout');

-- 设置值类型，方便前端按类型解释
CREATE TYPE app_setting_value_type AS ENUM ('string', 'int', 'float', 'bool', 'json');
