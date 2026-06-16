-- =============================================================================
-- V024__hq_whitelist.sql
-- hq_benchmark_skus → hq_whitelist：从"基准 SKU 名单"改为"上架待选池白名单"。
--   - 业务语义：只有命中 hq_whitelist 的 SKU 才能作为上架商品的候选；
--                按 category_id（L3 小类）派生场景做分组；
--                某场景行数为 0 时由业务层退化为「全场景 benchmark_sku 列表」。
--   - schema 变更：
--       DROP segment / reason（不再区分核心/创新款，原因列也不再载入业务流）
--       ADD  category_id UUID NOT NULL（与 hq_products 一致锁 L3 叶子）
--       DROP TYPE benchmark_segment（移除孤儿枚举类型）
-- =============================================================================

BEGIN;

-- 1) ADD COLUMN（先 NULLABLE，便于按 product_id 反查 hq_products 回填）
ALTER TABLE hq_benchmark_skus
  ADD COLUMN category_id UUID REFERENCES hq_categories(id);

-- 2) 回填：白名单的 category_id 跟主数据保持一致
UPDATE hq_benchmark_skus b
   SET category_id = p.category_id
  FROM hq_products p
 WHERE p.id = b.product_id
   AND b.category_id IS NULL;

-- 3) 校验：剩余 NULL 一定是孤儿（product_id 为空或对应 product 已硬删），迁移直接拦下
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM hq_benchmark_skus WHERE category_id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'V024: 仍有 % 行 hq_benchmark_skus 的 category_id 无法回填（孤儿 product_id？）', bad;
  END IF;
END $$;

ALTER TABLE hq_benchmark_skus ALTER COLUMN category_id SET NOT NULL;

-- 4) 砍掉 segment / reason 列
ALTER TABLE hq_benchmark_skus DROP COLUMN segment;
ALTER TABLE hq_benchmark_skus DROP COLUMN reason;

-- 5) 枚举孤儿清理（segment 列没了之后 benchmark_segment 类型就没人用）
DROP TYPE IF EXISTS benchmark_segment;

-- 6) 改名：表 + 索引 + PK + FK 全部跟着对齐（Postgres 不会自动改约束名）
ALTER TABLE hq_benchmark_skus               RENAME TO hq_whitelist;
ALTER INDEX hq_benchmark_skus_product_idx   RENAME TO hq_whitelist_product_idx;
ALTER INDEX hq_benchmark_skus_pkey          RENAME TO hq_whitelist_pkey;
ALTER TABLE hq_whitelist RENAME CONSTRAINT hq_benchmark_skus_product_id_fkey  TO hq_whitelist_product_id_fkey;
ALTER TABLE hq_whitelist RENAME CONSTRAINT hq_benchmark_skus_created_by_fkey  TO hq_whitelist_created_by_fkey;
ALTER TABLE hq_whitelist RENAME CONSTRAINT hq_benchmark_skus_category_id_fkey TO hq_whitelist_category_id_fkey;

-- 按 category_id 拉白名单是最热路径（按场景 = fn_category_scene(category_id) 过滤）
CREATE INDEX hq_whitelist_category_idx ON hq_whitelist (category_id) WHERE is_active;

-- 7) L3 叶子触发器（与 V019 hq_products 同样的规则）
CREATE OR REPLACE FUNCTION fn_assert_whitelist_category_leaf()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_level SMALLINT;
BEGIN
  SELECT level INTO v_level FROM hq_categories WHERE id = NEW.category_id;
  IF v_level IS NULL THEN
    RAISE EXCEPTION 'hq_whitelist.category_id % 不存在于 hq_categories', NEW.category_id;
  END IF;
  IF v_level <> 3 THEN
    RAISE EXCEPTION 'hq_whitelist.category_id 必须指向小类(level=3)，当前 level=%', v_level;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hq_whitelist_category_leaf ON hq_whitelist;
CREATE TRIGGER trg_hq_whitelist_category_leaf
  BEFORE INSERT OR UPDATE OF category_id ON hq_whitelist
  FOR EACH ROW EXECUTE FUNCTION fn_assert_whitelist_category_leaf();

COMMENT ON TABLE  hq_whitelist IS
  '上架商品白名单：命中本表的 SKU 才能进入待选池。按 category_id (L3) → fn_category_scene 分场景；某场景行数=0 时业务层退化为 benchmark_sku 列表。';
COMMENT ON COLUMN hq_whitelist.category_id IS
  '白名单生效的小类（L3）；触发器与 hq_products 同款，强制 level=3。';
COMMENT ON FUNCTION fn_assert_whitelist_category_leaf() IS
  '业务规则：hq_whitelist.category_id 必须指向 level=3 小类（V024 落地）';

COMMIT;
