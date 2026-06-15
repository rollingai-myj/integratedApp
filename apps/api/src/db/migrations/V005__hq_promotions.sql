-- =============================================================================
-- V005__hq_promotions.sql
-- G2 促销活动：hq_promo_batches / hq_promo_batch_items / hq_promo_mix_groups /
--              hq_promo_sku_texts
-- 不变量（约束 #3）：批次一经上传即冻结，快照字段不随 hq_products 变化
-- =============================================================================

CREATE TABLE hq_promo_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name      TEXT NOT NULL,
  source_file_url TEXT,
  uploaded_by    UUID REFERENCES users(id),
  row_total      INT NOT NULL DEFAULT 0,
  product_count  INT NOT NULL DEFAULT 0,
  group_count    INT NOT NULL DEFAULT 0,
  parse_warnings JSONB NOT NULL DEFAULT '[]',
  is_active      BOOLEAN NOT NULL DEFAULT false,
  activated_at   TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  notes          TEXT,
  attributes     JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 约束 #9：同一时间仅一期批次生效
CREATE UNIQUE INDEX hq_promo_batches_one_active_uq ON hq_promo_batches (is_active) WHERE is_active;

COMMENT ON TABLE hq_promo_batches IS '总部促销批次（Excel 整批上传）。不变量：批次一经上传即冻结——快照字段不随主数据变化，组层聚合与单品层一致性由单测保证';

CREATE TABLE hq_promo_batch_items (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                  UUID NOT NULL REFERENCES hq_promo_batches(id) ON DELETE CASCADE,
  row_index                 INT NOT NULL,
  sku_code                  VARCHAR(64) NOT NULL,
  product_name              TEXT NOT NULL,
  unit                      TEXT,
  category_name             TEXT,
  original_price            NUMERIC(12,2),
  product_id                UUID REFERENCES hq_products(id),
  best_label                TEXT,
  best_required_qty         INT,
  best_total_price          NUMERIC(12,2),
  best_effective_unit_price NUMERIC(12,2),
  best_saving_percent       NUMERIC(6,2),
  all_options               JSONB NOT NULL DEFAULT '[]',
  valid_from                DATE,
  valid_to                  DATE,
  valid_dates               DATE[],
  mix_group_code            TEXT,
  display_text              TEXT,
  attributes                JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_index)
);

CREATE INDEX hq_promo_batch_items_batch_idx ON hq_promo_batch_items (batch_id);
CREATE INDEX hq_promo_batch_items_sku_idx   ON hq_promo_batch_items (sku_code);

COMMENT ON TABLE hq_promo_batch_items IS '批次内单品促销规则（上传时点冻结的商品快照 + 已算好的最优档）';

CREATE TABLE hq_promo_mix_groups (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                 UUID NOT NULL REFERENCES hq_promo_batches(id) ON DELETE CASCADE,
  mix_group_code           TEXT NOT NULL,
  display_name             TEXT,
  category_name            TEXT,
  sku_codes                TEXT[] NOT NULL DEFAULT '{}',  -- 批次冻结快照
  product_count            INT NOT NULL DEFAULT 0,
  best_label               TEXT,
  best_total_price         NUMERIC(12,2),
  best_saving_percent      NUMERIC(6,2),
  representative_image_url TEXT,
  attributes               JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, mix_group_code)
);

COMMENT ON TABLE hq_promo_mix_groups IS '批次内可混搭凑单的商品组合（如"任选 3 件 XX 元"）';

CREATE TABLE hq_promo_sku_texts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code     VARCHAR(64) NOT NULL,
  group_name     TEXT,
  product_id     UUID REFERENCES hq_products(id),
  sku_code       VARCHAR(64) NOT NULL,
  promo_text     TEXT NOT NULL,
  category_id    UUID REFERENCES hq_categories(id),
  scope          promotion_scope NOT NULL DEFAULT 'all_stores',
  scope_cities   TEXT[],
  scope_store_ids UUID[],
  effective_from DATE,
  effective_to   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  display_order  INT NOT NULL DEFAULT 0,
  attributes     JSONB NOT NULL DEFAULT '{}',
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 约束 #6：scope 与两数组三段配对
  CONSTRAINT hq_promo_sku_texts_scope_chk CHECK (
    (scope = 'all_stores' AND scope_cities IS NULL AND scope_store_ids IS NULL) OR
    (scope = 'city'       AND scope_cities IS NOT NULL AND cardinality(scope_cities) > 0 AND scope_store_ids IS NULL) OR
    (scope = 'store_list' AND scope_store_ids IS NOT NULL AND cardinality(scope_store_ids) > 0 AND scope_cities IS NULL)
  )
);

CREATE INDEX hq_promo_sku_texts_sku_idx ON hq_promo_sku_texts (sku_code) WHERE is_active;

COMMENT ON TABLE hq_promo_sku_texts IS '选品页商品促销标语（与海报促销批次是两套独立体系）';
