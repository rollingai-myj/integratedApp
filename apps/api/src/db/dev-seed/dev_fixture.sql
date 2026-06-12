-- =============================================================================
-- dev_fixture.sql — 本地开发用测试数据(不是 migration,不进生产)
--
-- 用法: npm run -w apps/api seed:dev
-- 内容: 1 家门店 + 店长账号 + 4 棵品类树 + 22 个 SKU + 销量快照
--       + 竞品价格 + 生效中的 6 月促销,可重复执行(幂等)。
-- 账号: manager01 / rolling114514 (店长) ; testadmin / rolling114514 (超管)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- 门店与账号
INSERT INTO stores (store_code, store_name, ownership, province, city, district, address, opened_at)
SELECT '粤A1001', '美宜佳东莞南城万科里店', 'franchise', '广东省', '东莞市', '南城街道', '万科里购物中心一层 102 铺', '2023-09-18'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE store_code = '粤A1001');

INSERT INTO users (display_name, legacy_account, legacy_password_hash, status)
SELECT '李小敏', 'manager01', crypt('rolling114514', gen_salt('bf')), 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE legacy_account = 'manager01');

INSERT INTO users (display_name, legacy_account, legacy_password_hash, status)
SELECT 'Test Admin', 'testadmin', crypt('rolling114514', gen_salt('bf')), 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE legacy_account = 'testadmin');

INSERT INTO user_roles (user_id, role)
SELECT u.id, 'super_admin'::app_role FROM users u
WHERE u.legacy_account = 'testadmin'
  AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'super_admin');

INSERT INTO user_roles (user_id, role)
SELECT u.id, 'store_owner'::app_role FROM users u
WHERE u.legacy_account = 'manager01'
  AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'store_owner');

INSERT INTO user_stores (user_id, store_id, is_primary)
SELECT u.id, s.id, TRUE FROM users u, stores s
WHERE u.legacy_account = 'manager01' AND s.store_code = '粤A1001'
ON CONFLICT (user_id, store_id) DO NOTHING;

-- ---------------------------------------------------------------- 品类树(3级)
INSERT INTO dim_category (category_code, category_name, level, display_order) VALUES
  ('01', '饮料', 1, 1), ('02', '冷藏乳品', 1, 2), ('03', '休闲食品', 1, 3), ('04', '酒水', 1, 4)
ON CONFLICT (category_code) DO NOTHING;

INSERT INTO dim_category (parent_id, category_code, category_name, level, display_order)
SELECT p.id, v.code, v.name, 2, v.ord
FROM (VALUES ('01','0101','碳酸饮料',1),('01','0102','包装水',2),('01','0103','茶饮料',3),('01','0104','功能饮料',4),
             ('02','0201','低温乳品',1),('03','0301','膨化食品',1),('03','0302','饼干糕点',2),('04','0401','啤酒',1)
     ) AS v(parent, code, name, ord)
JOIN dim_category p ON p.category_code = v.parent
ON CONFLICT (category_code) DO NOTHING;

INSERT INTO dim_category (parent_id, category_code, category_name, level, display_order)
SELECT p.id, v.code, v.name, 3, v.ord
FROM (VALUES ('0101','010101','可乐',1),('0101','010102','汽水',2),
             ('0102','010201','矿泉水',1),('0103','010301','即饮茶',1),
             ('0104','010401','能量饮料',1),('0201','020101','低温酸奶',1),('0201','020102','低温牛奶',2),
             ('0301','030101','薯片',1),('0302','030201','夹心饼干',1),('0401','040101','国产啤酒',1)
     ) AS v(parent, code, name, ord)
JOIN dim_category p ON p.category_code = v.parent
ON CONFLICT (category_code) DO NOTHING;

-- ---------------------------------------------------------------- 商品库(22 SKU)
INSERT INTO dim_product (sku_code, product_name, brand, spec, unit, category_id,
                         is_new_product, is_private_label, wholesale_price, suggested_retail_price, status)
