#!/usr/bin/env bash
# =============================================================================
# 美宜佳门店助手 · 生产部署脚本
#
# 用法:
#   bash deploy.sh                              # 日常发布(代码 + 重启容器)
#   bash deploy.sh --migrate                    # 含数据库迁移
#   bash deploy.sh --check                      # dry-run,只跑配置校验不部署
#   SSH_HOST=xxx REMOTE_DIR=/opt/myj bash deploy.sh    # 覆盖默认目标
#
# 必备前置:
#   1. 服务器已装 docker + docker compose v2
#   2. 服务器存在 ${REMOTE_DIR}/.env.production(运维手动维护)
#   3. SSH 免密登录配置好
#
# 步骤:
#   [1/5] rsync 同步代码到服务器
#   [2/5] drift 校验:.env.production.example 字段 ⊆ 服务器 .env.production
#   [3/5] docker compose 重建镜像 + 重启容器(prod overlay)
#   [4/5] (可选 --migrate) 一次性 api 容器跑 migrate.js up
#   [5/5] 健康检查:curl 宿主机 WEB_PORT
# =============================================================================
set -euo pipefail

# ---- 可覆盖的部署目标 ------------------------------------------------------
SSH_HOST="${SSH_HOST:-myj-prod}"
REMOTE_DIR="${REMOTE_DIR:-/opt/myj-integrated-app}"

# ---- 命令行参数 ------------------------------------------------------------
DO_MIGRATE=false
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --migrate) DO_MIGRATE=true ;;
    --check)   CHECK_ONLY=true ;;
    -h|--help)
      head -25 "$0" | tail -22
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg"
      echo "Usage: bash deploy.sh [--migrate] [--check]"
      exit 1
      ;;
  esac
done

echo "=== 美宜佳门店助手 生产部署 ==="
echo "  目标:  ${SSH_HOST}:${REMOTE_DIR}"
$DO_MIGRATE && echo "  模式:  含数据库迁移"
$CHECK_ONLY && echo "  模式:  dry-run(仅校验,不部署)"
echo ""

# ============================================================================
# [1/5] 同步代码到服务器
# ============================================================================
if ! $CHECK_ONLY; then
  echo "[1/5] 同步代码到服务器..."
  rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.output' \
    --exclude='.cache' \
    --exclude='.vite' \
    --exclude='.env' \
    --exclude='.env.*' \
    --include='.env.production.example' \
    --exclude='.claude' \
    --exclude='.cursor' \
    --exclude='docker-compose.override.yml' \
    --exclude='dumps' \
    --exclude='coverage' \
    --exclude='postgres_data' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    ./ "${SSH_HOST}:${REMOTE_DIR}/"
  echo "✅ 代码同步完成"
  echo ""
fi

# ============================================================================
# [2/5] 配置完整性校验:服务器 .env.production 必须含所有 .env.production.example 的字段
# ============================================================================
echo "[2/5] 校验服务器 .env.production 完整性..."
MISSING=$(ssh "$SSH_HOST" "
  cd ${REMOTE_DIR}
  if [ ! -f .env.production.example ]; then
    echo 'ERROR: 服务器缺少 .env.production.example(rsync 失败?)' >&2
    exit 2
  fi
  if [ ! -f .env.production ]; then
    echo 'ERROR: 服务器缺少 .env.production,请运维先创建' >&2
    exit 3
  fi
  # 抽取模板和实参的字段名(排除注释和空行)
  grep -E '^[A-Z_][A-Z_0-9]*=' .env.production.example | sed 's/=.*//' | sort -u > /tmp/myj_template_vars
  grep -E '^[A-Z_][A-Z_0-9]*=' .env.production           | sed 's/=.*//' | sort -u > /tmp/myj_server_vars
  # 模板有 - 服务器没 = 缺失字段
  comm -23 /tmp/myj_template_vars /tmp/myj_server_vars
")
if [ -n "$MISSING" ]; then
  echo "❌ 服务器 .env.production 缺少以下变量:"
  echo "$MISSING" | sed 's/^/    - /'
  echo ""
  echo "请运维补全 .env.production 后重新部署"
  exit 1
fi
echo "✅ 配置完整,所有模板字段都在 .env.production 中"
echo ""

if $CHECK_ONLY; then
  echo "=== dry-run 完成,未执行部署 ==="
  exit 0
fi

# ============================================================================
# [3/5] 重建镜像 + 重启容器
# ============================================================================
echo "[3/5] 重建镜像 + 重启容器..."
ssh "$SSH_HOST" "
  cd ${REMOTE_DIR}
  docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    --env-file .env.production down --remove-orphans
  docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    --env-file .env.production up -d --build
"
echo "✅ 容器已重建启动"
echo ""

# ============================================================================
# [4/5] (可选) 数据库迁移 —— 一次性容器,跑完即销
# ============================================================================
if $DO_MIGRATE; then
  echo "[4/5] 执行数据库迁移(RDS)..."
  ssh "$SSH_HOST" "
    cd ${REMOTE_DIR}
    docker compose -f docker-compose.yml -f docker-compose.prod.yml \
      --env-file .env.production run --rm --no-deps api \
      node dist/db/migrate.js up
  "
  echo "✅ 迁移完成"
  echo ""
else
  echo "[4/5] 跳过迁移(未指定 --migrate)"
  echo ""
fi

# ============================================================================
# [5/5] 健康检查
# ============================================================================
echo "[5/5] 健康检查..."
sleep 5  # 给 nginx + api + web 起容器留点时间
HEALTH=$(ssh "$SSH_HOST" "
  WEB_PORT=\$(grep '^WEB_PORT=' ${REMOTE_DIR}/.env.production | cut -d= -f2 | tr -d ' ')
  WEB_PORT=\${WEB_PORT:-8088}
  curl -sf -o /dev/null -w '%{http_code}' http://localhost:\${WEB_PORT}/api/v1/health
")
if [ "$HEALTH" != "200" ]; then
  echo "❌ 健康检查失败 (HTTP $HEALTH)"
  echo "   查看日志: ssh $SSH_HOST 'cd ${REMOTE_DIR} && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100'"
  exit 1
fi
echo "✅ 部署成功 (HTTP $HEALTH)"
