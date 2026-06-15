#!/usr/bin/env bash
# =============================================================================
# 开发种子生成器（Phase 1）
#
# 从 dumps/myj_dev_20260610_175641.sql（旧 schema 全量测试数据）提取并变换出
# 新 schema 的最小种子 → apps/api/src/db/seeds/dev-seed.sql（产物入库）。
#
# 内容（refactor-plan.md §二）：
#   - 3 家门店：粤37893（主测试店）/ 粤39128 / 粤29790
#   - 2 个账号：admin（超管·全部门店）/ ops（运营·前两家店）
#   - 商品主数据全量：四级品类树（13 场景为顶层）/ 258 商品 / 基准 SKU
#   - 销售快照两期：2026-05-28（dump 原始）+ 2026-06-11（确定性扰动合成）
#   - 促销：激活批次一个（单品 + 混搭组）+ 选品促销文案
#   - 货架配置：3 家店现有行（剔除 __scene_anchor__ 合成行）
#   - 竞品演示：粤37893 下 2 家竞对店 + 真实商品映射 + 两期价格快照
#
# 用法：bash apps/api/scripts/gen-dev-seed.sh   （需要本地 docker 的 myj-postgres）
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

DUMP=dumps/myj_dev_20260610_175641.sql
OUT=apps/api/src/db/seeds/dev-seed.sql
SRC_DB=myj_seed_src
KEEP_STORES="'粤37893','粤39128','粤29790'"
SNAP1=2026-05-28
SNAP2=2026-06-11

# 场景规范编号（设计稿/前端 13 场景顺序；旧 plan_position_mapping 的 position_code 有重码 bug，弃用）
SCENE_CASE="CASE position_name
  WHEN '糖巧' THEN 0 WHEN '面包架【常温奶】' THEN 1 WHEN '面包架【烘焙】' THEN 2
  WHEN '小零食' THEN 3 WHEN '大休闲' THEN 4 WHEN '饼干膨化' THEN 5
  WHEN '方便速食' THEN 6 WHEN '粮油调味' THEN 7 WHEN '酒' THEN 8
  WHEN '玩具' THEN 9 WHEN '日化' THEN 10 WHEN '家杂' THEN 11 WHEN '冷藏' THEN 12 END"

psql_src() { docker exec -i myj-postgres psql -U myj -d "$SRC_DB" -v ON_ERROR_STOP=1 "$@"; }

echo "[gen-seed] restoring dump into $SRC_DB ..."
docker exec myj-postgres psql -U myj -d postgres -q \
  -c "DROP DATABASE IF EXISTS $SRC_DB;" -c "CREATE DATABASE $SRC_DB;"
docker exec -i myj-postgres psql -U myj -d "$SRC_DB" -q < "$DUMP"
FACT_ROWS=$(psql_src -At -c "SELECT count(*) FROM fact_store_sku_weekly")
echo "[gen-seed] dump restored, fact rows = $FACT_ROWS"

mkdir -p "$(dirname "$OUT")"

cat > "$OUT" <<'HEADER'
-- =============================================================================
-- dev-seed.sql —— 开发/测试种子（生成物，勿手改）
-- 生成器：apps/api/scripts/gen-dev-seed.sh
-- 来源：dumps/myj_dev_20260610_175641.sql（旧 schema 测试数据）
-- 账号：admin / Admin@1234（超管·全部门店）；ops / Ops@1234（运营·粤37893+粤39128）
-- =============================================================================
BEGIN;
HEADER

emit_copy() {  # $1 = "table (cols)"   $2 = SELECT 语句（在旧库执行）
  echo "" >> "$OUT"
  echo "COPY $1 FROM stdin;" >> "$OUT"
  psql_src -q -c "COPY ($2) TO STDOUT" >> "$OUT"
  echo '\.' >> "$OUT"
}

# ───────────────────────── 1. 门店（3 家，原 UUID 保留） ─────────────────────────
emit_copy "stores (id, store_code, store_name, ownership, province, city, district, address, latitude, longitude, opened_at, is_project_store, status, created_at, updated_at)" \
"SELECT id, store_code, store_name, ownership, province, city, district, address, latitude, longitude, opened_at, is_project_store, status, created_at, updated_at
 FROM stores WHERE store_code IN ($KEEP_STORES) AND deleted_at IS NULL ORDER BY store_code"

