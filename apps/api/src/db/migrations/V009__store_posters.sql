-- =============================================================================
-- V009__store_posters.sql
-- S3.c 促销海报：store_poster_tasks / store_poster_task_products /
--                store_poster_generations / store_poster_assets
-- 模型：任务（稳定意图）→ 生成记录（同任务多次尝试）；重新生成 = 新 attempt
-- =============================================================================

CREATE TABLE store_poster_tasks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                 UUID NOT NULL,                -- 同次批量提交的分组号（无 FK）
  user_id                  UUID NOT NULL REFERENCES users(id),
  store_id                 UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  mode                     poster_mode NOT NULL,
  template                 poster_template NOT NULL,
  custom_style_description TEXT,
  copy_text                TEXT NOT NULL,
  source_photo_url         TEXT,
  product_image_url        TEXT,
  inputs                   JSONB NOT NULL DEFAULT '{}',  -- 完整 AI 入参快照（worker 重放用）
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_poster_tasks_store_idx ON store_poster_tasks (store_id, created_at DESC);
CREATE INDEX store_poster_tasks_batch_idx ON store_poster_tasks (batch_id);

COMMENT ON TABLE store_poster_tasks IS '海报任务 = 业务意图（商品/文案/模板/底图）；换商品换文案 = 新任务';

CREATE TABLE store_poster_task_products (
  task_id       UUID NOT NULL REFERENCES store_poster_tasks(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES hq_products(id),
  sku_code      VARCHAR(64) NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, product_id)
);

COMMENT ON TABLE store_poster_task_products IS '任务商品锚点：product_id 是销量追踪的标识（约束 #14，经此关联 store_sku_snapshots）';

CREATE TABLE store_poster_generations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES store_poster_tasks(id) ON DELETE CASCADE,
  attempt_no       SMALLINT NOT NULL,
  status           poster_generation_status NOT NULL DEFAULT 'queued',
  claim_token      TEXT,
  claim_expires_at TIMESTAMPTZ,                     -- 约束 #7：worker 认领 10 分钟过期（应用层判断）
  claimed_at       TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  poster_image_url TEXT,
  thumbnail_url    TEXT,
  ai_model         TEXT,
  ai_prompt        TEXT,
  ai_response      JSONB,
  generation_ms    INT,
  error_code       TEXT,
  error_message    TEXT,
  is_adopted       BOOLEAN NOT NULL DEFAULT false,
  adopted_at       TIMESTAMPTZ,
  download_count   INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, attempt_no)
);

-- 约束 #13：每任务至多一条已采用
CREATE UNIQUE INDEX store_poster_generations_one_adopted_uq
  ON store_poster_generations (task_id) WHERE is_adopted;
CREATE INDEX store_poster_generations_status_idx
  ON store_poster_generations (status, created_at) WHERE status IN ('queued', 'claimed');

COMMENT ON TABLE store_poster_generations IS '任务下每次生成一条；采用 = 销量追踪起点（每任务至多一条）；下载计数在此';

CREATE TABLE store_poster_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('background', 'product_photo')),
  image_url   TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX store_poster_assets_store_idx
  ON store_poster_assets (store_id, kind) WHERE deleted_at IS NULL;

COMMENT ON TABLE store_poster_assets IS '海报素材库：背景照传一次永续复用；严格按店隔离（查询强制 store_id = session 店）';
