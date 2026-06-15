-- =============================================================================
-- V008__store_actions.sql
-- S3 业务场景（动作历史，海报除外）：
--   store_scene_adjustments / store_assortment_changes / store_scene_remakes /
--   store_scene_virtual_history / store_sku_corrections / store_price_changes
-- =============================================================================

CREATE TABLE store_scene_adjustments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene                SMALLINT NOT NULL REFERENCES hq_categories(scene),
  summary_text         TEXT,
  added_count          INT NOT NULL DEFAULT 0,
  removed_count        INT NOT NULL DEFAULT 0,
  items                JSONB NOT NULL DEFAULT '[]',   -- 提交时不可变快照（仅回显；统计走明细表）
  ai_session_id        TEXT,
  triggered_by         UUID REFERENCES users(id),
  triggered_by_display TEXT,
  triggered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_scene_adjustments_scene_idx
  ON store_scene_adjustments (store_id, scene, triggered_at DESC);

COMMENT ON TABLE store_scene_adjustments IS '调改批次摘要：每次"应用调改"一条；仅 add/remove 入记录';

CREATE TABLE store_assortment_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id         UUID REFERENCES hq_products(id),
  sku_code           VARCHAR(64) NOT NULL,
  action             assortment_action NOT NULL,
  reason_code        assortment_reason NOT NULL DEFAULT 'other',
  reason_text        TEXT,
  scene              SMALLINT NOT NULL REFERENCES hq_categories(scene),
  -- 约束 #4：批次删除时明细保留（动作发生过就是发生过）
  adjustment_id      UUID REFERENCES store_scene_adjustments(id) ON DELETE SET NULL,
  ai_diagnosis       JSONB NOT NULL DEFAULT '{}',
  effective_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by         UUID REFERENCES users(id),
  created_by_display TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_assortment_changes_scene_idx
  ON store_assortment_changes (store_id, scene, created_at DESC);
CREATE INDEX store_assortment_changes_adj_idx ON store_assortment_changes (adjustment_id);

COMMENT ON TABLE store_assortment_changes IS '上/下架动作明细（add/remove），可追溯 AI 推荐原因';

CREATE TABLE store_scene_remakes (
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene              SMALLINT NOT NULL REFERENCES hq_categories(scene),
  remake_count       INT NOT NULL DEFAULT 0,
  last_remake_at     TIMESTAMPTZ,
  last_adjustment_id UUID REFERENCES store_scene_adjustments(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, scene)
);

COMMENT ON TABLE store_scene_remakes IS '每个场景累计调改次数（计数缓存，源头是 adjustments）';

CREATE TABLE store_scene_virtual_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene         SMALLINT NOT NULL REFERENCES hq_categories(scene),
  image_url     TEXT NOT NULL,
  raw_output    JSONB,
  ai_model      TEXT,
  ai_session_id TEXT,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by  UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_scene_virtual_history_scene_idx
  ON store_scene_virtual_history (store_id, scene, generated_at DESC);

COMMENT ON TABLE store_scene_virtual_history IS '虚拟陈列生成存档，可回看历史版本';

CREATE TABLE store_sku_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene           SMALLINT NOT NULL REFERENCES hq_categories(scene),
  product_id      UUID REFERENCES hq_products(id),   -- 可空：未入库新品
  sku_code        VARCHAR(64) NOT NULL,
  correction_kind  sku_correction_kind NOT NULL,
  correction_scope sku_correction_scope NOT NULL,
  -- 原因码 TEXT：预设原因由应用层按建议类型维护（2026-06-12 确认）
  reason_code     TEXT NOT NULL,
  reason_text     TEXT,
  evidence_image_url TEXT,
  submitted_by    UUID REFERENCES users(id),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 约束 #5：kind × scope 配对（decision ↔ remove/add；
  --        observe 历史值仅为兼容旧数据保留在 CHECK 中，应用层 zod 已不再接受）
  CONSTRAINT store_sku_corrections_kind_scope_chk CHECK (
    (correction_scope = 'detection' AND correction_kind IN ('missed', 'false_positive')) OR
    (correction_scope = 'decision'  AND correction_kind IN ('remove', 'add', 'observe'))
  )
);

CREATE INDEX store_sku_corrections_scene_idx
  ON store_sku_corrections (store_id, scene, submitted_at DESC);

COMMENT ON TABLE store_sku_corrections IS '店长对 AI 的纠错（逐条确认的"跳过+原因"落这里）；后续 AI 方案自动规避';

CREATE TABLE store_price_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES hq_products(id),
  sku_code           VARCHAR(64) NOT NULL,
  old_price          NUMERIC(12,2),
  new_price          NUMERIC(12,2) NOT NULL,
  source             price_change_source NOT NULL DEFAULT 'manual',
  ai_advice          JSONB NOT NULL DEFAULT '{}',
  ai_model           TEXT,
  note               TEXT,
  effective_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  changed_by         UUID REFERENCES users(id),
  changed_by_display TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX store_price_changes_sku_idx
  ON store_price_changes (store_id, product_id, created_at DESC);

COMMENT ON TABLE store_price_changes IS '调价流水——调价数据唯一归属；只写流水不写快照，效果 = 流水 × 前后两期导入快照对比';
