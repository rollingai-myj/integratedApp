-- =============================================================================
-- V003__sys_crosscutting.sql
-- B2 系统横切：sys_audit_events / sys_usage_sessions / sys_settings
-- =============================================================================

CREATE TABLE sys_audit_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind         audit_event_kind NOT NULL,
  actor_user_id      UUID,           -- 快照语义，约定无 FK（约束 #10：append-only 可悬挂）
  actor_role         TEXT,
  actor_display_name TEXT,
  target_store_id    UUID,
  target_store_label TEXT,
  target_type        TEXT,
  target_id          TEXT,
  summary            TEXT,
  payload            JSONB NOT NULL DEFAULT '{}',
  is_ai_call         BOOLEAN NOT NULL DEFAULT false,
  ai_workflow        TEXT,
  ai_model           TEXT,
  ai_input_tokens    INT,
  ai_output_tokens   INT,
  ai_latency_ms      INT,
  ai_status          TEXT,
  ai_error           TEXT,
  request_id         TEXT,
  ip                 INET,
  user_agent         TEXT,
  client_type        client_type,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sys_audit_events_kind_idx  ON sys_audit_events (event_kind, created_at DESC);
CREATE INDEX sys_audit_events_store_idx ON sys_audit_events (target_store_id, created_at DESC);
CREATE INDEX sys_audit_events_actor_idx ON sys_audit_events (actor_user_id, created_at DESC);

COMMENT ON TABLE sys_audit_events IS '系统操作流水账（append-only）：每个写操作必须落一条（约束 #12，auditMiddleware）';

CREATE TABLE sys_usage_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_session_id   UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  device_id         TEXT,
  status            usage_session_status NOT NULL DEFAULT 'active',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  ended_reason      TEXT,
  duration_seconds  INT GENERATED ALWAYS AS
                      (CASE WHEN ended_at IS NULL THEN NULL
                            ELSE EXTRACT(EPOCH FROM (ended_at - started_at))::INT END) STORED,
  attributes        JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sys_usage_sessions_auth_idx ON sys_usage_sessions (auth_session_id, started_at DESC);

COMMENT ON TABLE sys_usage_sessions IS '使用时长切片：挂登录会话（user / store / 终端经 JOIN 取，不冗余存）';

CREATE TABLE sys_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  value_type  setting_value_type NOT NULL DEFAULT 'string',
  description TEXT,
  category    TEXT,
  is_secret   BOOLEAN NOT NULL DEFAULT false,
  updated_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sys_settings IS '运营可调的全局配置（如海报 AI 模型）';