# ───────────────────────── 2. 账号（全新，固定 UUID） ─────────────────────────
cat >> "$OUT" <<'ACCOUNTS'

-- admin / Admin@1234 ；ops / Ops@1234（bcrypt 预生成，仅测试环境使用）
INSERT INTO users (id, display_name, email, legacy_account, legacy_password_hash, status) VALUES
  ('11111111-1111-4111-8111-111111111111', '超级管理员', 'admin@myj.local', 'admin', '$2a$10$0MevVCieYemi5BseA.2Q3.xH6aZQXywGb5u2C63o4pPISJT2WjtBu', 'active'),
  ('22222222-2222-4222-8222-222222222222', '运营专员',   'ops@myj.local',   'ops',   '$2a$10$BItN5zR5rXXh.UQdyAV1oOkHg2REEKMg774oX.XINnpyk2PXE2mtO', 'active');

INSERT INTO user_roles (user_id, system_role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'super_admin'),
  ('22222222-2222-4222-8222-222222222222', 'store_owner');

-- 超管绑全部 3 店（主店=粤37893）；运营仅绑 2 店
INSERT INTO user_stores (user_id, store_id, is_primary)
SELECT '11111111-1111-4111-8111-111111111111', id, (store_code = '粤37893') FROM stores;
INSERT INTO user_stores (user_id, store_id, is_primary)
SELECT '22222222-2222-4222-8222-222222222222', id, (store_code = '粤37893')
FROM stores WHERE store_code IN ('粤37893', '粤39128');
ACCOUNTS

# ───────────────────────── 3. 品类树（13 场景 + 大/中/小三级） ─────────────────────────
cat >> "$OUT" <<'SCENES'

-- level 0：13 个场景（固定 UUID：…-8000-0000000000XX，XX = 场景码十六进制）
INSERT INTO hq_categories (id, parent_id, level, scene, category_code, category_name, display_order) VALUES
  ('00000000-0000-4000-8000-000000000000', NULL, 0, 0,  'S00', '糖巧', 0),
  ('00000000-0000-4000-8000-000000000001', NULL, 0, 1,  'S01', '面包架【常温奶】', 1),
  ('00000000-0000-4000-8000-000000000002', NULL, 0, 2,  'S02', '面包架【烘焙】', 2),
  ('00000000-0000-4000-8000-000000000003', NULL, 0, 3,  'S03', '小零食', 3),
  ('00000000-0000-4000-8000-000000000004', NULL, 0, 4,  'S04', '大休闲', 4),
  ('00000000-0000-4000-8000-000000000005', NULL, 0, 5,  'S05', '饼干膨化', 5),
  ('00000000-0000-4000-8000-000000000006', NULL, 0, 6,  'S06', '方便速食', 6),
  ('00000000-0000-4000-8000-000000000007', NULL, 0, 7,  'S07', '粮油调味', 7),
  ('00000000-0000-4000-8000-000000000008', NULL, 0, 8,  'S08', '酒', 8),
  ('00000000-0000-4000-8000-000000000009', NULL, 0, 9,  'S09', '玩具', 9),
  ('00000000-0000-4000-8000-00000000000a', NULL, 0, 10, 'S10', '日化', 10),
  ('00000000-0000-4000-8000-00000000000b', NULL, 0, 11, 'S11', '家杂', 11),
  ('00000000-0000-4000-8000-00000000000c', NULL, 0, 12, 'S12', '冷藏', 12);
SCENES

# level 1：大类（来自旧 plan_position_mapping；烘焙糕点/冷藏品 复用旧 dim_category 行的 id+code 以保住子树）
emit_copy "hq_categories (id, parent_id, level, scene, category_code, category_name, display_order, is_active)" \
"SELECT COALESCE(dc.id, md5('hqcat1:' || ($SCENE_CASE)::text || ':' || m.category_name)::uuid),
        ('00000000-0000-4000-8000-0000000000' || lpad(to_hex($SCENE_CASE), 2, '0'))::uuid,
        1, NULL::smallint,
        COALESCE(dc.category_code, 'C' || lpad(($SCENE_CASE)::text, 2, '0') || lpad(m.display_order::text, 2, '0')),
        m.category_name, m.display_order, m.is_active
 FROM plan_position_mapping m
 LEFT JOIN dim_category dc ON dc.level = 1 AND dc.category_name = m.category_name
 ORDER BY $SCENE_CASE, m.display_order"

