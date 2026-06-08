-- =============================================================================
-- V003__users_and_org.sql
-- 域：身份与组织（业务实体清单 组 1）
-- 内容：
--   - users                         用户（决策 D2：legacy_account/password 兜底）
--   - user_feishu_identities        飞书身份绑定（一对一）
--   - auth_sessions                 登录会话
--   - user_roles                    用户角色（多对多；决策 D1：super_admin 特权）
--   - stores                        门店主数据
--   - user_stores                   用户-门店关联（决策 D1：super_admin 不需在表内即可访问全部）
--   - device_bindings               浏览器设备绑定到门店
--   - store_environment_insights    门店周边洞察（决策 D10：关键字段 + JSONB）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 决策 D2：用户表保留 legacy_account / legacy_password_hash，飞书全量上线前账密兜底
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name          TEXT NOT NULL,
  email                 TEXT,
  avatar_url            TEXT,
  phone                 TEXT,
  -- 决策 D2：账密兜底
  legacy_account        TEXT,                                 -- 老选品的"粤XXXXX"或老海报的邮箱
  legacy_password_hash  TEXT,                                 -- bcrypt 哈希；飞书上线后逐步清空
  status                user_status NOT NULL DEFAULT 'active',
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

-- 邮箱与老账号都允许 NULL，但非空时必须唯一
CREATE UNIQUE INDEX uq_users_email_active        ON users (lower(email))         WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_legacy_account      ON users (legacy_account)       WHERE legacy_account IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX        idx_users_status             ON users (status)               WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_display_name_trgm  ON users USING gin (display_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 决策 D2：飞书身份绑定 —— 一个用户最多一条飞书绑定
-- -----------------------------------------------------------------------------
CREATE TABLE user_feishu_identities (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  open_id                  TEXT NOT NULL,                    -- 当前应用范围内的飞书用户 ID
  union_id                 TEXT,                             -- 同租户跨应用稳定 ID
  tenant_key               TEXT,                             -- 飞书租户
  feishu_email             TEXT,                             -- 飞书账号邮箱（非 users.email）
  feishu_mobile            TEXT,
  feishu_name              TEXT,                             -- 飞书账号显示名
  feishu_avatar_url        TEXT,
  access_token             TEXT,                             -- 调飞书 API 用，定期刷新
  refresh_token            TEXT,
  token_expires_at         TIMESTAMPTZ,
  bound_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_feishu_user_id   ON user_feishu_identities (user_id);
CREATE UNIQUE INDEX uq_feishu_open_id   ON user_feishu_identities (open_id);
CREATE UNIQUE INDEX uq_feishu_union_id  ON user_feishu_identities (union_id) WHERE union_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 决策 D2：登录会话 —— 飞书 / 账密 都写到这里
-- -----------------------------------------------------------------------------
CREATE TABLE auth_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash           TEXT NOT NULL,                        -- 不存明文 token，仅存哈希
  auth_method          auth_method NOT NULL,
  client_type          feishu_client_type NOT NULL DEFAULT 'browser',
  active_store_id      UUID,                                 -- 决策 D1：当前激活的门店；可在多店之间切换
  user_agent           TEXT,
  ip                   INET,
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_auth_sessions_token_hash  ON auth_sessions (token_hash);
CREATE INDEX        idx_auth_sessions_user       ON auth_sessions (user_id, revoked_at);
CREATE INDEX        idx_auth_sessions_expires    ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 决策 D1：用户角色（多对多）—— super_admin 在应用层判定"全门店可见"
-- -----------------------------------------------------------------------------
CREATE TABLE user_roles (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         app_role NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role)
);

CREATE INDEX idx_user_roles_role ON user_roles (role);

-- -----------------------------------------------------------------------------
-- 门店主数据
-- -----------------------------------------------------------------------------
CREATE TABLE stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code      VARCHAR(32) NOT NULL,                      -- 业务编号，如 "粤37893"
  store_name      TEXT NOT NULL,
  ownership       store_ownership NOT NULL DEFAULT 'franchise',
  province        TEXT,
  city            TEXT,
  district        TEXT,
  address         TEXT,
  latitude        NUMERIC(9, 6),
  longitude       NUMERIC(9, 6),
  opened_at       DATE,                                      -- 开业日期
  status          user_status NOT NULL DEFAULT 'active',     -- 复用 active/disabled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_stores_store_code     ON stores (store_code) WHERE deleted_at IS NULL;
CREATE INDEX        idx_stores_city          ON stores (city);
CREATE INDEX        idx_stores_status        ON stores (status) WHERE deleted_at IS NULL;
CREATE INDEX        idx_stores_name_trgm     ON stores USING gin (store_name gin_trgm_ops);

-- 现在可以补回 auth_sessions.active_store_id 的外键
ALTER TABLE auth_sessions
  ADD CONSTRAINT fk_auth_sessions_active_store
  FOREIGN KEY (active_store_id) REFERENCES stores(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 决策 D1：用户-门店关联
--   - 普通 store_owner 仅可见 user_stores 关联门店
--   - super_admin 不需要在此表中也能访问全部门店（应用层判定）
--   - is_primary 标记"默认进入"的门店
-- -----------------------------------------------------------------------------
CREATE TABLE user_stores (
  user_id        UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role           user_store_role NOT NULL DEFAULT 'manager',
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,             -- 决策 D1：登录默认进入的门店
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, store_id)
);

CREATE INDEX        idx_user_stores_store         ON user_stores (store_id);
-- 每个用户至多一条 is_primary（partial unique index）
CREATE UNIQUE INDEX uq_user_stores_primary        ON user_stores (user_id) WHERE is_primary = TRUE;

-- -----------------------------------------------------------------------------
-- 设备绑定：浏览器 fingerprint -> 用户 -> 门店
-- 海报项目特有的"设备记住选了哪家店"机制
-- -----------------------------------------------------------------------------
CREATE TABLE device_bindings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code      TEXT NOT NULL,                            -- 浏览器自动生成的 fingerprint
  user_id          UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_agent       TEXT,
  bound_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_device_bindings_device_user   ON device_bindings (device_code, user_id);
CREATE INDEX        idx_device_bindings_store        ON device_bindings (store_id);
CREATE INDEX        idx_device_bindings_last_seen    ON device_bindings (last_seen_at);

-- -----------------------------------------------------------------------------
-- 决策 D10：门店周边洞察 —— 关键字段 + insight_data JSONB
--   关键字段：city、main_demographic、consumption_level、competitor_count、population_density
--   其余灵活信息塞 insight_data JSONB
-- -----------------------------------------------------------------------------
CREATE TABLE store_environment_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  -- 决策 D10 关键字段
  city                  TEXT,                                -- 冗余城市，方便按城市汇总
  main_demographic      TEXT,                                -- 主力人群（如"白领"、"学生"）
  consumption_level     TEXT,                                -- 消费水平（如"中高端"）
  competitor_count      INT,                                 -- 周边竞品数（数值方便排序统计）
  population_density    TEXT,                                -- 人口密度档（如"高密度居住区"）
  -- 灵活内容
  insight_data          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- AI 工作流原始输出
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  source                TEXT,                                -- 'ai_workflow' / 'manual' 等
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 一个门店一条"当前洞察"（历史快照另用归档表）
CREATE UNIQUE INDEX uq_store_insights_store   ON store_environment_insights (store_id);
CREATE INDEX        idx_store_insights_city   ON store_environment_insights (city);
