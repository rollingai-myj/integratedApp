-- =============================================================================
-- 竞品采集模块本地开发 · 一键初始化
--
-- 用途：在你本地 myj_competitor_dev 数据库里，一次性建好
--   1. 基础扩展（pgcrypto、pg_trgm、unaccent）
--   2. 与竞品采集相关的枚举类型
--   3. 商品主数据表（dim_category、dim_product）
--   4. 竞品三表（dim_competitor_channel、dim_competitor_product、fact_competitor_price_weekly）
--
-- 使用：
--   docker compose up -d
--   psql -h localhost -p 5436 -U postgres -d myj_competitor_dev -f sql/bootstrap.sql
--
-- 这份文件 = migrations/V001 + V002 + V004 + V005 拼接后的纯 SQL，可重复跑（用 IF NOT EXISTS）。
-- 已删掉枚举里跟竞品无关的项，方便阅读。但如果你以后想引入选品 / 价盘 / 海报相关字段，
-- 直接从主仓库 apps/api/src/db/migrations/ 把对应 migration 拉过来即可。
--
-- ⚠️ 主仓库版本是 single source of truth。本文件是 mirror。
--    如果主仓库的 schema 改了，把对应 V*.sql 重新覆盖到 migrations/ 里再重生成本文件。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 扩展
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- -----------------------------------------------------------------------------
-- 2. 枚举类型（竞品相关 + 商品主数据所需）
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_status') THEN
    CREATE TYPE product_status AS ENUM ('active', 'delisted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'competitor_kind') THEN
    CREATE TYPE competitor_kind AS ENUM ('online', 'offline');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. 商品分类（自引用三级树）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_category (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES dim_category(id) ON DELETE CASCADE,
  category_code   VARCHAR(64) NOT NULL,
  category_name   TEXT NOT NULL,
  level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  display_order   INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dim_category_code      ON dim_category (category_code);
CREATE INDEX        IF NOT EXISTS idx_dim_category_parent   ON dim_category (parent_id);
CREATE INDEX        IF NOT EXISTS idx_dim_category_level    ON dim_category (level);
CREATE INDEX        IF NOT EXISTS idx_dim_category_name_trgm ON dim_category USING gin (category_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. 商品库（dim_product）
--   竞品需要 mapped_product_id 指向这张表
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_product (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code               VARCHAR(64) NOT NULL,
  product_name           TEXT NOT NULL,
  brand                  TEXT,
  spec                   TEXT,
  unit                   TEXT,
  shelf_life_days        INT,
  length_mm              NUMERIC(10, 2),
  width_mm               NUMERIC(10, 2),
  height_mm              NUMERIC(10, 2),
  category_id            UUID REFERENCES dim_category(id) ON DELETE SET NULL,
  category_path          TEXT,
  is_new_product         BOOLEAN NOT NULL DEFAULT FALSE,
  is_private_label       BOOLEAN NOT NULL DEFAULT FALSE,
  wholesale_price        NUMERIC(12, 2),
  suggested_retail_price NUMERIC(12, 2),
  introduced_at          DATE,
  official_image_url     TEXT,
  status                 product_status NOT NULL DEFAULT 'active',
  attributes             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dim_product_sku             ON dim_product (sku_code) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_dim_product_category       ON dim_product (category_id);
CREATE INDEX        IF NOT EXISTS idx_dim_product_brand          ON dim_product (brand);
CREATE INDEX        IF NOT EXISTS idx_dim_product_status         ON dim_product (status) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_dim_product_name_trgm      ON dim_product USING gin (product_name gin_trgm_ops);
CREATE INDEX        IF NOT EXISTS idx_dim_product_category_path  ON dim_product (category_path);

-- -----------------------------------------------------------------------------
-- 5. 竞品渠道
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_competitor_channel (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_code    VARCHAR(64) NOT NULL,
  channel_name    TEXT NOT NULL,
  kind            competitor_kind NOT NULL,
  province        TEXT,
  city            TEXT,
  address         TEXT,
  price_uniform   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_channel_code   ON dim_competitor_channel (channel_code);
CREATE INDEX        IF NOT EXISTS idx_competitor_channel_kind  ON dim_competitor_channel (kind);
CREATE INDEX        IF NOT EXISTS idx_competitor_channel_city  ON dim_competitor_channel (city);

-- -----------------------------------------------------------------------------
-- 6. 竞品商品
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_competitor_product (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id               UUID NOT NULL REFERENCES dim_competitor_channel(id) ON DELETE CASCADE,
  external_sku             VARCHAR(128),
  product_name             TEXT NOT NULL,
  brand                    TEXT,
  spec                     TEXT,
  mapped_sku_code          VARCHAR(64),
  mapped_product_id        UUID REFERENCES dim_product(id) ON DELETE SET NULL,
  product_url              TEXT,
  image_url                TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX        IF NOT EXISTS idx_competitor_product_channel    ON dim_competitor_product (channel_id);
CREATE INDEX        IF NOT EXISTS idx_competitor_product_mapped_sku ON dim_competitor_product (mapped_sku_code) WHERE mapped_sku_code IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_competitor_product_mapped_id  ON dim_competitor_product (mapped_product_id) WHERE mapped_product_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_competitor_product_name_trgm  ON dim_competitor_product USING gin (product_name gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_product_ext         ON dim_competitor_product (channel_id, external_sku) WHERE external_sku IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. 竞品价格周快照
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_competitor_price_weekly (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_product_id    UUID NOT NULL REFERENCES dim_competitor_product(id) ON DELETE CASCADE,
  channel_id               UUID NOT NULL REFERENCES dim_competitor_channel(id) ON DELETE CASCADE,
  snapshot_date            DATE NOT NULL,
  retail_price             NUMERIC(12, 2) NOT NULL,
  promo_price              NUMERIC(12, 2),
  promo_text               TEXT,
  source                   TEXT,
  collected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_price_weekly      ON fact_competitor_price_weekly (competitor_product_id, snapshot_date);
CREATE INDEX        IF NOT EXISTS idx_competitor_price_channel    ON fact_competitor_price_weekly (channel_id, snapshot_date);
CREATE INDEX        IF NOT EXISTS idx_competitor_price_date       ON fact_competitor_price_weekly (snapshot_date);

-- -----------------------------------------------------------------------------
-- DONE
-- -----------------------------------------------------------------------------
SELECT 'bootstrap.sql 完成 — 4 表 + 2 枚举 + 3 扩展已就位' AS status;