# level 2/3：旧 dim_category 原样（id/code/父链不变，商品 category_id 因此无需改写）
emit_copy "hq_categories (id, parent_id, level, scene, category_code, category_name, display_order, is_active)" \
"SELECT id, parent_id, level, NULL::smallint, category_code, category_name, display_order, is_active
 FROM dim_category WHERE level IN (2, 3) ORDER BY level, category_code"

# ───────────────────────── 4. 商品 + 基准 SKU ─────────────────────────
emit_copy "hq_products (id, sku_code, product_name, brand, spec, unit, series, shelf_life_days, length_mm, width_mm, height_mm, category_id, is_new_product, is_private_label, wholesale_price, suggested_retail_price, introduced_at, official_image_url, status, attributes, created_at, updated_at)" \
"SELECT id, sku_code, product_name, brand, spec, unit, series, shelf_life_days, length_mm, width_mm, height_mm, category_id, is_new_product, is_private_label, wholesale_price, suggested_retail_price, introduced_at, official_image_url, status, attributes, created_at, updated_at
 FROM dim_product WHERE deleted_at IS NULL ORDER BY sku_code"

emit_copy "hq_benchmark_skus (id, product_id, sku_code, segment, reason, effective_from, effective_to, is_active, created_at, updated_at)" \
"SELECT id, product_id, sku_code, segment, reason, effective_from, effective_to, is_active, created_at, updated_at
 FROM benchmark_sku_allowlist ORDER BY sku_code"

# ───────────────────────── 5. 促销（仅激活批次）+ 选品促销文案 ─────────────────────────
emit_copy "hq_promo_batches (id, file_name, source_file_url, row_total, product_count, group_count, parse_warnings, is_active, activated_at, deactivated_at, notes, attributes, created_at, updated_at)" \
"SELECT id, file_name, source_file_url, row_total, product_count, group_count, parse_warnings, is_active, activated_at, deactivated_at, notes, attributes, created_at, updated_at
 FROM promotion_uploads WHERE is_active"

emit_copy "hq_promo_batch_items (id, batch_id, row_index, sku_code, product_name, unit, category_name, original_price, product_id, best_label, best_required_qty, best_total_price, best_effective_unit_price, best_saving_percent, all_options, valid_from, valid_to, valid_dates, mix_group_code, display_text, attributes, created_at, updated_at)" \
"SELECT p.id, p.upload_id, p.row_index, p.sku_code, p.product_name, p.unit, p.category_name, p.original_price, p.product_id, p.best_label, p.best_required_qty, p.best_total_price, p.best_effective_unit_price, p.best_saving_percent, p.all_options, p.valid_from, p.valid_to, p.valid_dates, p.mix_group_code, p.display_text, p.attributes, p.created_at, p.updated_at
 FROM product_promotions p JOIN promotion_uploads u ON u.id = p.upload_id AND u.is_active ORDER BY p.row_index"

emit_copy "hq_promo_mix_groups (id, batch_id, mix_group_code, display_name, category_name, sku_codes, product_count, best_label, best_total_price, best_saving_percent, representative_image_url, attributes, created_at, updated_at)" \
"SELECT g.id, g.upload_id, g.mix_group_code, g.display_name, g.category_name, g.sku_codes, g.product_count, g.best_label, g.best_total_price, g.best_saving_percent, g.representative_image_url, g.attributes, g.created_at, g.updated_at
 FROM promotion_groups g JOIN promotion_uploads u ON u.id = g.upload_id AND u.is_active ORDER BY g.mix_group_code"

# 选品促销文案（scope 三段配对约束：按 scope 清洗数组列）
emit_copy "hq_promo_sku_texts (id, group_code, group_name, product_id, sku_code, promo_text, category_id, scope, scope_cities, scope_store_ids, effective_from, effective_to, is_active, display_order, attributes, created_at, updated_at)" \
"SELECT id, group_code, group_name, product_id, sku_code, promo_text, category_id, scope,
        CASE WHEN scope = 'city'       AND cardinality(scope_cities)    > 0 THEN scope_cities    END,
        CASE WHEN scope = 'store_list' AND cardinality(scope_store_ids) > 0 THEN scope_store_ids END,
        effective_from, effective_to, is_active, display_order, attributes, created_at, updated_at
 FROM promo_groups
 WHERE scope = 'all_stores'
    OR (scope = 'city'       AND cardinality(scope_cities)    > 0)
    OR (scope = 'store_list' AND cardinality(scope_store_ids) > 0)
 ORDER BY group_code, sku_code"

