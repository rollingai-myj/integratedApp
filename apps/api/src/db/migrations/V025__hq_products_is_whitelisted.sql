-- =============================================================================
-- V025__hq_products_is_whitelisted.sql
-- 白名单从独立表回扁到 hq_products 列：
--   - ADD  hq_products.is_whitelisted BOOLEAN NOT NULL DEFAULT false
--           （与 is_new_product / is_private_label / is_returnable 风格一致）
--   - 从 hq_whitelist active 行回填 → DROP TABLE hq_whitelist
--   - 顺手 DROP V024 留下的 leaf 触发器函数
-- 业务含义：true = 该 SKU 可进入上架待选池；按场景拉取走 fn_category_scene(category_id)。
-- 副作用确认：放弃 effective_from/effective_to / created_by 审计 / 多类目挂载（V024 设计但实际未用）。
-- =============================================================================

BEGIN;

ALTER TABLE hq_products
  ADD COLUMN is_whitelisted BOOLEAN NOT NULL DEFAULT false;

-- 回填：active + 未过期 + product_id 存在
UPDATE hq_products p
   SET is_whitelisted = true, updated_at = now()
  FROM hq_whitelist w
 WHERE w.product_id = p.id
   AND w.is_active
   AND (w.effective_to IS NULL OR w.effective_to >= CURRENT_DATE)
   AND p.deleted_at IS NULL;

-- 拆掉 V024 全套
DROP TABLE IF EXISTS hq_whitelist;
DROP FUNCTION IF EXISTS fn_assert_whitelist_category_leaf();

COMMENT ON COLUMN hq_products.is_whitelisted IS
  '上架待选池白名单标记（V025）：true = 该 SKU 在该场景内可进入待选；按 fn_category_scene(category_id) 分场景拉取';

COMMIT;
