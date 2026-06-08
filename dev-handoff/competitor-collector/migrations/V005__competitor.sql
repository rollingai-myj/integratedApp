-- =============================================================================
-- V005__competitor.sql
-- 域：竞品数据（业务实体清单 组 3）
-- 内容：
--   - dim_competitor_channel        竞品渠道（罗森、7-11、天猫超市等）
--   - dim_competitor_product        竞品商品（映射到我们自己的 SKU）
--   - fact_competitor_price_weekly  竞品价格快照（周度）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 竞品渠道
-- -----------------------------------------------------------------------------
CREATE TABLE dim_competitor_channel (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_code    VARCHAR(64) NOT NULL,                      -- 业务编码（如 "LAWSON"、"711"、"TMALL"）
  channel_name    TEXT NOT NULL,                             -- 显示名（"罗森"、"7-11"、"天猫超市"）
  kind            competitor_kind NOT NULL,                  -- online / offline
  -- 线下竞品才有
  province        TEXT,
  city            TEXT,
  address         TEXT,
  -- 价格特征
  price_uniform   BOOLEAN NOT NULL DEFAULT FALSE,            -- 是否全国统一价（影响是否带门店维度）
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_competitor_channel_code   ON dim_competitor_channel (channel_code);
CREATE INDEX        idx_competitor_channel_kind  ON dim_competitor_channel (kind);
CREATE INDEX        idx_competitor_channel_city  ON dim_competitor_channel (city);

-- -----------------------------------------------------------------------------
-- 竞品商品：竞品平台上的某条商品，映射到我们自己的 SKU
-- -----------------------------------------------------------------------------
CREATE TABLE dim_competitor_product (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id               UUID NOT NULL REFERENCES dim_competitor_channel(id) ON DELETE CASCADE,
  external_sku             VARCHAR(128),                     -- 竞品平台上的商品 ID（可为空）
  product_name             TEXT NOT NULL,
  brand                    TEXT,
  spec                     TEXT,
  -- 映射到我们的 SKU（一对一）
  mapped_sku_code          VARCHAR(64),                      -- 引用 dim_product.sku_code
  mapped_product_id        UUID REFERENCES dim_product(id) ON DELETE SET NULL,
  -- 元数据
  product_url              TEXT,                             -- 竞品商品页 URL（线上）
  image_url                TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX        idx_competitor_product_channel    ON dim_competitor_product (channel_id);
CREATE INDEX        idx_competitor_product_mapped_sku ON dim_competitor_product (mapped_sku_code) WHERE mapped_sku_code IS NOT NULL;
CREATE INDEX        idx_competitor_product_mapped_id  ON dim_competitor_product (mapped_product_id) WHERE mapped_product_id IS NOT NULL;
CREATE INDEX        idx_competitor_product_name_trgm  ON dim_competitor_product USING gin (product_name gin_trgm_ops);
-- 同一渠道下相同 external_sku 唯一
CREATE UNIQUE INDEX uq_competitor_product_ext        ON dim_competitor_product (channel_id, external_sku) WHERE external_sku IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 竞品价格快照：渠道 × 竞品 × 快照日期
-- -----------------------------------------------------------------------------
CREATE TABLE fact_competitor_price_weekly (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_product_id    UUID NOT NULL REFERENCES dim_competitor_product(id) ON DELETE CASCADE,
  channel_id               UUID NOT NULL REFERENCES dim_competitor_channel(id) ON DELETE CASCADE,
  snapshot_date            DATE NOT NULL,                    -- 快照所属日期（周一对齐）
  retail_price             NUMERIC(12, 2) NOT NULL,          -- 当时零售价
  promo_price              NUMERIC(12, 2),                   -- 促销价（如有）
  promo_text               TEXT,                             -- "第二件半价"、"满 30 减 5"
  source                   TEXT,                             -- 'manual' / 'crawler' / 'api'
  collected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一竞品同一快照日期只有一条
CREATE UNIQUE INDEX uq_competitor_price_weekly      ON fact_competitor_price_weekly (competitor_product_id, snapshot_date);
CREATE INDEX        idx_competitor_price_channel    ON fact_competitor_price_weekly (channel_id, snapshot_date);
CREATE INDEX        idx_competitor_price_date       ON fact_competitor_price_weekly (snapshot_date);
