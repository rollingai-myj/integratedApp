-- =============================================================================
-- V034__poster_task_products_nullable.sql
-- 海报任务锚点放宽：未入库 hq_products 的 SKU 也能建任务出图，仅丢失销量追踪。
--
-- 起因：单 SKU 出图时若 sku_code 不在 HQ 总部主商品库（hq_products）里，
--      旧版 createTasks 直接 404「SKU XXX 不存在，无法建任务」。
--      实际业务允许门店为新品/未入库 SKU 生成促销海报，只是采用后没法关联
--      store_sku_snapshots 做前后销量对比 —— "不追踪"而不是"不让做"。
--
-- 改动：
--   1) PK 从 (task_id, product_id) 改为 (task_id, sku_code)
--      —— Postgres PRIMARY KEY 不允许含 NULL 列；sku_code 本就 NOT NULL，
--         业务语义上「同任务同 SKU」也是唯一锚点，等价。
--   2) product_id DROP NOT NULL
--      —— hq_products 里查得到则填，查不到则 NULL，前端不再因此被拦。
--
-- 下游兼容性：
--   - v_poster_product_sales 视图 LATERAL JOIN 用 s.product_id = tp.product_id，
--     tp.product_id IS NULL 时 LATERAL 子查询空匹配 → bef/aft 全 NULL → qty_delta NULL，
--     视图仍输出该 generation 行（标识"有海报、无销量追踪"），无需改视图。
--   - promotions.service.ts 的偏好排名查询 INNER JOIN hq_products on tp.product_id —
--     NULL 行自然被丢，等价于"没追踪的 SKU 不参与品类偏好统计"，语义对。
-- =============================================================================

ALTER TABLE store_poster_task_products
  DROP CONSTRAINT store_poster_task_products_pkey;

ALTER TABLE store_poster_task_products
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE store_poster_task_products
  ADD CONSTRAINT store_poster_task_products_pkey PRIMARY KEY (task_id, sku_code);

COMMENT ON COLUMN store_poster_task_products.product_id IS
  '可空：未入库 hq_products 的 SKU 锚点为 NULL，该任务无销量追踪（v_poster_product_sales 的 LATERAL JOIN 不会匹配）';

COMMENT ON TABLE store_poster_task_products IS
  '任务商品锚点：sku_code 为业务主键；product_id 命中 hq_products 时可关联 store_sku_snapshots 做销量追踪（约束 #14）';