# ───────────────────────── 6. 货架配置（3 店，剔除合成锚点行） ─────────────────────────
# 旧数据两种形态：pos-* 行的 position_code 即前端 13 场景序号（可信）；
# 价盘冷藏迁移行（group_name='未分组'，categories 是 JSON 字符串）固定归 冷藏(12)。
emit_copy "store_scene_shelves (id, store_id, scene, group_index, shelf_type, width_cm, layer_count, categories, notes, created_at, updated_at)" \
"WITH rows AS (
   SELECT c.*, st.store_code, c.attributes->>'shelf_type' AS stype,
          CASE WHEN c.group_name = '未分组' THEN 12 ELSE c.position_code::int END AS new_scene
   FROM store_shelf_config c
   JOIN stores st ON st.id = c.store_id
   WHERE st.store_code IN ($KEEP_STORES) AND c.deleted_at IS NULL
     AND COALESCE(c.attributes->>'shelf_type', '') <> '__scene_anchor__'
 )
 SELECT md5('shelf:' || store_code || ':' || shelf_code)::uuid, store_id, new_scene,
        row_number() OVER (PARTITION BY store_id, new_scene ORDER BY display_order, shelf_code) - 1,
        CASE WHEN group_name = '未分组' THEN '冷柜' ELSE COALESCE(stype, '标准货架') END,
        width_cm, layer_count,
        CASE WHEN group_name = '未分组' THEN ARRAY['冷藏品'] ELSE COALESCE(supported_categories, '{}') END,
        notes, created_at, updated_at
 FROM rows ORDER BY store_code, new_scene"

# 粤37893 的烘焙货架组建于 dump（06-10）之后，dump 里没有——静态补一行（来源：重建前的活库）
cat >> "$OUT" <<'EXTRA_SHELF'

INSERT INTO store_scene_shelves (id, store_id, scene, group_index, shelf_type, width_cm, layer_count, categories)
SELECT 'bbbbbbbb-0000-4000-8000-000000000001', id, 2, 0, '标准货架', 75, 5, ARRAY['烘焙糕点']
FROM stores WHERE store_code = '粤37893';
EXTRA_SHELF

# ───────────────────────── 7. 销售快照（两期） ─────────────────────────
# 期 1：dump 原始 2026-05-28（仅 3 店，source=erp_sync）
emit_copy "store_sku_snapshots (id, store_id, product_id, sku_code, snapshot_date, retail_price, original_price, wholesale_price, sales_qty_30d, sales_amount_30d, sales_qty_90d, sales_amount_90d, gross_margin_30d, stock_qty, last_delivery_at, source, created_at)" \
"SELECT f.id, f.store_id, f.product_id, f.sku_code, f.snapshot_date, f.retail_price, f.original_price, f.wholesale_price, f.sales_qty_30d, f.sales_amount_30d, f.sales_qty_90d, f.sales_amount_90d, f.gross_margin_30d, f.stock_qty, f.last_delivery_at, 'erp_sync', f.created_at
 FROM fact_store_sku_weekly f JOIN stores st ON st.id = f.store_id
 WHERE st.store_code IN ($KEEP_STORES) AND f.snapshot_date = '$SNAP1' AND f.source = 'erp_sync'
 ORDER BY st.store_code, f.sku_code"

