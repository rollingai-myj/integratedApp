-- =============================================================================
-- V007__ops_changes.sql
-- 域：业务操作流水（业务实体清单 组 2.4、2.5）
-- 内容：
--   - ops_store_assortment_change  上下架流水（决策 D4：每 SKU 一行，配合 V008.scene_adjustment 的批次摘要）
--   - ops_store_price_change       调价流水（决策 D3：每次调价产生一行 + 一条新销售快照）
-- 注：本文件不引用 V008.scene_adjustment 的外键，只在 batch_id 字段加业务约定注释；
--     V008 建表后也不补 FK，让两层保持松耦合（业务表与摘要表都可独立查询）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 决策 D4：上下架流水 —— 每个 SKU 一行
--   - batch_id 指向 scene_adjustment.id（V008 中建立），业务约定，不建 FK
--   - 一次"一键应用调改" = 1 条 scene_adjustment 摘要 + N 条 ops_store_assortment_change
-- -----------------------------------------------------------------------------
CREATE TABLE ops_store_assortment_change (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id)      ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES dim_product(id) ON DELETE RESTRICT,
  sku_code            VARCHAR(64) NOT NULL,
  -- 上下架动作
  action              assortment_action NOT NULL,
  reason_code         assortment_reason NOT NULL DEFAULT 'other',
  reason_text         TEXT,                                   -- AI 原因描述或店长备注
  -- 关联
  scene_code          SMALLINT,                               -- 所属场景（plan_position_mapping.position_code）
  shelf_id            UUID,                                   -- 所属货架（store_shelf_config.id），V008 建后业务可填
  batch_id            UUID,                                   -- 决策 D4：scene_adjustment.id（不建 FK，业务约定）
  ai_diagnosis        JSONB NOT NULL DEFAULT '{}'::jsonb,     -- AI 当时给的诊断（结构化）
  effective_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 审计
  operator_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  operator_display    TEXT,                                   -- 冗余操作人名，避免 join
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ops_assort_store_sku_date
  ON ops_store_assortment_change (store_id, sku_code, effective_date DESC);
CREATE INDEX idx_ops_assort_batch
  ON ops_store_assortment_change (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_ops_assort_store_scene
  ON ops_store_assortment_change (store_id, scene_code, effective_date DESC);
CREATE INDEX idx_ops_assort_action
  ON ops_store_assortment_change (action, created_at DESC);
CREATE INDEX idx_ops_assort_product
  ON ops_store_assortment_change (product_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 决策 D3：调价流水 —— 每次调价产生一行
--   - 同时（应用层）会向 fact_store_sku_weekly 插入一条 source='price_change' 的新快照
--   - fact_store_sku_weekly.price_change_id 指回本表
-- -----------------------------------------------------------------------------
CREATE TABLE ops_store_price_change (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL REFERENCES stores(id)      ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES dim_product(id) ON DELETE RESTRICT,
  sku_code            VARCHAR(64) NOT NULL,
  -- 调价信息
  old_price           NUMERIC(12, 2),
  new_price           NUMERIC(12, 2) NOT NULL,
  source              price_change_source NOT NULL DEFAULT 'manual',
  ai_advice           JSONB NOT NULL DEFAULT '{}'::jsonb,     -- AI 当时给的建议（涨/降/保持、置信度、理由）
  ai_model            TEXT,                                   -- 决策 D11：关键 AI 调用留痕（模型）
  effective_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 审计
  operator_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  operator_display    TEXT,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ops_price_store_sku_date
  ON ops_store_price_change (store_id, sku_code, effective_date DESC);
CREATE INDEX idx_ops_price_product
  ON ops_store_price_change (product_id, created_at DESC);
CREATE INDEX idx_ops_price_source
  ON ops_store_price_change (source, created_at DESC);

-- -----------------------------------------------------------------------------
-- 决策 D3：fact_store_sku_weekly.price_change_id 在 V006 已声明，本处补 FK
-- -----------------------------------------------------------------------------
ALTER TABLE fact_store_sku_weekly
  ADD CONSTRAINT fk_fact_sku_weekly_price_change
  FOREIGN KEY (price_change_id) REFERENCES ops_store_price_change(id) ON DELETE SET NULL;
