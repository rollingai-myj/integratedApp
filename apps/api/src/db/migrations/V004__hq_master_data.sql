-- =============================================================================
-- V004__hq_master_data.sql
-- G1 商品主数据：hq_categories（四层树，场景为顶层）/ hq_products / hq_benchmark_skus
-- =============================================================================

CREATE TABLE hq_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID REFERENCES hq_categories(id),
  level         SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 3),
  scene         SMALLINT UNIQUE,                 -- 全库 scene 字段的 FK 目标（约束 #1）
  category_code VARCHAR(64) NOT NULL UNIQUE,
  category_name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 0=场景 必有 scene 码且无父；1-3 级必有父、无 scene 码
  CONSTRAINT hq_categories_scene_level_chk CHECK ((level = 0) = (scene IS NOT NULL)),
  CONSTRAINT hq_categories_parent_chk      CHECK ((level = 0) = (parent_id IS NULL))
);

CREATE INDEX hq_categories_parent_idx ON hq_categories (parent_id);

COMMENT ON TABLE hq_categories IS '总部品类树，四层：0=场景 / 1=大类 / 2=中类 / 3=小类；场景是分类的最高层级';
COMMENT ON COLUMN hq_categories.scene IS '场景业务码（仅 level=0 非空）；全库各表 scene 列的 FK 目标';

CREATE TABLE hq_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code                VARCHAR(64) NOT NULL UNIQUE,
  product_name            TEXT NOT NULL,
  brand                   TEXT,
  spec                    TEXT,
  unit                    TEXT,
  series                  TEXT,
  shelf_life_days         INT,
  length_mm               NUMERIC(10,2),
  width_mm                NUMERIC(10,2),
  height_mm               NUMERIC(10,2),
  category_id             UUID REFERENCES hq_categories(id),
  is_new_product          BOOLEAN NOT NULL DEFAULT false,
  is_private_label        BOOLEAN NOT NULL DEFAULT false,
  wholesale_price         NUMERIC(12,2),
  suggested_retail_price  NUMERIC(12,2),
  introduced_at           DATE,
  official_image_url      TEXT,
  status                  product_status NOT NULL DEFAULT 'active',
  attributes              JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

CREATE INDEX hq_products_category_idx ON hq_products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX hq_products_name_trgm_idx ON hq_products USING gin (product_name gin_trgm_ops);

COMMENT ON TABLE hq_products IS '总部商品档案（全门店共用）；suggested_retail_price 是总部建议价，门店实际价见 store_sku_snapshots';

CREATE TABLE hq_benchmark_skus (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID REFERENCES hq_products(id),
  sku_code       VARCHAR(64) NOT NULL,        -- 仅 product_id 为空时作待解析键
  segment        benchmark_segment NOT NULL,
  reason         TEXT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hq_benchmark_skus_product_idx ON hq_benchmark_skus (product_id) WHERE is_active;

COMMENT ON TABLE hq_benchmark_skus IS '总部圈定的基准商品名单（核心款/创新款），选品推荐依据';
