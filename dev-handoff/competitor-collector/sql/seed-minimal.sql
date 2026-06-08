-- =============================================================================
-- 最小化样例数据
--
-- 目的：让你跑完 bootstrap.sql 之后立刻能 SELECT 出几行像样的数据，
--      并且有完整的 FK 链路可以参照（分类 → 商品 → 竞品商品 → 价格快照）。
--
-- 用法：
--   psql -h localhost -p 5436 -U postgres -d myj_competitor_dev -f sql/seed-minimal.sql
--
-- 幂等：用 ON CONFLICT 跳过已存在的行，可以反复跑。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 商品分类（三级）
-- -----------------------------------------------------------------------------
WITH ins_l1 AS (
  INSERT INTO dim_category (category_code, category_name, level, display_order)
  VALUES ('01', '饮料', 1, 1)
  ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name
  RETURNING id
),
l1 AS (
  SELECT id FROM ins_l1
  UNION ALL
  SELECT id FROM dim_category WHERE category_code = '01' AND NOT EXISTS (SELECT 1 FROM ins_l1)
),
ins_l2 AS (
  INSERT INTO dim_category (parent_id, category_code, category_name, level, display_order)
  SELECT id, '0101', '碳酸饮料', 2, 1 FROM l1
  ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name
  RETURNING id
),
l2 AS (
  SELECT id FROM ins_l2
  UNION ALL
  SELECT id FROM dim_category WHERE category_code = '0101' AND NOT EXISTS (SELECT 1 FROM ins_l2)
)
INSERT INTO dim_category (parent_id, category_code, category_name, level, display_order)
SELECT id, '010101', '可乐', 3, 1 FROM l2
ON CONFLICT (category_code) DO UPDATE SET category_name = EXCLUDED.category_name;

-- -----------------------------------------------------------------------------
-- 2. 商品库 —— 两个示例 SKU
-- -----------------------------------------------------------------------------
INSERT INTO dim_product (sku_code, product_name, brand, spec, unit, category_path, wholesale_price)
VALUES
  ('COKE-330ML', '可口可乐 330ml',   '可口可乐', '330ml', '罐', '饮料/碳酸饮料/可乐', 2.30),
  ('PEPSI-330ML', '百事可乐 330ml',   '百事',    '330ml', '罐', '饮料/碳酸饮料/可乐', 2.20)
ON CONFLICT DO NOTHING;

UPDATE dim_product p
SET category_id = c.id
FROM dim_category c
WHERE c.category_code = '010101' AND p.sku_code IN ('COKE-330ML', 'PEPSI-330ML') AND p.category_id IS NULL;

-- -----------------------------------------------------------------------------
-- 3. 竞品渠道 —— 一线上一线下
-- -----------------------------------------------------------------------------
INSERT INTO dim_competitor_channel (channel_code, channel_name, kind, price_uniform)
VALUES
  ('LAWSON_GZ',  '罗森 · 广州天河', 'offline', false),
  ('TMALL_SUPER', '天猫超市',        'online',  true)
ON CONFLICT (channel_code) DO NOTHING;

-- 给线下罗森补省市
UPDATE dim_competitor_channel
SET province = '广东', city = '广州', address = '广州市天河区某店'
WHERE channel_code = 'LAWSON_GZ' AND city IS NULL;

-- -----------------------------------------------------------------------------
-- 4. 竞品商品 —— 把竞品 SKU 映射到我们的 SKU
-- -----------------------------------------------------------------------------
INSERT INTO dim_competitor_product (channel_id, external_sku, product_name, brand, spec, mapped_sku_code, mapped_product_id)
SELECT
  ch.id,
  'LAWSON-COKE-330',
  '可口可乐 330ml',
  '可口可乐',
  '330ml',
  'COKE-330ML',
  p.id
FROM dim_competitor_channel ch
JOIN dim_product p ON p.sku_code = 'COKE-330ML'
WHERE ch.channel_code = 'LAWSON_GZ'
ON CONFLICT (channel_id, external_sku) WHERE external_sku IS NOT NULL DO NOTHING;

INSERT INTO dim_competitor_product (channel_id, external_sku, product_name, brand, spec, mapped_sku_code, mapped_product_id)
SELECT
  ch.id,
  'TMSUP-PEPSI-330',
  '百事可乐 330ml',
  '百事',
  '330ml',
  'PEPSI-330ML',
  p.id
FROM dim_competitor_channel ch
JOIN dim_product p ON p.sku_code = 'PEPSI-330ML'
WHERE ch.channel_code = 'TMALL_SUPER'
ON CONFLICT (channel_id, external_sku) WHERE external_sku IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. 价格快照 —— 给每个竞品商品塞一条最近的价格
-- -----------------------------------------------------------------------------
INSERT INTO fact_competitor_price_weekly
  (competitor_product_id, channel_id, snapshot_date, retail_price, promo_price, promo_text, source)
SELECT
  cp.id,
  cp.channel_id,
  CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int + 1,   -- 本周一
  CASE cp.mapped_sku_code WHEN 'COKE-330ML' THEN 4.50 ELSE 3.99 END,
  NULL,
  NULL,
  'manual'
FROM dim_competitor_product cp
WHERE cp.external_sku IN ('LAWSON-COKE-330', 'TMSUP-PEPSI-330')
ON CONFLICT (competitor_product_id, snapshot_date) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 验证
-- -----------------------------------------------------------------------------
SELECT 'dim_category'             AS table_name, COUNT(*) AS rows FROM dim_category
UNION ALL SELECT 'dim_product',                  COUNT(*) FROM dim_product
UNION ALL SELECT 'dim_competitor_channel',       COUNT(*) FROM dim_competitor_channel
UNION ALL SELECT 'dim_competitor_product',       COUNT(*) FROM dim_competitor_product
UNION ALL SELECT 'fact_competitor_price_weekly', COUNT(*) FROM fact_competitor_price_weekly;
