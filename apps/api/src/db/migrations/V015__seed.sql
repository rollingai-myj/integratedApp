-- =============================================================================
-- V015__seed.sql
-- 域：初始种子数据
--
-- 内容：
--   1. app_settings 默认值（图片模型、限额、会话 TTL 等）
--   2. 一个占位超管账号（admin / changeme，M1 接通后必须立刻改）
--   3. plan_position_mapping 示例场景（糖巧、面包架、冷藏柜）
--
-- 决策 D12：本文件不包含自动清理任务（pg_cron）。M5 加。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. app_settings 默认值
-- -----------------------------------------------------------------------------
INSERT INTO app_settings (key, value, value_type, description, category) VALUES
  -- AI 配置
  ('image_model',                  'google/gemini-3.1-flash-image-preview', 'string', '海报 AI 图片生成模型（PO-F10 / PO-F11 后台切换）', 'ai'),
  ('ai_workflow_timeout_seconds',  '60',                                     'int',    '单次 AI 工作流调用超时（秒）',                    'ai'),
  -- 业务限额
  ('daily_poster_limit_per_store', '999999',                                 'int',    '单店每日海报生成上限（决策 D5 默认无限制）',     'limits'),
  ('poster_batch_max_size',        '10',                                     'int',    'PO-D1 单次批量入队的最大任务数',                   'limits'),
  ('promotion_upload_max_rows',    '20000',                                  'int',    'PO-E1 单次 Excel 上传最大行数',                    'limits'),
  -- 会话
  ('feishu_session_ttl_seconds',   '7200',                                   'int',    '登录会话有效期（秒）',                            'general'),
  ('usage_heartbeat_timeout_seconds', '90',                                  'int',    '使用会话心跳超时（超过判定 timeout）',            'general'),
  -- 功能开关
  ('feature_legacy_password_login','true',                                   'bool',   '是否允许账号 + 密码登录（决策 D2：M1 阶段开启，全量切换后关闭）', 'feature_flag'),
  ('feature_admin_load_test',      'true',                                   'bool',   '是否允许后台 AI 压测入口（PO-F12）',               'feature_flag')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 占位超管账号
--
-- 默认密码：changeme
--   - bcrypt 哈希用 pgcrypto.crypt() 现场生成（V001 已装 pgcrypto）
--   - M1 接通后必须立刻通过后台改密
--   - 飞书 SSO 全量上线后整个 legacy_password 走 D2 关闭
-- -----------------------------------------------------------------------------
INSERT INTO users (display_name, legacy_account, legacy_password_hash, status)
SELECT 'Super Admin', 'admin', crypt('changeme', gen_salt('bf')), 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE legacy_account = 'admin');

-- 赋予超管角色
INSERT INTO user_roles (user_id, role)
SELECT u.id, 'super_admin'::app_role
FROM users u
WHERE u.legacy_account = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'super_admin'
  );

-- -----------------------------------------------------------------------------
-- 3. plan_position_mapping 示例场景定义
--
-- 一个场景对应多个品类时建多行。
-- 真实运营时由超管在后台维护（V008 表）。
-- -----------------------------------------------------------------------------
INSERT INTO plan_position_mapping (position_code, position_name, category_name, display_order)
VALUES
  (0, '糖巧',     '糖果',     0),
  (0, '糖巧',     '巧克力',   1),
  (1, '面包架',   '面包',     0),
  (1, '面包架',   '糕点',     1),
  (2, '冷藏柜',   '碳酸饮料', 0),
  (2, '冷藏柜',   '果汁',     1),
  (2, '冷藏柜',   '茶饮料',   2),
  (3, '冰柜',     '雪糕',     0),
  (3, '冰柜',     '冷冻食品', 1),
  (4, '零食货架', '膨化食品', 0),
  (4, '零食货架', '坚果炒货', 1),
  (4, '零食货架', '蜜饯果干', 2)
ON CONFLICT DO NOTHING;