SELECT v.sku, v.name, v.brand, v.spec, v.unit, c.id, v.newp, FALSE, v.wp, v.rp, 'active'
FROM (VALUES
  ('SKU0001','可口可乐 330ml 罐装','可口可乐','330ml','罐','010101',FALSE,1.90,3.00),
  ('SKU0002','百事可乐 330ml 罐装','百事','330ml','罐','010101',FALSE,1.80,3.00),
  ('SKU0003','可口可乐 500ml 瓶装','可口可乐','500ml','瓶','010101',FALSE,2.40,3.50),
  ('SKU0004','雪碧 500ml 瓶装','可口可乐','500ml','瓶','010102',FALSE,2.40,3.50),
  ('SKU0005','元气森林白桃气泡水 480ml','元气森林','480ml','瓶','010102',TRUE,3.50,5.50),
  ('SKU0006','农夫山泉 550ml','农夫山泉','550ml','瓶','010201',FALSE,1.00,2.00),
  ('SKU0007','怡宝纯净水 555ml','怡宝','555ml','瓶','010201',FALSE,0.95,2.00),
  ('SKU0008','东方树叶乌龙茶 500ml','农夫山泉','500ml','瓶','010301',FALSE,3.20,5.00),
  ('SKU0009','康师傅冰红茶 500ml','康师傅','500ml','瓶','010301',FALSE,2.00,3.50),
  ('SKU0010','三得利乌龙茶 500ml','三得利','500ml','瓶','010301',TRUE,3.00,4.50),
  ('SKU0011','东鹏特饮 500ml','东鹏','500ml','瓶','010401',FALSE,3.00,5.00),
  ('SKU0012','红牛维生素功能饮料 250ml','红牛','250ml','罐','010401',FALSE,4.50,6.50),
  ('SKU0013','蒙牛纯甄酸牛奶 200g','蒙牛','200g','盒','020101',FALSE,3.20,4.80),
  ('SKU0014','伊利安慕希希腊酸奶 205g','伊利','205g','瓶','020101',FALSE,3.50,5.50),
  ('SKU0015','明治醇壹牛奶 450ml','明治','450ml','瓶','020102',FALSE,6.50,9.80),
  ('SKU0016','乐事薯片黄瓜味 70g','乐事','70g','包','030101',FALSE,4.20,6.50),
  ('SKU0017','乐事薯片原味 70g','乐事','70g','包','030101',FALSE,4.20,6.50),
  ('SKU0018','旺旺仙贝 52g','旺旺','52g','包','030101',FALSE,2.80,4.50),
  ('SKU0019','奥利奥原味夹心饼干 97g','亿滋','97g','包','030201',FALSE,5.20,7.90),
  ('SKU0020','青岛啤酒经典 500ml 罐','青岛啤酒','500ml','罐','040101',FALSE,4.00,6.00),
  ('SKU0021','雪花勇闯天涯 500ml 罐','华润雪花','500ml','罐','040101',FALSE,3.20,5.00),
  ('SKU0022','珠江纯生 500ml 罐','珠江啤酒','500ml','罐','040101',FALSE,3.50,5.50)
) AS v(sku, name, brand, spec, unit, cat, newp, wp, rp)
JOIN dim_category c ON c.category_code = v.cat
WHERE NOT EXISTS (SELECT 1 FROM dim_product dp WHERE dp.sku_code = v.sku);

-- ---------------------------------------------------------------- 门店销量快照
-- 设计:东鹏/农夫/可乐畅销;旺旺仙贝、百事罐装滞销(高库存低动销);新品刚铺货
INSERT INTO fact_store_sku_weekly
  (store_id, product_id, sku_code, snapshot_date, retail_price, original_price, wholesale_price,
   sales_qty_30d, sales_amount_30d, sales_qty_90d, sales_amount_90d, gross_margin_30d, stock_qty, source)
SELECT s.id, p.id, p.sku_code, DATE '2026-06-08', v.rp, NULL, p.wholesale_price,
       v.q30, v.a30, v.q90, v.a90, v.gm, v.stock, 'manual'
