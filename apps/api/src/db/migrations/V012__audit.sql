-- =============================================================================
-- V012__audit.sql
-- 域：操作审计 + 使用会话
--
-- 决策 D7：业务表（poster记录、ops_*流水等）+ 统一审计表
--   - 所有有"留痕"价值的操作都额外写一条到 audit_events
--   - 老接口（poster 的 listLoginEvents）通过 v_login_events 视图兼容
--
-- 决策 D11：关键 AI 调用落库
--   - 用 audit_events.is_ai_call + payload 区分 AI 调用
--   - 不另建 ai_calls 表
--
-- 内容：
--   - audit_events       审计事件主表
--   - v_login_events     登录事件视图（兼容老接口）
--   - usage_sessions     使用会话（心跳保活）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 审计事件
--   - 所有关键操作都写一行
--   - event_kind 枚举见 V002（audit_event_kind）
--   - target_type + target_id 用作松散的目标引用（不强制 FK，避免业务表删除时连带丢失审计）
-- -----------------------------------------------------------------------------
CREATE TABLE audit_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind          audit_event_kind NOT NULL,
  -- 执行人（NULL 表示系统 / 匿名）
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role          app_role,                                -- 执行时所拥有的角色（快照）
  actor_display_name  TEXT,                                    -- 显示名快照（即使用户改名也保留当时记录）
  -- 影响的门店
  target_store_id     UUID REFERENCES stores(id) ON DELETE SET NULL,
  target_store_label  TEXT,                                    -- 门店名快照
  -- 目标对象（松散引用，便于跨业务）
  target_type         TEXT,                                    -- 'poster' / 'price_change' / 'shelf' / 'user' / ...
  target_id           TEXT,                                    -- 字符串，便于跨表
  -- 详情
  summary             TEXT,                                    -- 一句话概述（便于后台列表显示）
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,      -- 操作详情（参数、变更前后值等）
  -- 决策 D11：AI 关键调用标记
  is_ai_call          BOOLEAN NOT NULL DEFAULT FALSE,
  ai_workflow         TEXT,                                    -- 'selection' / 'align' / 'price_diagnose' / 'poster_generate' ...
  ai_model            TEXT,                                    -- 实际使用模型
  ai_input_tokens     INT,                                     -- 可选：输入 token 数
  ai_output_tokens    INT,                                     -- 可选：输出 token 数
  ai_latency_ms       INT,                                     -- 可选：耗时
  ai_status           TEXT,                                    -- 'success' / 'fail' / 'timeout'
  ai_error            TEXT,                                    -- AI 错误信息（仅失败时填）
  -- 请求上下文
  request_id          TEXT,                                    -- 配合后端 request-id 中间件
  ip                  INET,
  user_agent          TEXT,
  client_type         feishu_client_type,                      -- 飞书 H5 / PC / 浏览器
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 时间序索引（后台列表主要查询）
CREATE INDEX idx_audit_events_time          ON audit_events (created_at DESC);
CREATE INDEX idx_audit_events_kind_time     ON audit_events (event_kind, created_at DESC);
CREATE INDEX idx_audit_events_user_time     ON audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_events_store_time    ON audit_events (target_store_id, created_at DESC)
  WHERE target_store_id IS NOT NULL;
-- 目标对象反查（"这张海报的所有操作记录"）
CREATE INDEX idx_audit_events_target        ON audit_events (target_type, target_id, created_at DESC)
  WHERE target_type IS NOT NULL AND target_id IS NOT NULL;
-- 决策 D11：AI 调用查询
CREATE INDEX idx_audit_events_ai_workflow   ON audit_events (ai_workflow, created_at DESC)
  WHERE is_ai_call = TRUE;
CREATE INDEX idx_audit_events_ai_failed     ON audit_events (created_at DESC)
  WHERE is_ai_call = TRUE AND ai_status = 'fail';

-- -----------------------------------------------------------------------------
-- 登录事件视图（兼容旧接口 PO-F1 listLoginEvents）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_login_events AS
SELECT
  ae.id,
  ae.actor_user_id        AS user_id,
  ae.actor_display_name   AS user_display_name,
  ae.target_store_id      AS store_id,
  ae.target_store_label   AS store_label,
  ae.ip,
  ae.user_agent,
  ae.client_type,
  ae.summary,
  ae.created_at
FROM audit_events ae
WHERE ae.event_kind = 'user_login';

COMMENT ON VIEW v_login_events IS
  '登录事件视图：兼容老海报项目的 listLoginEvents 接口。底层来自 audit_events.event_kind=user_login。';

-- -----------------------------------------------------------------------------
-- 使用会话（PO-G1 / PO-G2 / PO-G3）
--   - 心跳保活：前端每 30 秒一次 PO-G2 更新 last_heartbeat_at
--   - 超过 90 秒无心跳算 timeout（应用层定时扫描）
--   - 用于后台统计「日活 / 周活」、单店在线时长
-- -----------------------------------------------------------------------------
CREATE TABLE usage_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  store_id             UUID REFERENCES stores(id)          ON DELETE SET NULL,
  -- 客户端信息
  client_type          feishu_client_type,
  user_agent           TEXT,
  ip                   INET,
  device_id            TEXT,                                   -- 与 device_bindings.device_id 对齐（可选）
  -- 状态机
  status               usage_session_status NOT NULL DEFAULT 'active',
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ,
  ended_reason         TEXT,                                   -- 'logout' / 'timeout' / 'forced'
  -- 衍生
  duration_seconds     INT GENERATED ALWAYS AS (
    CASE
      WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))::INT
      ELSE EXTRACT(EPOCH FROM (ended_at - started_at))::INT
    END
  ) STORED,
  attributes           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 当前用户的活跃会话（应用层判定「已登录中」）
CREATE INDEX idx_usage_sessions_active
  ON usage_sessions (user_id, last_heartbeat_at DESC)
  WHERE status = 'active';

-- 后台「日活 / 在线时长」统计
CREATE INDEX idx_usage_sessions_started      ON usage_sessions (started_at DESC);
CREATE INDEX idx_usage_sessions_store_recent ON usage_sessions (store_id, started_at DESC)
  WHERE store_id IS NOT NULL;

-- 决策 D12：清理过程数据 —— ended_at < now() - 90d 的会话可归档
COMMENT ON TABLE usage_sessions IS
  '使用会话表。决策 D12：M5 实现清理策略，90 天前的 ended 会话归档或删除。';
