-- =============================================================================
-- V012__category_functions.sql
-- 品类树派生函数（实现辅助，不改变模型）：
--   fn_category_path(uuid)  → '大类/中类/小类' 文本路径（不含场景层，沿用旧前端语义）
--   fn_category_scene(uuid) → 该品类节点所属场景码（向上走到 level 0）
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_category_path(p_category_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, level, category_name
      FROM hq_categories WHERE id = p_category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.level, c.category_name
      FROM hq_categories c JOIN chain ON c.id = chain.parent_id
  )
  SELECT string_agg(category_name, '/' ORDER BY level)
    FROM chain WHERE level >= 1;
$$;

CREATE OR REPLACE FUNCTION fn_category_scene(p_category_id UUID)
RETURNS SMALLINT
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, level, scene
      FROM hq_categories WHERE id = p_category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.level, c.scene
      FROM hq_categories c JOIN chain ON c.id = chain.parent_id
  )
  SELECT scene FROM chain WHERE level = 0 LIMIT 1;
$$;

COMMENT ON FUNCTION fn_category_path(UUID) IS '品类文本路径（大/中/小，不含场景层）；DB 不存冗余列，查询时实时拼';
COMMENT ON FUNCTION fn_category_scene(UUID) IS '品类节点所属场景码；商品 → 场景 的唯一换算途径';
