-- =============================================================================
-- V010__views.sql
-- 业务查询视图（7 个，对应 database-to-be.md §六）
-- =============================================================================

-- 登录事件单源（sys_audit_events 投影）
CREATE OR REPLACE VIEW v_login_events AS
SELECT
  id,
  created_at,
  actor_user_id,
  actor_display_name,
  target_store_id,
  client_type,
  ip,
  user_agent,
  payload
FROM sys_audit_events
WHERE event_kind = 'user_login';

COMMENT ON VIEW v_login_events IS '登录事件投影（登录事件单源，不另建表）';

-- 门店 × SKU 价格/销量曲线（同日 manual 优先于 erp_sync）
CREATE OR REPLACE VIEW v_store_product_curve AS
WITH ranked AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s.store_id, s.product_id, s.snapshot_date
      ORDER BY CASE s.source WHEN 'manual' THEN 1 ELSE 2 END, s.created_at DESC
    ) AS rn
  FROM store_sku_snapshots s
)
SELECT
  store_id, product_id, sku_code, snapshot_date,
  retail_price, original_price, wholesale_price,
  sales_qty_30d, sales_amount_30d, gross_margin_30d, stock_qty, source
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW v_store_product_curve IS '门店 × SKU 价格/销量曲线（基于 store_sku_snapshots，同日多源取一）';

-- 每竞品最新一条价格（活跃竞对链）
CREATE OR REPLACE VIEW v_active_competitor_price AS
SELECT
  c.store_id,
  c.id   AS competitor_id,
  c.competitor_name,
  c.kind AS competitor_kind,
  cp.id  AS competitor_product_id,
  cp.product_name,
  cp.brand,
  cp.spec,
  cp.mapped_product_id,
  ps.snapshot_date,
  ps.retail_price,
  ps.promo_price,
  ps.promo_text,
  ps.photo_url,
  ps.collected_at
FROM store_competitors c
JOIN store_competitor_products cp ON cp.competitor_id = c.id AND cp.is_active
JOIN LATERAL (
  SELECT *
  FROM store_competitor_price_snapshots p
  WHERE p.competitor_product_id = cp.id
  ORDER BY p.snapshot_date DESC
  LIMIT 1
) ps ON true
WHERE c.is_active;

COMMENT ON VIEW v_active_competitor_price IS '每竞品最新价（活跃竞对店 → 活跃竞品 → 最新快照）';

-- 当前激活批次全部促销商品（拼官方图）
CREATE OR REPLACE VIEW v_promotion_active AS
SELECT
  i.*,
  p.id                 AS resolved_product_id,
  p.official_image_url,
  p.suggested_retail_price
FROM hq_promo_batch_items i
JOIN hq_promo_batches b ON b.id = i.batch_id AND b.is_active
LEFT JOIN hq_products p ON p.sku_code = i.sku_code AND p.deleted_at IS NULL;

COMMENT ON VIEW v_promotion_active IS '当前激活批次的全部促销商品（批次冻结快照 + 实时拼官方图）';

-- 当前活跃超管
CREATE OR REPLACE VIEW v_super_admins AS
SELECT u.id, u.display_name, u.email, u.legacy_account
FROM users u
JOIN user_roles r ON r.user_id = u.id AND r.system_role = 'super_admin'
WHERE u.status = 'active' AND u.deleted_at IS NULL;

-- 每店活跃竞对店数量（替代 insights 冗余列）
CREATE OR REPLACE VIEW v_store_competitor_counts AS
SELECT store_id, count(*) AS competitor_count
FROM store_competitors
WHERE is_active
GROUP BY store_id;

-- 已采用海报的商品销量对比（约束 #14：流水 × 前后两期快照）
CREATE OR REPLACE VIEW v_poster_product_sales AS
SELECT
  t.store_id,
  g.task_id,
  g.id            AS generation_id,
  tp.product_id,
  tp.sku_code,
  g.adopted_at,
  bef.snapshot_date    AS before_snapshot_date,
  bef.sales_qty_30d    AS before_sales_qty_30d,
  bef.sales_amount_30d AS before_sales_amount_30d,
  aft.snapshot_date    AS after_snapshot_date,
  aft.sales_qty_30d    AS after_sales_qty_30d,
  aft.sales_amount_30d AS after_sales_amount_30d,
  CASE
    WHEN bef.sales_qty_30d IS NULL OR aft.sales_qty_30d IS NULL OR bef.sales_qty_30d = 0 THEN NULL
    ELSE ROUND((aft.sales_qty_30d - bef.sales_qty_30d)::numeric * 100 / bef.sales_qty_30d, 1)
  END AS qty_delta_percent
FROM store_poster_generations g
JOIN store_poster_tasks t          ON t.id = g.task_id
JOIN store_poster_task_products tp ON tp.task_id = g.task_id
LEFT JOIN LATERAL (
  SELECT snapshot_date, sales_qty_30d, sales_amount_30d
  FROM store_sku_snapshots s
  WHERE s.store_id = t.store_id AND s.product_id = tp.product_id
    AND s.snapshot_date <= g.adopted_at::date
  ORDER BY s.snapshot_date DESC
  LIMIT 1
) bef ON true
LEFT JOIN LATERAL (
  SELECT snapshot_date, sales_qty_30d, sales_amount_30d
  FROM store_sku_snapshots s
  WHERE s.store_id = t.store_id AND s.product_id = tp.product_id
    AND s.snapshot_date > g.adopted_at::date
  ORDER BY s.snapshot_date DESC
  LIMIT 1
) aft ON true
WHERE g.is_adopted;

COMMENT ON VIEW v_poster_product_sales IS '已采用海报商品的采用前后销量对比（采用时点前最近一期 vs 之后最新一期快照）';
