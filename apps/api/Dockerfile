# syntax=docker/dockerfile:1.7
# =============================================================================
# @myj/api — Express 后端镜像
#
# 构建上下文:仓库根（monorepo workspace 需要根 package.json + lock 解析依赖）
# 构建命令(从仓库根):
#   docker build -f apps/api/Dockerfile -t myj-api .
#
# 不打包 .env,生产环境变量靠 docker compose --env-file 注入
# =============================================================================

# ============== Build stage ==============
FROM node:22-alpine AS build
WORKDIR /app

# 仅 copy 依赖清单 → 让 npm ci 上层 cache 命中(源码改动不会重装依赖)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# 安装全 workspace 依赖(含 devDeps,build 需要 tsc/tsx)
RUN npm ci

# Copy 源码
COPY packages/shared packages/shared
COPY apps/api apps/api

# tsc 编译:apps/api/src → apps/api/dist
RUN npm run -w apps/api build

# ============== Runtime stage ==============
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 仅装生产依赖(剔除 devDeps,显著降镜像体积)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev && npm cache clean --force

# 拷贝构建产物 + 运行时静态资源
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/openapi.yaml apps/api/openapi.yaml
# 迁移 SQL 文件不被 tsc 编译,手动拷贝到 dist/db/migrations(migrate.js 期望路径)
COPY --from=build /app/apps/api/src/db/migrations apps/api/dist/db/migrations

# 工作目录设置到 apps/api,匹配 dotenv 路径解析($APP/../../../../.env 落在 /app/.env)
# 生产容器没有 .env 文件,dotenv 静默 no-op,直接走 process.env(由 --env-file 注入)
WORKDIR /app/apps/api
EXPOSE 8787

# 健康检查:curl /api/v1/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8787/api/v1/health || exit 1

CMD ["node", "dist/index.js"]
