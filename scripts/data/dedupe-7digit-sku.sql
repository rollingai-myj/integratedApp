-- 合并 hq_products 中 7 位 sku_code → 8 位副本
-- 规则：winner 选 filled 多的那条；同分时 8 位长度优先；最后 id 升序定胜负
-- 步骤：合并字段 → repoint 9 张表的 product_id → 改写 9 张表的 sku_code 字符串 → DELETE loser
--      → 升级仍为 7 位的 winner（数据观察该步骤 0 行）

BEGIN;

CREATE TEMP TABLE _merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id, sku_code,
    CASE WHEN length(sku_code)=7 THEN '0'||sku_code ELSE sku_code END AS canonical,
    ((length_mm IS NOT NULL)::int + (width_mm IS NOT NULL)::int + (height_mm IS NOT NULL)::int +
     (shelf_life_days IS NOT NULL)::int + (wholesale_price IS NOT NULL)::int +
     (suggested_retail_price IS NOT NULL)::int + (category_id IS NOT NULL)::int +
     (series IS NOT NULL)::int + (introduced_at IS NOT NULL)::int +
     (brand IS NOT NULL)::int + (spec IS NOT NULL)::int + (unit IS NOT NULL)::int +
     (length(product_name) > 0)::int) AS filled
  FROM hq_products WHERE deleted_at IS NULL
),
dup AS (SELECT canonical FROM ranked GROUP BY canonical HAVING COUNT(*) > 1),
labeled AS (
  SELECT r.*, ROW_NUMBER() OVER (
    PARTITION BY r.canonical
    ORDER BY r.filled DESC, length(r.sku_code) DESC, r.id
  ) AS rn FROM ranked r JOIN dup USING (canonical)
)
SELECT
  l.canonical,
  (SELECT id       FROM labeled x WHERE x.canonical = l.canonical AND x.rn = 1) AS winner_id,
  (SELECT sku_code FROM labeled x WHERE x.canonical = l.canonical AND x.rn = 1) AS winner_sku,
  l.id       AS loser_id,
  l.sku_code AS loser_sku
FROM labeled l WHERE rn = 2;

SELECT 'pair count' AS info, COUNT(*) FROM _merge;

-- 1. winner 接收 loser 在 winner 上为 NULL 的字段
UPDATE hq_products w SET
  product_name           = COALESCE(NULLIF(w.product_name, ''), l.product_name),
  brand                  = COALESCE(w.brand, l.brand),
  spec                   = COALESCE(w.spec, l.spec),
  unit                   = COALESCE(w.unit, l.unit),
  series                 = COALESCE(w.series, l.series),
  shelf_life_days        = COALESCE(w.shelf_life_days, l.shelf_life_days),
  length_mm              = COALESCE(w.length_mm, l.length_mm),
  width_mm               = COALESCE(w.width_mm, l.width_mm),
  height_mm              = COALESCE(w.height_mm, l.height_mm),
  category_id            = COALESCE(w.category_id, l.category_id),
  wholesale_price        = COALESCE(w.wholesale_price, l.wholesale_price),
  suggested_retail_price = COALESCE(w.suggested_retail_price, l.suggested_retail_price),
  introduced_at          = COALESCE(w.introduced_at, l.introduced_at),
  barcode                = COALESCE(w.barcode, l.barcode),
  is_returnable          = COALESCE(w.is_returnable, l.is_returnable),
  allocation_unit        = COALESCE(w.allocation_unit, l.allocation_unit),
  attributes             = w.attributes || (l.attributes - ARRAY(SELECT jsonb_object_keys(w.attributes)))
FROM hq_products l JOIN _merge m ON l.id = m.loser_id
WHERE w.id = m.winner_id;

-- 2. 9 张表 product_id loser → winner
UPDATE hq_benchmark_skus         t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE hq_promo_batch_items      t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE hq_promo_sku_texts        t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE store_assortment_changes  t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE store_competitor_products t SET mapped_product_id = m.winner_id FROM _merge m WHERE t.mapped_product_id = m.loser_id;
UPDATE store_poster_task_products t SET product_id       = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE store_price_changes       t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE store_sku_corrections     t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;
UPDATE store_sku_snapshots       t SET product_id        = m.winner_id FROM _merge m WHERE t.product_id        = m.loser_id;

-- 3. 9 张表 sku_code 字符串 loser_sku → winner_sku（store_competitor_products 无 sku_code 字段）
UPDATE hq_benchmark_skus         t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE hq_promo_batch_items      t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE hq_promo_sku_texts        t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE store_assortment_changes  t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE store_poster_task_products t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE store_price_changes       t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE store_sku_corrections     t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;
UPDATE store_sku_snapshots       t SET sku_code = m.winner_sku FROM _merge m WHERE t.sku_code = m.loser_sku;

-- 4. DELETE loser
DELETE FROM hq_products WHERE id IN (SELECT loser_id FROM _merge);

-- 5. 把仍是 7 位的 winner 升 8 位（理论 0 行；写出来保持脚本通用）
UPDATE hq_benchmark_skus         SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE hq_promo_batch_items      SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE hq_promo_sku_texts        SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE store_assortment_changes  SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE store_poster_task_products SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE store_price_changes       SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE store_sku_corrections     SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE store_sku_snapshots       SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;
UPDATE hq_products               SET sku_code = '0' || sku_code WHERE length(sku_code) = 7;

-- 验证
SELECT 'final length distribution' AS info,
  COUNT(*) FILTER (WHERE length(sku_code) = 7) AS len7,
  COUNT(*) FILTER (WHERE length(sku_code) = 8) AS len8,
  COUNT(*) AS total
FROM hq_products WHERE deleted_at IS NULL;

SELECT 'duplicates remaining' AS info, COUNT(*) FROM (
  SELECT sku_code FROM hq_products WHERE deleted_at IS NULL GROUP BY sku_code HAVING COUNT(*) > 1
) x;

COMMIT;
