-- 清理 hq_products 中缺 unit 或 width_cm 的商品 + 9 张关联子表数据
-- 触发原因：虚拟陈列图智能体输入需要 unit + 尺寸（cm），缺失会跑不通流程
-- 策略：事务内硬 DELETE；优先 9 张子表，最后 hq_products

BEGIN;

CREATE TEMP TABLE _purge ON COMMIT DROP AS
SELECT id, sku_code
FROM hq_products
WHERE deleted_at IS NULL AND (unit IS NULL OR width_cm IS NULL);

SELECT '待清商品数' AS info, COUNT(*) FROM _purge;

-- 9 张引用 product_id 的表
DELETE FROM hq_benchmark_skus         WHERE product_id        IN (SELECT id FROM _purge);
DELETE FROM hq_promo_batch_items      WHERE product_id        IN (SELECT id FROM _purge);
DELETE FROM hq_promo_sku_texts        WHERE product_id        IN (SELECT id FROM _purge);
DELETE FROM store_assortment_changes  WHERE product_id        IN (SELECT id FROM _purge);
DELETE FROM store_competitor_products WHERE mapped_product_id IN (SELECT id FROM _purge);
DELETE FROM store_poster_task_products WHERE product_id       IN (SELECT id FROM _purge);
DELETE FROM store_price_changes       WHERE product_id        IN (SELECT id FROM _purge);
DELETE FROM store_sku_corrections     WHERE product_id        IN (SELECT id FROM _purge);
DELETE FROM store_sku_snapshots       WHERE product_id        IN (SELECT id FROM _purge);

-- 主数据本表
DELETE FROM hq_products WHERE id IN (SELECT id FROM _purge);

-- 验收
SELECT '清理后总数' AS info, COUNT(*) FROM hq_products WHERE deleted_at IS NULL;
SELECT '仍缺 unit 或 width' AS info, COUNT(*) FROM hq_products
WHERE deleted_at IS NULL AND (unit IS NULL OR width_cm IS NULL);

COMMIT;