FROM (VALUES
  ('SKU0001',3.00,316, 948.00, 921, 2763.00,0.3667, 48),
  ('SKU0002',3.00, 95, 285.00, 287,  861.00,0.4000, 96),
  ('SKU0003',3.50,288,1008.00, 845, 2957.50,0.3143, 60),
  ('SKU0004',3.50,176, 616.00, 530, 1855.00,0.3143, 54),
  ('SKU0005',5.50, 87, 478.50, 112,  616.00,0.3636, 40),
  ('SKU0006',2.00,402, 804.00,1180, 2360.00,0.5000, 72),
  ('SKU0007',2.00,238, 476.00, 700, 1400.00,0.5250, 66),
  ('SKU0008',5.00,196, 980.00, 540, 2700.00,0.3600, 45),
  ('SKU0009',3.50,142, 497.00, 430, 1505.00,0.4286, 38),
  ('SKU0010',4.50, 64, 288.00,  80,  360.00,0.3333, 36),
  ('SKU0011',5.00,438,2190.00,1310, 6550.00,0.4000, 84),
  ('SKU0012',6.50,118, 767.00, 352, 2288.00,0.3077, 42),
  ('SKU0013',4.80,156, 748.80, 470, 2256.00,0.3333, 30),
  ('SKU0014',5.50,201,1105.50, 590, 3245.00,0.3636, 36),
  ('SKU0015',9.80, 58, 568.40, 170, 1666.00,0.3367, 18),
  ('SKU0016',6.50,134, 871.00, 410, 2665.00,0.3538, 44),
  ('SKU0017',6.50,121, 786.50, 372, 2418.00,0.3538, 40),
  ('SKU0018',4.50, 23, 103.50,  88,  396.00,0.3778,120),
  ('SKU0019',7.90, 96, 758.40, 290, 2291.00,0.3418, 35),
  ('SKU0020',6.00,182,1092.00, 510, 3060.00,0.3333, 96),
  ('SKU0021',5.00,124, 620.00, 380, 1900.00,0.3600, 72),
  ('SKU0022',5.50,156, 858.00, 445, 2447.50,0.3636, 60)
) AS v(sku, rp, q30, a30, q90, a90, gm, stock)
JOIN dim_product p ON p.sku_code = v.sku
JOIN stores s ON s.store_code = '粤A1001'
WHERE NOT EXISTS (
  SELECT 1 FROM fact_store_sku_weekly f
  WHERE f.store_id = s.id AND f.sku_code = v.sku AND f.snapshot_date = DATE '2026-06-08'
);

-- ---------------------------------------------------------------- 竞品
INSERT INTO dim_competitor_channel (channel_code, channel_name, kind)
SELECT v.code, v.name, v.kind::competitor_kind
FROM (VALUES ('lawson','罗森便利店','offline'),('mt_flash','美团闪购','online')) AS v(code,name,kind)
WHERE NOT EXISTS (SELECT 1 FROM dim_competitor_channel c WHERE c.channel_code = v.code);

INSERT INTO dim_competitor_product (channel_id, mapped_sku_code, product_name, brand, spec)
SELECT ch.id, v.sku, v.name, v.brand, v.spec
FROM (VALUES
  ('lawson','SKU0001','可口可乐 330ml 罐','可口可乐','330ml'),
  ('lawson','SKU0011','东鹏特饮 500ml','东鹏','500ml'),
  ('lawson','SKU0006','农夫山泉 550ml','农夫山泉','550ml'),
  ('mt_flash','SKU0001','可口可乐 330ml 罐','可口可乐','330ml'),
  ('mt_flash','SKU0011','东鹏特饮 500ml','东鹏','500ml'),
  ('mt_flash','SKU0014','伊利安慕希 205g','伊利','205g')
) AS v(ch, sku, name, brand, spec)
JOIN dim_competitor_channel ch ON ch.channel_code = v.ch
WHERE NOT EXISTS (
  SELECT 1 FROM dim_competitor_product cp
  WHERE cp.channel_id = ch.id AND cp.mapped_sku_code = v.sku);

INSERT INTO fact_competitor_price_weekly (competitor_product_id, channel_id, snapshot_date, retail_price, promo_price, promo_text, source)
SELECT cp.id, ch.id, DATE '2026-06-08', v.rp, v.pp, v.pt, 'manual'
FROM (VALUES
  ('lawson','SKU0001',3.50,NULL,NULL),
  ('lawson','SKU0011',5.50,5.00,'第二件8折'),
  ('lawson','SKU0006',2.50,NULL,NULL),
  ('mt_flash','SKU0001',2.80,2.50,'满39减8'),
  ('mt_flash','SKU0011',4.80,4.50,'会员价'),
  ('mt_flash','SKU0014',5.20,4.90,'3件9折')
) AS v(ch, sku, rp, pp, pt)
JOIN dim_competitor_channel ch ON ch.channel_code = v.ch
JOIN dim_competitor_product cp ON cp.channel_id = ch.id AND cp.mapped_sku_code = v.sku
WHERE NOT EXISTS (
  SELECT 1 FROM fact_competitor_price_weekly f
  WHERE f.competitor_product_id = cp.id AND f.snapshot_date = DATE '2026-06-08');

