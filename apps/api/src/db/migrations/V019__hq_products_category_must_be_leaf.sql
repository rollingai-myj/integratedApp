-- =============================================================================
-- V019__hq_products_category_must_be_leaf.sql
-- 商品主数据规则：hq_products.category_id 必须指向 level=3 的小类节点。
-- 背景：之前从《冷藏品主数据.xlsx》回填字段时没碰 category_id，导致 73 行
--       冷藏 SKU 仍挂在 level=1 的"冷藏品"节点上，fn_category_path 只返回一段，
--       Dify 入参的"中类/小类"恒为空。此次：先把存量数据归位到 L3，再用
--       NOT NULL + 触发器锁死规则。
-- =============================================================================

BEGIN;

-- 1) 67 条 SKU 按 Excel 的"小类代码"直接落到 hq_categories 对应 L3 节点
UPDATE hq_products p
   SET category_id = c.id, updated_at = now()
  FROM (VALUES
  ('07002793', '150202'),
  ('15061641', '150202'),
  ('15062584', '150202'),
  ('15063015', '150601'),
  ('15062513', '150601'),
  ('15062515', '150601'),
  ('15063016', '150601'),
  ('15062514', '150601'),
  ('15061276', '150202'),
  ('15061275', '150202'),
  ('15011262', '150202'),
  ('15062087', '150202'),
  ('07307034', '150602'),
  ('07307041', '150602'),
  ('15062229', '150602'),
  ('15062441', '150602'),
  ('15062230', '150602'),
  ('15062561', '150101'),
  ('15062818', '150202'),
  ('15062681', '150202'),
  ('15061494', '150202'),
  ('15811085', '150202'),
  ('15810975', '150101'),
  ('15061847', '150101'),
  ('15810693', '150101'),
  ('15811189', '150101'),
  ('15061421', '150101'),
  ('15062265', '150202'),
  ('15802903', '150202'),
  ('15062180', '150202'),
  ('15801616', '150202'),
  ('15801623', '150202'),
  ('03918654', '150202'),
  ('03918661', '150202'),
  ('15061206', '150202'),
  ('15029808', '150201'),
  ('15062188', '150201'),
  ('15061188', '150101'),
  ('15062746', '150101'),
  ('15061438', '150302'),
  ('15040367', '150302'),
  ('15061819', '150302'),
  ('15020599', '150302'),
  ('80643401', '150302'),
  ('15062045', '150302'),
  ('15810372', '150601'),
  ('15061319', '150601'),
  ('15810371', '150601'),
  ('23061399', '150601'),
  ('15062101', '150601'),
  ('15040406', '150601'),
  ('15040992', '150601'),
  ('15040978', '150601'),
  ('15062282', '150601'),
  ('15062908', '150305'),
  ('15062909', '150305'),
  ('15062651', '150202'),
  ('15062253', '150201'),
  ('15061500', '150201'),
  ('15041289', '150201'),
  ('15020086', '150201'),
  ('15041203', '150202'),
  ('15062669', '150202'),
  ('15810735', '150101'),
  ('15061432', '150203'),
  ('15020611', '150302'),
  ('15061445', '150302')
  ) AS m(sku_code, code3)
  JOIN hq_categories c
    ON c.category_code = m.code3 AND c.level = 3
 WHERE p.sku_code = m.sku_code AND p.deleted_at IS NULL;

-- 2) 6 条不在 Excel 的存量 SKU：按商品名手工归类（可后续按业务复核再调整）
--    依据：
--      "爆珠"/"大果粒" → 冷藏有料酸奶 (150201)
--      "乳酸菌饮品"   → 冷藏乳饮品   (150302)
--      "调制风味奶"   → 冷藏乳饮品   (150302)  -- 白小纯 非纯牛奶，属调制乳/风味奶
UPDATE hq_products p
   SET category_id = c.id, updated_at = now()
  FROM (VALUES
  ('15029803', '150201'),  -- 伊利畅轻西柚芒果青稞爆珠风味发酵乳
  ('15029812', '150201'),  -- 蒙牛大果粒草莓桑葚风味发酵乳
  ('15061012', '150302'),  -- 伊利每益添活性乳酸菌饮品(百香果味)
  ('15061446', '150302'),  -- 伊利每益添活性乳酸菌饮品清爽型(白桃味)
  ('15062309', '150302'),  -- 君乐宝白小纯草莓牛奶（调制乳→乳饮品）
  ('15062310', '150302')   -- 君乐宝白小纯黑巧牛奶（调制乳→乳饮品）
  ) AS m(sku_code, code3)
  JOIN hq_categories c
    ON c.category_code = m.code3 AND c.level = 3
 WHERE p.sku_code = m.sku_code AND p.deleted_at IS NULL;

-- 3) 落地前校验：必须 0 行非 L3，否则下面 NOT NULL/触发器会卡住，迁移直接报错回滚
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
    FROM hq_products p
    LEFT JOIN hq_categories c ON c.id = p.category_id
   WHERE p.deleted_at IS NULL
     AND (p.category_id IS NULL OR c.level <> 3);
  IF bad > 0 THEN
    RAISE EXCEPTION 'V019: 仍有 % 行 hq_products 的 category_id 不是 L3，无法继续', bad;
  END IF;
END $$;

-- 4) 锁规则：列层面 NOT NULL + 触发器层面强制 level=3
ALTER TABLE hq_products ALTER COLUMN category_id SET NOT NULL;

CREATE OR REPLACE FUNCTION fn_assert_product_category_leaf()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_level SMALLINT;
BEGIN
  SELECT level INTO v_level FROM hq_categories WHERE id = NEW.category_id;
  IF v_level IS NULL THEN
    RAISE EXCEPTION 'hq_products.category_id % 不存在于 hq_categories', NEW.category_id;
  END IF;
  IF v_level <> 3 THEN
    RAISE EXCEPTION 'hq_products.category_id 必须指向小类(level=3)，当前 level=%', v_level;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hq_products_category_leaf ON hq_products;
CREATE TRIGGER trg_hq_products_category_leaf
  BEFORE INSERT OR UPDATE OF category_id ON hq_products
  FOR EACH ROW EXECUTE FUNCTION fn_assert_product_category_leaf();

COMMENT ON FUNCTION fn_assert_product_category_leaf() IS
  '业务规则：hq_products.category_id 必须指向 level=3 的小类节点（V019 落地）';

COMMIT;
