-- =============================================================================
-- V008__shelves.sql
-- 域：货盘选品业务（业务实体清单 组 4，除 4.10 周边洞察已在 V003 建）
-- 内容：
--   - plan_position_mapping     场景定义（场景编号 + 名称 + 包含的品类）
--   - store_shelf_config        门店货架配置
--   - shelf_runtime_state       货架当前状态（"现在的样子"）
--   - shelf_photos              货架最近 3 张照片（与 runtime 一对一关联）
--   - shelf_photo_history       货架照片历史
--   - shelf_survey_questions    调研问卷题目
--   - shelf_survey_answers      调研问卷答案
--   - scene_remake              场景调改次数（计数表）
--   - scene_adjustment          场景调改记录（决策 D4：批次摘要 + items JSONB）
--   - virtual_shelf_history     虚拟货架生成历史
--   - sku_corrections           SKU 勘误反馈
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 场景定义（全公司统一）
--   - 一个场景包含若干品类（如"糖巧" = 糖果 + 巧克力）
--   - 用 (position_code, category_code) 复合，1 个场景可对多个品类，建多行
-- -----------------------------------------------------------------------------
CREATE TABLE plan_position_mapping (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_code   SMALLINT NOT NULL,                         -- 场景编号 0、1、2 ...
  position_name   TEXT NOT NULL,                             -- "糖巧"、"面包架"、"冷藏柜"
  category_id     UUID REFERENCES dim_category(id) ON DELETE SET NULL,
  category_code   VARCHAR(64),                               -- 冗余便于查询
  category_name   TEXT NOT NULL,                             -- "糖果"、"巧克力"、"面包"
  display_order   INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_plan_position_mapping
  ON plan_position_mapping (position_code, category_name);
CREATE INDEX idx_plan_position_code ON plan_position_mapping (position_code);
CREATE INDEX idx_plan_position_cat  ON plan_position_mapping (category_code);

-- -----------------------------------------------------------------------------
-- 门店货架配置
-- -----------------------------------------------------------------------------
CREATE TABLE store_shelf_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shelf_code          VARCHAR(64) NOT NULL,                  -- 业务编号（门店内唯一）
  position_code       SMALLINT NOT NULL,                     -- 所属场景
  group_name          TEXT,                                  -- 货架组名
  width_cm            NUMERIC(8, 2),                         -- 宽度（厘米）
  layer_count         SMALLINT,                              -- 层数
  supported_categories TEXT[],                               -- 支持的品类名列表
  display_order       INT NOT NULL DEFAULT 0,
  notes               TEXT,
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_store_shelf_code
  ON store_shelf_config (store_id, shelf_code) WHERE deleted_at IS NULL;
CREATE INDEX        idx_store_shelf_store_position
  ON store_shelf_config (store_id, position_code);

-- -----------------------------------------------------------------------------
-- 货架当前状态（"现在的样子"）—— 一架一条
-- -----------------------------------------------------------------------------
CREATE TABLE shelf_runtime_state (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              UUID NOT NULL REFERENCES stores(id)              ON DELETE CASCADE,
  shelf_id              UUID NOT NULL REFERENCES store_shelf_config(id)  ON DELETE CASCADE,
  status                shelf_runtime_status NOT NULL DEFAULT 'empty',
  -- 当前货架上的 SKU 列表（每项 { sku_code, qty, position, ... }）
  current_skus          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- AI 检测结果（最近一次）
  last_detect_result    JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_detected_at      TIMESTAMPTZ,
  -- 虚拟货架生成
  virtual_status        virtual_shelf_status NOT NULL DEFAULT 'idle',
  virtual_last_image_url TEXT,
  virtual_last_output   JSONB NOT NULL DEFAULT '{}'::jsonb,
  virtual_last_run_at   TIMESTAMPTZ,
  -- 元数据
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_shelf_runtime_shelf  ON shelf_runtime_state (shelf_id);
CREATE INDEX        idx_shelf_runtime_store ON shelf_runtime_state (store_id);

-- -----------------------------------------------------------------------------
-- 货架最近 3 张照片（当前状态的子表，与 shelf_runtime_state 一对多但最多 3）
-- -----------------------------------------------------------------------------
CREATE TABLE shelf_photos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_id            UUID NOT NULL REFERENCES store_shelf_config(id) ON DELETE CASCADE,
  store_id            UUID NOT NULL REFERENCES stores(id)             ON DELETE CASCADE,
  slot_index          SMALLINT NOT NULL CHECK (slot_index BETWEEN 1 AND 3),
  image_url           TEXT NOT NULL,
  uploaded_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_shelf_photos_slot   ON shelf_photos (shelf_id, slot_index);
CREATE INDEX        idx_shelf_photos_store ON shelf_photos (store_id);

-- -----------------------------------------------------------------------------
-- 货架照片历史（每次拍照都留一份）
-- -----------------------------------------------------------------------------
CREATE TABLE shelf_photo_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_id      UUID NOT NULL REFERENCES store_shelf_config(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES stores(id)             ON DELETE CASCADE,
  image_urls    TEXT[] NOT NULL,                           -- 该次上传的全部照片（最多 3 张）
  detect_summary JSONB NOT NULL DEFAULT '{}'::jsonb,        -- 当次检测摘要（如 detected_skus 数）
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shelf_photo_hist_shelf_time ON shelf_photo_history (shelf_id, uploaded_at DESC);
CREATE INDEX idx_shelf_photo_hist_store_time ON shelf_photo_history (store_id, uploaded_at DESC);

-- -----------------------------------------------------------------------------
-- 调研问卷题目（AI 生成 + 人工补充）
-- -----------------------------------------------------------------------------
CREATE TABLE shelf_survey_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_id      UUID NOT NULL REFERENCES store_shelf_config(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES stores(id)             ON DELETE CASCADE,
  question_no   SMALLINT NOT NULL,                          -- 题号
  question_text TEXT NOT NULL,
  question_kind TEXT,                                       -- single / multi / text 等
  options       JSONB NOT NULL DEFAULT '[]'::jsonb,         -- 选项（若有）
  source        TEXT NOT NULL DEFAULT 'ai',                 -- 'ai' / 'manual'
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_shelf_survey_q_no   ON shelf_survey_questions (shelf_id, question_no);
CREATE INDEX        idx_shelf_survey_q_store ON shelf_survey_questions (store_id);

-- -----------------------------------------------------------------------------
-- 调研问卷答案
-- -----------------------------------------------------------------------------
CREATE TABLE shelf_survey_answers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_id      UUID NOT NULL REFERENCES store_shelf_config(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES stores(id)             ON DELETE CASCADE,
  question_id   UUID NOT NULL REFERENCES shelf_survey_questions(id) ON DELETE CASCADE,
  answer_value  JSONB NOT NULL DEFAULT '{}'::jsonb,         -- 答案（选项 id、文本、多选数组等）
  answered_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  answered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX        idx_shelf_survey_ans_q       ON shelf_survey_answers (question_id);
CREATE INDEX        idx_shelf_survey_ans_shelf   ON shelf_survey_answers (shelf_id, answered_at DESC);

-- -----------------------------------------------------------------------------
-- 决策 D4：场景调改记录（批次摘要 + items JSONB）
--   - items JSONB 包含本次所有 SKU 的上下架明细（与 ops_store_assortment_change 冗余）
--   - 应用层：先 INSERT scene_adjustment 拿到 id，再用此 id 作 batch_id 批量 INSERT
--     ops_store_assortment_change
-- -----------------------------------------------------------------------------
CREATE TABLE scene_adjustment (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  position_code       SMALLINT NOT NULL,                     -- 场景
  summary_text        TEXT,                                  -- "上架 5 个、下架 3 个"
  added_count         INT NOT NULL DEFAULT 0,
  removed_count       INT NOT NULL DEFAULT 0,
  replaced_count      INT NOT NULL DEFAULT 0,
  -- 决策 D4：完整 items 列表（每项 { action, sku_code, product_name, reason_code, reason_text }）
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- AI 关联
  ai_session_id       TEXT,                                  -- 触发本次调改的 AI 会话/工作流 id
  -- 审计
  triggered_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  triggered_display   TEXT,
  triggered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scene_adj_store_pos_time
  ON scene_adjustment (store_id, position_code, triggered_at DESC);
CREATE INDEX idx_scene_adj_triggered_by
  ON scene_adjustment (triggered_by, triggered_at DESC);
CREATE INDEX idx_scene_adj_items_gin
  ON scene_adjustment USING gin (items);

-- -----------------------------------------------------------------------------
-- 场景调改计数（门店 × 场景，每次调改 +1）
-- -----------------------------------------------------------------------------
CREATE TABLE scene_remake (
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  position_code       SMALLINT NOT NULL,
  remake_count        INT NOT NULL DEFAULT 0,
  last_remake_at      TIMESTAMPTZ,
  last_adjustment_id  UUID REFERENCES scene_adjustment(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, position_code)
);

-- -----------------------------------------------------------------------------
-- 虚拟货架生成历史（每次 AI 生成图都留一份）
-- -----------------------------------------------------------------------------
CREATE TABLE virtual_shelf_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shelf_id            UUID REFERENCES store_shelf_config(id) ON DELETE SET NULL,
  position_code       SMALLINT,
  image_url           TEXT NOT NULL,
  raw_output          JSONB NOT NULL DEFAULT '{}'::jsonb,    -- AI 完整输出
  -- 决策 D11：关键 AI 调用留痕（模型 / 提示词存在审计表，这里只存关键索引字段）
  ai_model            TEXT,
  ai_session_id       TEXT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by        UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_virtual_shelf_store_pos_time
  ON virtual_shelf_history (store_id, position_code, generated_at DESC);
CREATE INDEX idx_virtual_shelf_shelf
  ON virtual_shelf_history (shelf_id, generated_at DESC) WHERE shelf_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- SKU 勘误反馈
-- -----------------------------------------------------------------------------
CREATE TABLE sku_corrections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id)      ON DELETE CASCADE,
  shelf_id            UUID REFERENCES store_shelf_config(id)   ON DELETE SET NULL,
  product_id          UUID REFERENCES dim_product(id)          ON DELETE SET NULL,
  sku_code            VARCHAR(64) NOT NULL,
  correction_kind     sku_correction_kind NOT NULL,           -- missed / false_positive
  reason_code         sku_correction_reason NOT NULL DEFAULT 'other',
  reason_text         TEXT,
  evidence_image_url  TEXT,
  submitted_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 后台处理
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note     TEXT
);

CREATE INDEX idx_sku_corrections_store_time  ON sku_corrections (store_id, submitted_at DESC);
CREATE INDEX idx_sku_corrections_sku         ON sku_corrections (sku_code, submitted_at DESC);
CREATE INDEX idx_sku_corrections_kind        ON sku_corrections (correction_kind);
CREATE INDEX idx_sku_corrections_pending     ON sku_corrections (submitted_at DESC) WHERE resolved_at IS NULL;

-- -----------------------------------------------------------------------------
-- 现在补回 ops_store_assortment_change.shelf_id 的 FK（V007 中只声明字段，未建 FK）
-- -----------------------------------------------------------------------------
ALTER TABLE ops_store_assortment_change
  ADD CONSTRAINT fk_ops_assort_shelf
  FOREIGN KEY (shelf_id) REFERENCES store_shelf_config(id) ON DELETE SET NULL;
