-- =============================================================================
-- V006__sales_fact.sql
-- 域：销售事实数据（业务实体清单 组 2.3、2.6）
-- 内容：
--   - fact_store_sku_weekly      门店在售 SKU 销售快照（决策 D3：每次调价插一条新快照）
--   - benchmark_sku_allowlist    基准 SKU 名单（公司必备清单）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 决策 D3：每次调价插入新销售快照，而非更新当前价
--   - 周度 ERP 同步会写一条
--   - 价盘调价时应用层会再写一条（同一 sku 同日多条，按 created_at 排序取最新）
--   - "当前价" = 同 store + sku 下最新 snapshot_date 的 retail_price
-- -----------------------------------------------------------------------------
CREATE TABLE fact_store_sku_weekly (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id               UUID NOT NULL REFERENCES stores(id)      ON DELETE CASCADE,
  product_id             UUID NOT NULL REFERENCES dim_product(id) ON DELETE RESTRICT,
  sku_code               VARCHAR(64) NOT NULL,                    -- 冗余以便不 join 即可统计
  snapshot_date          DATE NOT NULL,                           -- 快照所属日期（周一对齐 / 调价当日）
  -- 价格
  retail_price           NUMERIC(12, 2),                          -- 当时零售价
  original_price         NUMERIC(12, 2),                          -- 原价（划线价）
  wholesale_price        NUMERIC(12, 2),                          -- 当时批发价
  -- 销量与销售额
  sales_qty_30d          INT,                                     -- 近 30 天销量
  sales_amount_30d       NUMERIC(14, 2),                          -- 近 30 天销售额
  sales_qty_90d          INT,
  sales_amount_90d       NUMERIC(14, 2),
  gross_margin_30d       NUMERIC(6, 4),                           -- 近 30 天毛利率（0~1）
  -- 库存
  stock_qty              INT,                                     -- 当前库存
  last_delivery_at       DATE,                                    -- 最近一次配货日
  -- 调价溯源（决策 D3）：本条若由调价产生，关联到 ops_store_price_change
  source                 TEXT NOT NULL DEFAULT 'erp_sync',        -- 'erp_sync' / 'price_change' / 'manual'
  price_change_id        UUID,                                    -- 决策 D3：引用 ops_store_price_change.id（V007 建后再加 FK）
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同 store + sku + snapshot_date + source 唯一（允许同日因调价多条不同 source）
CREATE UNIQUE INDEX uq_fact_store_sku_weekly
  ON fact_store_sku_weekly (store_id, product_id, snapshot_date, source);
CREATE INDEX        idx_fact_store_sku_store_sku_date
  ON fact_store_sku_weekly (store_id, sku_code, snapshot_date DESC);
CREATE INDEX        idx_fact_store_sku_product
  ON fact_store_sku_weekly (product_id, snapshot_date DESC);
CREATE INDEX        idx_fact_store_sku_price_change
  ON fact_store_sku_weekly (price_change_id) WHERE price_change_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 基准 SKU 名单：公司认定的必备 SKU；AI 推荐时优先保留
-- -----------------------------------------------------------------------------
CREATE TABLE benchmark_sku_allowlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code        VARCHAR(64) NOT NULL,
  product_id      UUID REFERENCES dim_product(id) ON DELETE SET NULL,
  segment         benchmark_segment NOT NULL DEFAULT 'core',  -- core / innovation
  category_path   TEXT,                                       -- 用于按品类筛选
  reason          TEXT,                                       -- 入选原因
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,                                       -- NULL 表示长期生效
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_benchmark_sku_active
  ON benchmark_sku_allowlist (sku_code) WHERE is_active = TRUE;
CREATE INDEX        idx_benchmark_segment       ON benchmark_sku_allowlist (segment);
CREATE INDEX        idx_benchmark_category_path ON benchmark_sku_allowlist (category_path);
