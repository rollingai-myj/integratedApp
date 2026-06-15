-- =============================================================================
-- V006__store_state.sql
-- S1 门店经营（现状）：store_scene_state / store_scene_shelves / store_sku_snapshots
-- =============================================================================

CREATE TABLE store_scene_state (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene               SMALLINT NOT NULL REFERENCES hq_categories(scene),
  status              scene_state_status NOT NULL DEFAULT 'empty',
  photos              JSONB NOT NULL DEFAULT '[]',
  detection_data      JSONB NOT NULL DEFAULT '{}',
  virtual_status      scene_virtual_status NOT NULL DEFAULT 'idle',
  virtual_raw_outputs JSONB,
  virtual_context     JSONB,
  last_snapshot       JSONB,
  -- 周边环境摘要：聊一聊沉淀，基础信息页可编辑，每次调改喂给 AI（2026-06-12 确认）
  env_crowd           TEXT,
  env_competitor      TEXT,
  -- 调改进行中草稿（阶段/照片数/逐条确认进度与决定），跨设备续作；应用或放弃后置 NULL
  draft               JSONB,
  updated_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, scene)
);

COMMENT ON TABLE store_scene_state IS '场景工作台（每店每场景一行）：照片 / 识别 / 虚拟陈列进度 / 调改草稿 / 周边环境摘要';
COMMENT ON COLUMN store_scene_state.detection_data IS 'AI 识别结果（唯一观测真值；店长确认走调改流水，不另存声明列表）';

CREATE TABLE store_scene_shelves (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scene       SMALLINT NOT NULL REFERENCES hq_categories(scene),
  group_index SMALLINT NOT NULL,
  shelf_type  TEXT,
  width_cm    NUMERIC(8,2),
  layer_count SMALLINT,
  categories  TEXT[] NOT NULL DEFAULT '{}',
  notes       TEXT,
  attributes  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, scene, group_index)
);

COMMENT ON TABLE store_scene_shelves IS '场景货架组（纯物理属性：类型/宽/层/品类）；货架不承载业务动作';

CREATE TABLE store_sku_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES hq_products(id),
  sku_code         VARCHAR(64) NOT NULL,
  snapshot_date    DATE NOT NULL,
  retail_price     NUMERIC(12,2),
  original_price   NUMERIC(12,2),
  wholesale_price  NUMERIC(12,2),
  sales_qty_30d    INT,
  sales_amount_30d NUMERIC(14,2),
  sales_qty_90d    INT,
  sales_amount_90d NUMERIC(14,2),
  gross_margin_30d NUMERIC(8,4),
  stock_qty        INT,
  last_delivery_at DATE,
  -- 约束 #2：仅外部导入来源，系统从不自行写入（调价不写快照）
  source           TEXT NOT NULL DEFAULT 'manual'
                     CONSTRAINT store_sku_snapshots_source_chk CHECK (source IN ('erp_sync', 'manual')),
  imported_by      UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id, snapshot_date, source)
);

CREATE INDEX store_sku_snapshots_curve_idx ON store_sku_snapshots (store_id, product_id, snapshot_date DESC);
CREATE INDEX store_sku_snapshots_date_idx  ON store_sku_snapshots (store_id, snapshot_date DESC);

COMMENT ON TABLE store_sku_snapshots IS '每周外部导入的本店销售快照——选品/调价的决策依据；所有"效果"= 前后两期快照对比';
