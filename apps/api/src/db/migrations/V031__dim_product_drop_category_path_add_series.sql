-- =============================================================================
-- V031: dim_product —— 干掉冗余的 category_path，新增 series 列
--
-- 业务背景：V004 给 dim_product 加了 category_path 冗余列，本意是「品类路径」字符串
-- （"L1/L2/L3"）便于直接筛。后续发现：
--   1. 这列从来没正经回填过（258 行 240 行有 category_id，0 行有 category_path），
--      导致前端 splitCategory(null) → majorCategory="" → 场景过滤全空
--   2. 品类的真权威源是 dim_category 树（category_id + parent_id 递归），category_path
--      只是字符串冗余，存在数据漂移风险（dim_category 改名后这里失同步）
--   3. 当初真正想加的是「系列」属性（series），写错成了 category_path
--
-- 决策：dim_product 只保留 category_id 作为品类锚点；所有需要 path 字符串的查询都
-- 走 fn_category_path(category_id) 实时算。新增 series TEXT，业务上暂时不参与任何
-- 调用、值为空，仅做字段位预留。
--
-- 不影响：promo_groups.category_path / benchmark_sku_allowlist.category_path 是
-- 各自表的设计冗余字段，本迁移不动。
-- =============================================================================

-- ---- 1) 工具函数：按 category_id 递归走到 L1 拼成 "L1/L2/L3" -----------------
CREATE OR REPLACE FUNCTION fn_category_path(p_category_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, category_name, parent_id, 1 AS depth
      FROM dim_category
     WHERE id = p_category_id
    UNION ALL
    SELECT c.id, c.category_name, c.parent_id, ch.depth + 1
      FROM dim_category c
      JOIN chain ch ON c.id = ch.parent_id
  )
  SELECT string_agg(category_name, '/' ORDER BY depth DESC) FROM chain;
$$;

COMMENT ON FUNCTION fn_category_path(UUID) IS
  '递归走 dim_category.parent_id 链，返回 "L1[/L2[/L3]]"。NULL → NULL。';

-- ---- 2) 重建依赖了 dp.category_path 的视图 ---------------------------------
-- v_promotion_active 之前 SELECT dp.category_path；改用 fn_category_path 实时算。
DROP VIEW IF EXISTS v_promotion_active;
CREATE VIEW v_promotion_active AS
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
  fn_category_path(dp.category_id) AS category_path
FROM product_promotions pp
JOIN promotion_uploads  up ON up.id = pp.upload_id
LEFT JOIN dim_product   dp ON dp.id = pp.product_id
                          OR dp.sku_code = pp.sku_code
WHERE up.is_active = TRUE;

COMMENT ON VIEW v_promotion_active IS
  '当前激活批次的全部促销商品。拼上 dim_product.official_image_url（决策 D8）。category_path 实时从 dim_category 递归算。';

-- ---- 3) 删 dim_product.category_path 列 + 关联索引 ------------------------
DROP INDEX IF EXISTS idx_dim_product_category_path;
ALTER TABLE dim_product DROP COLUMN IF EXISTS category_path;

-- ---- 4) 新增 series 列 ---------------------------------------------------
ALTER TABLE dim_product
  ADD COLUMN IF NOT EXISTS series TEXT;

COMMENT ON COLUMN dim_product.series IS
  '商品所属系列（如"经典系列"、"夏日限定"）；当前不参与任何业务逻辑，仅占位。';
