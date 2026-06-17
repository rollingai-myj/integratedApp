#!/usr/bin/env bash
# =============================================================================
# Phase 1 验收脚本：种子数据核对 + 关键约束违例测试
# 对 docs/refactor-plan.md Phase 1 的"自测"项逐条落地。
# 用法：bash apps/api/scripts/db-verify.sh   （DB_NAME 可覆盖，默认 myj_dev）
# 全部通过输出 ALL CHECKS PASSED；任何一条失败立即退出非零。
# =============================================================================
set -euo pipefail

DB_NAME=${DB_NAME:-myj_dev}
PG_CONTAINER=${PG_CONTAINER:-myj-postgres}
PSQL() { docker exec "$PG_CONTAINER" psql -U myj -d "$DB_NAME" -qAt -v ON_ERROR_STOP=1 -c "$1"; }

PASS=0; FAIL=0
expect() {  # $1 描述  $2 SQL（返回单值） $3 期望值
  local got; got=$(PSQL "$2")
  if [ "$got" = "$3" ]; then echo "  ok  $1 = $got"; PASS=$((PASS+1));
  else echo "  FAIL $1: got [$got] want [$3]"; FAIL=$((FAIL+1)); fi
}
expect_reject() {  # $1 描述  $2 必须被约束拒绝的 SQL
  if docker exec "$PG_CONTAINER" psql -U myj -d "$DB_NAME" -qAt -c "$2" >/dev/null 2>&1; then
    echo "  FAIL $1：违例写入竟然成功"; FAIL=$((FAIL+1))
  else echo "  ok  $1（被拒绝）"; PASS=$((PASS+1)); fi
}

echo "== 1. 种子数据核对 =="
expect "门店数"            "SELECT count(*) FROM stores" 3
expect "账号数"            "SELECT count(*) FROM users" 2
expect "超管数"            "SELECT count(*) FROM v_super_admins" 1
expect "运营可见门店数"     "SELECT count(*) FROM user_stores WHERE user_id='22222222-2222-4222-8222-222222222222'" 2
expect "场景数(level0)"    "SELECT count(*) FROM hq_categories WHERE level=0" 13
expect "品类树总节点"       "SELECT count(*) FROM hq_categories" 82
expect "品类树孤儿(应为0)"  "SELECT count(*) FROM hq_categories c WHERE level>0 AND NOT EXISTS (SELECT 1 FROM hq_categories p WHERE p.id=c.parent_id)" 0
expect "商品数"            "SELECT count(*) FROM hq_products" 146
expect "快照期数"          "SELECT count(DISTINCT snapshot_date) FROM store_sku_snapshots" 2
expect "促销批次空"        "SELECT count(*) FROM hq_promo_batches" 0
expect "促销档案空"        "SELECT count(*) FROM hq_promo_raw_items" 0
expect "促销优惠空"        "SELECT count(*) FROM hq_promo_offers" 0
expect "货架组(3店)"       "SELECT count(*) FROM store_scene_shelves" 3
expect "竞对店(演示)"      "SELECT count(*) FROM store_competitors" 2
expect "竞品价格快照"      "SELECT count(*) FROM store_competitor_price_snapshots" 12
expect "粤37893期1快照>50"  "SELECT (count(*)>50)::text FROM store_sku_snapshots s JOIN stores st ON st.id=s.store_id WHERE st.store_code='粤37893' AND s.snapshot_date='2026-05-28'" true
expect "两期快照行数一致"   "SELECT (a.n=b.n)::text FROM (SELECT count(*) n FROM store_sku_snapshots WHERE snapshot_date='2026-05-28') a, (SELECT count(*) n FROM store_sku_snapshots WHERE snapshot_date='2026-06-11') b" true
expect "动作历史为空"       "SELECT count(*) FROM store_scene_adjustments" 0
expect "审计为空"          "SELECT count(*) FROM sys_audit_events" 0

echo "== 2. 约束违例测试（全部应被拒绝） =="
expect_reject "#2 快照来源只允许导入(erp_sync/manual)" \
 "INSERT INTO store_sku_snapshots (store_id, product_id, sku_code, snapshot_date, source) SELECT s.id, p.id, p.sku_code, '2026-06-12', 'price_change' FROM stores s, hq_products p LIMIT 1"
expect_reject "#5 勘误 kind×scope 配对(detection 不容 observe)" \
 "INSERT INTO store_sku_corrections (store_id, scene, sku_code, correction_kind, correction_scope, reason_code) SELECT id, 0, '0', 'observe', 'detection', 'x' FROM stores LIMIT 1"
expect_reject "#1 scene 必须是合法场景码" \
 "INSERT INTO store_scene_state (store_id, scene) SELECT id, 99 FROM stores LIMIT 1"
expect_reject "调改动作枚举无 replace" \
 "INSERT INTO store_assortment_changes (store_id, sku_code, action, scene) SELECT id, '0', 'replace', 0 FROM stores LIMIT 1"
expect_reject "#8 门店编号唯一" \
 "INSERT INTO stores (store_code, store_name) VALUES ('粤37893', '重复店')"
expect_reject "#11 同账号重复(legacy_account partial UQ)" \
 "INSERT INTO users (display_name, legacy_account) VALUES ('x', 'admin')"
expect_reject "场景工作台每店每场景一行" \
 "INSERT INTO store_scene_state (store_id, scene) SELECT store_id, scene FROM store_scene_shelves LIMIT 1; INSERT INTO store_scene_state (store_id, scene) SELECT store_id, scene FROM store_scene_shelves LIMIT 1"

echo "== 3. #13 海报采用唯一性（动态用例） =="
PSQL "
BEGIN;
INSERT INTO store_poster_tasks (id, batch_id, user_id, store_id, mode, template, copy_text)
SELECT 'cccccccc-0000-4000-8000-000000000001', gen_random_uuid(), '11111111-1111-4111-8111-111111111111', id, 'official_bg_only', 'vibrant', 'test' FROM stores LIMIT 1;
INSERT INTO store_poster_generations (task_id, attempt_no, status, is_adopted, adopted_at)
VALUES ('cccccccc-0000-4000-8000-000000000001', 1, 'succeeded', true, now());
COMMIT;" >/dev/null
expect_reject "#13 同任务第二条采用" \
 "INSERT INTO store_poster_generations (task_id, attempt_no, status, is_adopted, adopted_at) VALUES ('cccccccc-0000-4000-8000-000000000001', 2, 'succeeded', true, now())"
PSQL "DELETE FROM store_poster_tasks WHERE id='cccccccc-0000-4000-8000-000000000001'" >/dev/null
expect "测试残留已清理" "SELECT count(*) FROM store_poster_generations" 0

echo "== 4. 视图可用性 =="
expect "v_active_offers 可查询"    "SELECT (count(*) >= 0)::text FROM v_active_offers" true
expect "v_store_product_curve 两期" "SELECT count(DISTINCT snapshot_date) FROM v_store_product_curve" 2
expect "v_store_competitor_counts" "SELECT competitor_count FROM v_store_competitor_counts LIMIT 1" 2

echo ""
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then echo "VERIFY FAILED"; exit 1; fi
echo "ALL CHECKS PASSED"
