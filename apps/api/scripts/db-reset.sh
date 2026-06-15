#!/usr/bin/env bash
# =============================================================================
# 一键重建数据库：清 schema → 跑迁移 → 灌开发种子 → 打印核对
#
# 用法：
#   bash apps/api/scripts/db-reset.sh              # 重建 myj_dev（默认）
#   DB_NAME=myj_scratch bash .../db-reset.sh       # 重建指定库
#   SKIP_SEED=1 bash .../db-reset.sh               # 只建 schema 不灌种子
# 依赖：docker 容器 myj-postgres（可用 PG_CONTAINER 覆盖）
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

DB_NAME=${DB_NAME:-myj_dev}
PG_CONTAINER=${PG_CONTAINER:-myj-postgres}
SEED_FILE=apps/api/src/db/seeds/dev-seed.sql

BASE_URL=$(grep '^DATABASE_URL' .env | cut -d= -f2-)
DB_URL=$(echo "$BASE_URL" | sed "s|/[^/]*$|/$DB_NAME|")

echo "[db-reset] target db = $DB_NAME (container $PG_CONTAINER)"

docker exec "$PG_CONTAINER" psql -U myj -d postgres -qAt \
  -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 \
  || docker exec "$PG_CONTAINER" psql -U myj -d postgres -q -c "CREATE DATABASE $DB_NAME;"

echo "[db-reset] dropping schema public ..."
docker exec "$PG_CONTAINER" psql -U myj -d "$DB_NAME" -q \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "[db-reset] running migrations ..."
DATABASE_URL="$DB_URL" ./node_modules/.bin/tsx apps/api/src/db/migrate.ts up

if [ "${SKIP_SEED:-0}" != "1" ]; then
  echo "[db-reset] applying dev seed ..."
  docker exec -i "$PG_CONTAINER" psql -U myj -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$SEED_FILE"
fi

echo "[db-reset] verify:"
docker exec "$PG_CONTAINER" psql -U myj -d "$DB_NAME" -At -c "
SELECT 'tables='   || (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename<>'migrations')
    || ' stores='  || (SELECT count(*) FROM stores)
    || ' users='   || (SELECT count(*) FROM users)
    || ' scenes='  || (SELECT count(*) FROM hq_categories WHERE level=0)
    || ' products='|| (SELECT count(*) FROM hq_products)
    || ' snap_dates=' || (SELECT count(DISTINCT snapshot_date) FROM store_sku_snapshots)
    || ' snaps='   || (SELECT count(*) FROM store_sku_snapshots)
    || ' active_promo=' || (SELECT count(*) FROM hq_promo_batches WHERE is_active);"
echo "[db-reset] done."
