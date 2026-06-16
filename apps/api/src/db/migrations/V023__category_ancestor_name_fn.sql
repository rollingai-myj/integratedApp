-- =============================================================================
-- V023__category_ancestor_name_fn.sql
-- 派生函数 fn_category_ancestor_name：从任意品类节点向上找指定 level 的祖先名。
--
-- 背景：之前业务代码用 split_part(fn_category_path(...), '/', N) 拆 L1/L2/L3 名，
--       不同场景同名品类时会串。补一个按 parent_id 链回溯到指定 level 的函数，
--       让 benchmark / buildSkuData / buildSkuJsonForVirtualShelf 改用 category_id
--       而不是名字串。
--
-- 入参：
--   p_category_id  任意品类节点（通常是 V019 锁住的 L3 叶子）
--   p_level        目标祖先层级：0=场景 / 1=大类 / 2=中类 / 3=小类
-- 返回：该 level 祖先的 category_name；找不到则 NULL
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_category_ancestor_name(
  p_category_id UUID,
  p_level       SMALLINT
)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, level, category_name
      FROM hq_categories WHERE id = p_category_id
    UNION ALL
    SELECT c.id, c.parent_id, c.level, c.category_name
      FROM hq_categories c JOIN chain ON c.id = chain.parent_id
  )
  SELECT category_name FROM chain WHERE level = p_level LIMIT 1;
$$;

COMMENT ON FUNCTION fn_category_ancestor_name(UUID, SMALLINT) IS
  '从任意品类节点沿 parent_id 链向上找指定 level 的祖先名（0=场景/1=大类/2=中类/3=小类）';
