-- =============================================================================
-- V004__dim_master_data.sql
-- 域：商品主数据（业务实体清单 组 2.1、2.2）
-- 内容：
--   - dim_category   商品分类（大类 / 中类 / 小类 三级）
--   - dim_product    商品库（全公司共享）（决策 D8：加 official_image_url 字段）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 商品分类：自引用三级树（大类 -> 中类 -> 小类）
--   level=1 大类，level=2 中类，level=3 小类
-- -----------------------------------------------------------------------------
CREATE TABLE dim_category (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES dim_category(id) ON DELETE CASCADE,
  category_code   VARCHAR(64) NOT NULL,                      -- 业务编码（如"01"、"0101"、"010101"）
  category_name   TEXT NOT NULL,                             -- "饮料" / "碳酸饮料" / "可乐"
  level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  display_order   INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_dim_category_code      ON dim_category (category_code);
CREATE INDEX        idx_dim_category_parent   ON dim_category (parent_id);
CREATE INDEX        idx_dim_category_level    ON dim_category (level);
CREATE INDEX        idx_dim_category_name_trgm ON dim_category USING gin (category_name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 决策 D8：商品库加 official_image_url 字段
--   原状：海报项目按 https://OSS/product_pic/{SKU}.png 约定，不存字段
--   合并后：每个 SKU 显式存官方图地址，海报模块按字段取
-- -----------------------------------------------------------------------------
CREATE TABLE dim_product (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code               VARCHAR(64) NOT NULL,               -- SKU 编码（业务主键）
  product_name           TEXT NOT NULL,
  brand                  TEXT,
  spec                   TEXT,                               -- 规格（如"330ml"）
  unit                   TEXT,                               -- 单位（瓶/罐/包）
  shelf_life_days        INT,                                -- 保质期天数
  length_mm              NUMERIC(10, 2),                     -- 长 mm
  width_mm               NUMERIC(10, 2),                     -- 宽 mm
  height_mm              NUMERIC(10, 2),                     -- 高 mm
  category_id            UUID REFERENCES dim_category(id) ON DELETE SET NULL,  -- 指向 level=3 小类
  category_path          TEXT,                               -- 冗余的三级分类路径（"饮料/碳酸饮料/可乐"）
  is_new_product         BOOLEAN NOT NULL DEFAULT FALSE,     -- 是否新品
  is_private_label       BOOLEAN NOT NULL DEFAULT FALSE,     -- 是否自有品牌
  wholesale_price        NUMERIC(12, 2),                     -- 批发价
  suggested_retail_price NUMERIC(12, 2),                     -- 建议零售价
  introduced_at          DATE,                               -- 引入日期
  -- 决策 D8：官方包装图（海报生成素材）
  official_image_url     TEXT,
  status                 product_status NOT NULL DEFAULT 'active',
  attributes             JSONB NOT NULL DEFAULT '{}'::jsonb, -- 其它属性（口味、产地等灵活字段）
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_dim_product_sku             ON dim_product (sku_code) WHERE deleted_at IS NULL;
CREATE INDEX        idx_dim_product_category       ON dim_product (category_id);
CREATE INDEX        idx_dim_product_brand          ON dim_product (brand);
CREATE INDEX        idx_dim_product_status         ON dim_product (status) WHERE deleted_at IS NULL;
CREATE INDEX        idx_dim_product_name_trgm      ON dim_product USING gin (product_name gin_trgm_ops);
CREATE INDEX        idx_dim_product_category_path  ON dim_product (category_path);