# 期 2：2026-06-11 合成（确定性扰动 ±30%，由 sku_code 哈希决定——让环比/效果追踪有数可看）
emit_copy "store_sku_snapshots (id, store_id, product_id, sku_code, snapshot_date, retail_price, original_price, wholesale_price, sales_qty_30d, sales_amount_30d, sales_qty_90d, sales_amount_90d, gross_margin_30d, stock_qty, last_delivery_at, source, created_at)" \
"WITH base AS (
   SELECT f.*, st.store_code,
          0.7 + ((('x' || substr(md5(f.sku_code), 1, 8))::bit(32)::bigint & 1023) / 1023.0) * 0.6 AS factor
   FROM fact_store_sku_weekly f JOIN stores st ON st.id = f.store_id
   WHERE st.store_code IN ($KEEP_STORES) AND f.snapshot_date = '$SNAP1' AND f.source = 'erp_sync'
 )
 SELECT md5('snap2:' || store_id::text || ':' || product_id::text)::uuid,
        store_id, product_id, sku_code, '$SNAP2'::date,
        retail_price, original_price, wholesale_price,
        CASE WHEN sales_qty_30d    IS NULL THEN NULL ELSE GREATEST(0, round(sales_qty_30d * factor))::int END,
        CASE WHEN sales_amount_30d IS NULL THEN NULL ELSE round(sales_amount_30d * factor, 2) END,
        sales_qty_90d, sales_amount_90d,
        gross_margin_30d, stock_qty, last_delivery_at, 'erp_sync', now()
 FROM base ORDER BY store_code, sku_code"

# ───────────────────────── 8. 竞品演示（粤37893：2 店 × 3 品 × 2 期价格） ─────────────────────────
cat >> "$OUT" <<'COMPETITORS'

-- 竞品演示数据（绑定真实商品，便于比价联调）
INSERT INTO store_competitors (id, store_id, competitor_name, kind, city, address, distance_m)
SELECT 'aaaaaaaa-0000-4000-8000-000000000001', id, '零食很忙（万江店）', 'offline', '东莞', '万江街道金鳌大道 12 号', 280 FROM stores WHERE store_code = '粤37893';
INSERT INTO store_competitors (id, store_id, competitor_name, kind, distance_m)
SELECT 'aaaaaaaa-0000-4000-8000-000000000002', id, '美团闪购·便利仓', 'online', NULL FROM stores WHERE store_code = '粤37893';

-- 竞品 = 该店 05-28 快照销售额 Top3 商品的"同款"（映射 mapped_product_id）
WITH top3 AS (
  SELECT p.id AS product_id, p.product_name, p.brand, p.spec, s.retail_price,
         row_number() OVER (ORDER BY s.sales_amount_30d DESC NULLS LAST) AS rn
  FROM store_sku_snapshots s
  JOIN hq_products p ON p.id = s.product_id
  WHERE s.store_id = (SELECT id FROM stores WHERE store_code = '粤37893')
    AND s.snapshot_date = '2026-05-28'
  LIMIT 3
)
INSERT INTO store_competitor_products (id, competitor_id, product_name, brand, spec, mapped_product_id)
SELECT md5('cprod:' || c.id::text || ':' || t.product_id::text)::uuid,
       c.id, t.product_name, t.brand, t.spec, t.product_id
FROM top3 t
CROSS JOIN (SELECT id FROM store_competitors WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002')) c;

-- 两期价格快照：竞对价 = 我方现价 × 0.95（期1）/ × 0.98（期2），留促销文案样例
INSERT INTO store_competitor_price_snapshots (id, competitor_product_id, snapshot_date, retail_price, promo_price, promo_text, source)
SELECT md5('cprice1:' || cp.id::text)::uuid, cp.id, '2026-05-28',
       round(COALESCE(s.retail_price, 10) * 0.95, 1), NULL, NULL, 'manual'
FROM store_competitor_products cp
JOIN store_sku_snapshots s ON s.product_id = cp.mapped_product_id
 AND s.store_id = (SELECT id FROM stores WHERE store_code = '粤37893') AND s.snapshot_date = '2026-05-28';
INSERT INTO store_competitor_price_snapshots (id, competitor_product_id, snapshot_date, retail_price, promo_price, promo_text, source)
SELECT md5('cprice2:' || cp.id::text)::uuid, cp.id, '2026-06-11',
       round(COALESCE(s.retail_price, 10) * 0.98, 1), round(COALESCE(s.retail_price, 10) * 0.88, 1), '第二件半价', 'photo'
FROM store_competitor_products cp
JOIN store_sku_snapshots s ON s.product_id = cp.mapped_product_id
 AND s.store_id = (SELECT id FROM stores WHERE store_code = '粤37893') AND s.snapshot_date = '2026-05-28';
COMPETITORS

echo "" >> "$OUT"
echo "COMMIT;" >> "$OUT"

LINES=$(wc -l < "$OUT")
echo "[gen-seed] done → $OUT ($LINES lines)"
