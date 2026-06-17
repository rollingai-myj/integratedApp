BEGIN;

-- 1. 删旧（依赖顺序：view → table）
DROP VIEW  IF EXISTS v_promotion_active;
DROP VIEW  IF EXISTS hq_promo_mix_groups;
DROP TABLE IF EXISTS hq_promo_batch_items;
DROP TABLE IF EXISTS hq_promo_batches CASCADE;

-- 2. 新 ENUM
CREATE TYPE promo_activity_type AS ENUM (
  'member_price', 'weekend_beer', 'brand_coupon', 'tuesday_member', 'regular_coupon'
);
CREATE TYPE promo_mechanic AS ENUM (
  'flat_price', 'bundle_price', 'percent_discount', 'pool_threshold'
);

-- 3. 上传批次表（语义改造）
CREATE TABLE hq_promo_batches (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name              TEXT NOT NULL,
  source_file_url        TEXT,
  uploaded_by            UUID REFERENCES users(id),
  is_voided              BOOLEAN NOT NULL DEFAULT FALSE,
  activity_window_start  DATE,
  activity_window_end    DATE,
  parse_warnings         JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_total              JSONB NOT NULL DEFAULT '{}'::jsonb,
  parsed_total           JSONB NOT NULL DEFAULT '{}'::jsonb,
  parsed_at              TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hq_promo_batches_window_idx ON hq_promo_batches (activity_window_start, activity_window_end);

-- 4. 原始活动行表（档案层）
CREATE TABLE hq_promo_raw_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES hq_promo_batches(id) ON DELETE CASCADE,
  activity_type         promo_activity_type NOT NULL,
  sheet_row_no          INTEGER NOT NULL,
  sku_code              VARCHAR(32) NOT NULL,
  sku_name_original     TEXT NOT NULL,
  unit                  VARCHAR(16),
  original_price        NUMERIC(10,2) NOT NULL,
  raw_method_text       TEXT,
  qty_required          INTEGER,
  promo_total_price     NUMERIC(10,2),
  promo_group_code      VARCHAR(64),
  category_code         VARCHAR(16),
  category_name         TEXT,
  valid_from            DATE NOT NULL,
  valid_to              DATE NOT NULL,
  fill_down_anchor_row  INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hq_promo_raw_items_batch_idx ON hq_promo_raw_items (batch_id, activity_type);
CREATE INDEX hq_promo_raw_items_sku_idx ON hq_promo_raw_items (sku_code);

-- 5. 标准化优惠表（计算层）
CREATE TABLE hq_promo_offers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_item_id           UUID NOT NULL REFERENCES hq_promo_raw_items(id) ON DELETE CASCADE,
  batch_id              UUID NOT NULL REFERENCES hq_promo_batches(id) ON DELETE CASCADE,
  activity_type         promo_activity_type NOT NULL,
  sku_code              VARCHAR(32) NOT NULL,
  mechanic              promo_mechanic NOT NULL,
  mechanic_params       JSONB NOT NULL,
  pool_label            TEXT,
  original_price        NUMERIC(10,2) NOT NULL,
  valid_weekday_mask    SMALLINT NOT NULL,  -- 7 bits: Mon=0b1000000 ... Sun=0b0000001
  valid_from            DATE NOT NULL,
  valid_to              DATE NOT NULL,
  is_stackable          BOOLEAN NOT NULL,
  parse_note            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hq_promo_offers_batch_idx     ON hq_promo_offers (batch_id);
CREATE INDEX hq_promo_offers_sku_idx       ON hq_promo_offers (sku_code);
CREATE INDEX hq_promo_offers_pool_idx      ON hq_promo_offers (batch_id, activity_type, pool_label) WHERE pool_label IS NOT NULL;
CREATE INDEX hq_promo_offers_valid_idx     ON hq_promo_offers (valid_from, valid_to);

-- 6. 视图：按日期 + 星期 + 是否作废过滤
CREATE VIEW v_active_offers AS
SELECT o.*
FROM   hq_promo_offers o
JOIN   hq_promo_batches b ON b.id = o.batch_id
WHERE  b.is_voided = FALSE
  AND  current_date BETWEEN o.valid_from AND o.valid_to
  AND  (o.valid_weekday_mask & (1 << (7 - EXTRACT(ISODOW FROM current_date)::int))) <> 0;

COMMIT;
