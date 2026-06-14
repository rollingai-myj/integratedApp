-- =============================================================================
-- V002__identity_org.sql
-- B1 身份与组织：users / stores / user_roles / user_stores /
--                user_feishu_identities / user_sessions
-- =============================================================================

CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name         TEXT NOT NULL,
  email                TEXT,
  avatar_url           TEXT,
  phone                TEXT,
  legacy_account       TEXT,
  legacy_password_hash TEXT,
  status               user_status NOT NULL DEFAULT 'active',
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

-- 软删表的 partial UQ（约束 #11）
CREATE UNIQUE INDEX users_email_uq
  ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_legacy_account_uq
  ON users (legacy_account) WHERE legacy_account IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE users IS '能登录系统的人：店长、运营、分析师、超级管理员';
COMMENT ON COLUMN users.legacy_account IS '账密登录兜底（飞书全量后清空并删列）';

CREATE TABLE stores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code       VARCHAR(32) NOT NULL UNIQUE,  -- 约束 #8：非 partial，软删后编号不可复用
  store_name       TEXT NOT NULL,
  ownership        store_ownership NOT NULL DEFAULT 'franchise',
  province         TEXT,
  city             TEXT,
  district         TEXT,
  address          TEXT,
  latitude         NUMERIC(9,6),
  longitude        NUMERIC(9,6),
  opened_at        DATE,
  is_project_store BOOLEAN NOT NULL DEFAULT false,
  status           user_status NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

COMMENT ON TABLE stores IS '美宜佳门店档案';

CREATE TABLE user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  system_role system_role NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(id),
  PRIMARY KEY (user_id, system_role)
);

CREATE TABLE user_stores (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, store_id)
);

COMMENT ON TABLE user_stores IS '一个人管哪几家店；飞书登录按部门路径追加写、不删除';

CREATE TABLE user_feishu_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  open_id          TEXT NOT NULL UNIQUE,
  union_id         TEXT,
  tenant_key       TEXT,
  feishu_email     TEXT,
  feishu_mobile    TEXT,
  feishu_name      TEXT,
  feishu_avatar_url TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  bound_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  auth_method     auth_method NOT NULL,
  client_type     client_type NOT NULL DEFAULT 'browser',
  active_store_id UUID REFERENCES stores(id),
  user_agent      TEXT,
  ip              INET,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id, expires_at DESC);

COMMENT ON TABLE user_sessions IS '登录会话：谁在线、正在管哪家店（active_store_id 唯一改它的入口是 portal 切店）';
