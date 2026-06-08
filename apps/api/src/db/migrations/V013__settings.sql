-- =============================================================================
-- V013__settings.sql
-- 域：全局应用配置
--
-- 用途：
--   - 当前用的 AI 图片模型（PO-F10 / PO-F11 后台可切换）
--   - 单店每日海报上限
--   - 登录会话有效期
--   - 其它运营可调的开关
--
-- 设计原则：
--   - 每条配置 key/value，value_type 让前端按类型解释
--   - 改配置必须写 audit_events（在应用层做）
-- =============================================================================

CREATE TABLE app_settings (
  key            TEXT PRIMARY KEY,                              -- 全局唯一 key
  value          TEXT NOT NULL,                                 -- 值（按 value_type 解释）
  value_type     app_setting_value_type NOT NULL DEFAULT 'string',
  description    TEXT,                                          -- 配置说明（后台展示）
  category       TEXT,                                          -- 分组（'ai' / 'limits' / 'feature_flag' / 'general'）
  is_secret      BOOLEAN NOT NULL DEFAULT FALSE,                -- 是否敏感（后台只显示已脱敏的值）
  -- 修改追溯
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_settings_category ON app_settings (category) WHERE category IS NOT NULL;

COMMENT ON TABLE app_settings IS
  '全局应用配置表。改配置请走后台接口，由应用层同时写 audit_events 留痕。';
