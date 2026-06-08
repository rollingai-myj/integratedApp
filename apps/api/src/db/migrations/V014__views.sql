-- =============================================================================
-- V014__views.sql
-- 域：业务查询视图
--
-- 目的：把复杂的多表 join / 窗口函数封装成视图，让 API 实现更简洁、查询更稳定
--
-- 内容：
--   - v_store_product_curve      门店 × SKU 的价格曲线（决策 D3）
--   - v_active_competitor_price  各竞品当前最新价（聚合最近一周）
--   - v_promotion_active         当前激活批次的全部促销商品（拼上官方图）
--   - v_super_admins             超管列表（决策 D1 跨店权限判定）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 门店 × SKU 的价格曲线
--   - 一个 (store, sku) 的 fact_store_sku_weekly 按 snapshot_date 升序
--   - 同日多条（erp_sync + price_change）合并为一条，价格优先取 price_change source
--   - 用于价盘模块 PR-A2「查询所有 SKU 的价格曲线」
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_store_product_curve AS
WITH ranked AS (
  SELECT
    fs.store_id,
    fs.product_id,
    fs.sku_code,
    fs.snapshot_date,
    fs.retail_price,
    fs.original_price,
    fs.wholesale_price,
    fs.sales_qty_30d,
    fs.sales_amount_30d,
    fs.gross_margin_30d,
    fs.source,
    fs.price_change_id,
    -- 同日多条时优先取 price_change（手动调价更权威）
    ROW_NUMBER() OVER (
      PARTITION BY fs.store_id, fs.product_id, fs.snapshot_date
      ORDER BY
        CASE fs.source
          WHEN 'price_change' THEN 1
          WHEN 'manual'       THEN 2
          ELSE 3
        END,
        fs.created_at DESC
    ) AS rn
  FROM fact_store_sku_weekly fs
)
SELECT
  store_id,
  product_id,
  sku_code,
  snapshot_date,
  retail_price,
  original_price,
  wholesale_price,
  sales_qty_30d,
  sales_amount_30d,
  gross_margin_30d,
  source,
  price_change_id
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW v_store_product_curve IS
  '门店 × SKU 价格曲线（按 snapshot_date 排序）。同日多条按 source 优先级取一。供 PR-A2 使用。';

-- -----------------------------------------------------------------------------
-- 各竞品当前最新价
--   - 每个竞品商品取最近一条 fact_competitor_price_weekly
--   - 拼上渠道信息和我们的映射 SKU
--   - 用于价盘 PR-A3 / 选品 SK-C3 / 主数据 5.6 竞品查询
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_competitor_price AS
WITH latest AS (
  SELECT
    fc.competitor_product_id,
    fc.channel_id,
    fc.snapshot_date,
    fc.retail_price,
    fc.promo_price,
    fc.promo_text,
    fc.collected_at,
    ROW_NUMBER() OVER (
      PARTITION BY fc.competitor_product_id
      ORDER BY fc.snapshot_date DESC, fc.created_at DESC
    ) AS rn
  FROM fact_competitor_price_weekly fc
)
SELECT
  l.competitor_product_id,
  cp.mapped_product_id,
  cp.mapped_sku_code,
  cp.product_name             AS competitor_product_name,
  cp.brand                    AS competitor_brand,
  cp.spec                     AS competitor_spec,
  cp.product_url              AS competitor_product_url,
  cp.image_url                AS competitor_image_url,
  l.channel_id,
  ch.channel_code,
  ch.channel_name,
  ch.kind                     AS channel_kind,
  ch.city                     AS channel_city,
  l.snapshot_date,
  l.retail_price,
  l.promo_price,
  l.promo_text,
  l.collected_at
FROM latest l
JOIN dim_competitor_product cp ON cp.id = l.competitor_product_id
JOIN dim_competitor_channel ch ON ch.id = l.channel_id
WHERE l.rn = 1
  AND cp.is_active = TRUE
  AND ch.is_active = TRUE;

COMMENT ON VIEW v_active_competitor_price IS
  '各竞品最新一条价格。仅活跃竞品和活跃渠道。';

-- -----------------------------------------------------------------------------
-- 当前激活批次的全部促销商品（拼上 dim_product 官方图）
--   - 用于海报 PO-E3「查询当前生效的全部促销」
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_promotion_active AS
SELECT
  pp.id                      AS promotion_id,
  pp.upload_id,
  pp.row_index,
  pp.sku_code,
  pp.product_name,
  pp.unit,
  pp.category_name,
  pp.original_price,
  pp.best_label,
  pp.best_required_qty,
  pp.best_total_price,
  pp.best_effective_unit_price,
  pp.best_saving_percent,
  pp.all_options,
  pp.valid_from,
  pp.valid_to,
  pp.valid_dates,
  pp.mix_group_code,
  pp.display_text,
  -- 决策 D8：从 dim_product 拿官方图
  COALESCE(pp.product_id, dp.id)  AS product_id,
  dp.official_image_url,
  dp.category_path
FROM product_promotions pp
JOIN promotion_uploads  up ON up.id = pp.upload_id
LEFT JOIN dim_product   dp ON dp.id = pp.product_id
                          OR dp.sku_code = pp.sku_code
WHERE up.is_active = TRUE;

COMMENT ON VIEW v_promotion_active IS
  '当前激活批次的全部促销商品。拼上 dim_product.official_image_url（决策 D8）。';

-- -----------------------------------------------------------------------------
-- 超管列表
--   - 决策 D1：super_admin 在 user_roles 里有 'super_admin'
--   - 应用层判定跨店权限时查这个视图
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_super_admins AS
SELECT
  u.id,
  u.display_name,
  u.email,
  u.legacy_account,
  u.status,
  u.last_login_at
FROM users u
JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'super_admin'
WHERE u.deleted_at IS NULL
  AND u.status = 'active';

COMMENT ON VIEW v_super_admins IS
  '当前活跃的超管列表（决策 D1：super_admin 拥有跨门店特权）。';
