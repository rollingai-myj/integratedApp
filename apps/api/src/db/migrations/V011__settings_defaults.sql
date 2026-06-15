-- =============================================================================
-- V011__settings_defaults.sql
-- 全局配置基线（沿用现行运营值；密钥类不入库）
-- =============================================================================

INSERT INTO sys_settings (key, value, value_type, description, category) VALUES
  ('poster_image_model',             'google/gemini-2.5-flash-image',         'string', '海报生成使用的图像模型', 'ai'),
  ('ai_workflow_timeout_seconds',    '60',     'int',  'AI 工作流超时（秒）',           'ai'),
  ('daily_poster_limit_per_store',   '999999', 'int',  '每店每日海报生成上限',           'limits'),
  ('poster_batch_max_size',          '10',     'int',  '海报单次批量任务上限',           'limits'),
  ('promotion_upload_max_rows',      '20000',  'int',  '促销 Excel 最大行数',           'limits'),
  ('feishu_session_ttl_seconds',     '7200',   'int',  '飞书会话有效期（秒）',           'general'),
  ('usage_heartbeat_timeout_seconds','90',     'int',  '使用会话心跳超时（秒）',         'general'),
  ('feature_legacy_password_login',  'true',   'bool', '是否允许账密登录（过渡期开关）', 'feature_flag'),
  ('feature_admin_load_test',        'true',   'bool', '是否开放海报压测工具',           'feature_flag')
ON CONFLICT (key) DO NOTHING;