-- ---------------------------------------------------------------- 基准 SKU
INSERT INTO benchmark_sku_allowlist (sku_code, segment, category_path, reason, effective_from, is_active)
SELECT v.sku, v.seg::benchmark_segment, v.path, v.reason, DATE '2026-01-01', TRUE
FROM (VALUES
  ('SKU0001','core','饮料/碳酸饮料/可乐','全国动销 TOP 碳酸单品'),
  ('SKU0006','core','饮料/包装水/矿泉水','水类基本盘'),
  ('SKU0011','core','饮料/功能饮料/能量饮料','功能饮料头部,毛利贡献大'),
  ('SKU0005','innovation','饮料/碳酸饮料/汽水','年轻客群新品标杆')
) AS v(sku, seg, path, reason)
WHERE NOT EXISTS (SELECT 1 FROM benchmark_sku_allowlist b WHERE b.sku_code = v.sku);

-- ---------------------------------------------------------------- 生效促销(6月会员日)
INSERT INTO promotion_uploads (file_name, uploaded_by, row_total, product_count, group_count, is_active, activated_at, notes)
SELECT '2026年6月会员日促销.xlsx', u.id, 8, 8, 1, TRUE, now(), '本地开发测试数据'
FROM users u WHERE u.legacy_account = 'testadmin'
  AND NOT EXISTS (SELECT 1 FROM promotion_uploads WHERE file_name = '2026年6月会员日促销.xlsx');

INSERT INTO product_promotions
  (upload_id, row_index, sku_code, product_name, unit, category_name, original_price, product_id,
   best_label, best_required_qty, best_total_price, best_effective_unit_price, best_saving_percent,
   all_options, valid_from, valid_to)
SELECT up.id, v.row, v.sku, v.name, v.unit, v.cat, v.op, p.id,
       v.label, v.qty, v.total, v.unit_p, v.save,
       v.opts::jsonb, DATE '2026-06-01', DATE '2026-06-30'
FROM (VALUES
  (1,'SKU0003','可口可乐 500ml 瓶装','瓶','碳酸饮料',3.50,'第二件半价',2,5.25,2.63,25.00,'[{"label":"第二件半价","requiredQty":2,"totalPrice":5.25}]'),
  (2,'SKU0014','伊利安慕希希腊酸奶 205g','瓶','低温乳品',5.50,'买二送一',3,11.00,3.67,33.30,'[{"label":"买二送一","requiredQty":3,"totalPrice":11.00}]'),
  (3,'SKU0016','乐事薯片黄瓜味 70g','包','膨化食品',6.50,'会员价',1,5.50,5.50,15.40,'[{"label":"会员价","requiredQty":1,"totalPrice":5.50}]'),
  (4,'SKU0008','东方树叶乌龙茶 500ml','瓶','茶饮料',5.00,'两件9折',2,9.00,4.50,10.00,'[{"label":"两件9折","requiredQty":2,"totalPrice":9.00}]'),
  (5,'SKU0020','青岛啤酒经典 500ml 罐','罐','啤酒',6.00,'买三免一',4,18.00,4.50,25.00,'[{"label":"买三免一","requiredQty":4,"totalPrice":18.00}]'),
  (6,'SKU0019','奥利奥原味夹心饼干 97g','包','饼干糕点',7.90,'会员价',1,6.90,6.90,12.70,'[{"label":"会员价","requiredQty":1,"totalPrice":6.90}]'),
  (7,'SKU0011','东鹏特饮 500ml','瓶','功能饮料',5.00,'第二件8折',2,9.00,4.50,10.00,'[{"label":"第二件8折","requiredQty":2,"totalPrice":9.00}]'),
  (8,'SKU0005','元气森林白桃气泡水 480ml','瓶','汽水',5.50,'新品尝鲜价',1,4.90,4.90,10.90,'[{"label":"新品尝鲜价","requiredQty":1,"totalPrice":4.90}]')
) AS v(row, sku, name, unit, cat, op, label, qty, total, unit_p, save, opts)
JOIN promotion_uploads up ON up.file_name = '2026年6月会员日促销.xlsx'
LEFT JOIN dim_product p ON p.sku_code = v.sku
WHERE NOT EXISTS (
  SELECT 1 FROM product_promotions pp WHERE pp.upload_id = up.id AND pp.sku_code = v.sku);

INSERT INTO promotion_groups (upload_id, mix_group_code, display_name, category_name, sku_codes, product_count, best_label, best_total_price, best_saving_percent)
SELECT up.id, 'G01', '夏日冰爽饮料组', '饮料', ARRAY['SKU0003','SKU0008','SKU0011','SKU0005'], 4, '第二件半价', 5.25, 25.00
FROM promotion_uploads up
WHERE up.file_name = '2026年6月会员日促销.xlsx'
  AND NOT EXISTS (SELECT 1 FROM promotion_groups g WHERE g.upload_id = up.id AND g.mix_group_code = 'G01');

COMMIT;
