-- =============================================================================
-- V009__promo_groups.sql
-- 域：选品 SKU 级促销文案（业务实体清单 组 4.11）
-- 内容：
--   - promo_groups        选品 SKU 级促销组（决策 D6：两套促销并存的选品侧）
-- 注：选品的"促销文案"是贴在虚拟货架商品旁的小标签（"第二件半价"），
--     与海报模块（V010）的"促销批次"是两件事，按决策 D6 保持两套并存。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 决策 D6：选品 SKU 级促销文案（与海报模块的 promotion_uploads 并存）
--   原选品结构：促销组编号 → SKU → 文案；本表把每个 SKU 一行
-- -----------------------------------------------------------------------------
CREATE TABLE promo_groups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code          VARCHAR(64) NOT NULL,                  -- 促销组编号（同组商品可一起展示）
  group_name          TEXT,                                  -- 促销组显示名
  sku_code            VARCHAR(64) NOT NULL,                  -- SKU 编码
  product_id          UUID REFERENCES dim_product(id) ON DELETE SET NULL,
  promo_text          TEXT NOT NULL,                         -- 文案内容（"第二件半价"等）
  category_id         UUID REFERENCES dim_category(id) ON DELETE SET NULL,
  category_path       TEXT,                                  -- 冗余便于按品类筛选
  -- 适用范围（与海报促销不同：选品侧通常"全国挂着"）
  scope               promotion_scope NOT NULL DEFAULT 'all_stores',
  scope_cities        TEXT[],                                -- 仅 scope='city' 时使用
  scope_store_ids     UUID[],                                -- 仅 scope='store_list' 时使用
  -- 有效期
  effective_from      DATE,
  effective_to        DATE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  display_order       INT NOT NULL DEFAULT 0,
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_promo_groups_group_sku
  ON promo_groups (group_code, sku_code) WHERE is_active = TRUE;
CREATE INDEX idx_promo_groups_sku           ON promo_groups (sku_code);
CREATE INDEX idx_promo_groups_active        ON promo_groups (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_promo_groups_category_path ON promo_groups (category_path);
CREATE INDEX idx_promo_groups_effective
  ON promo_groups (effective_from, effective_to) WHERE is_active = TRUE;
