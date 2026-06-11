# syntax=docker/dockerfile:1.7
# =============================================================================
# @myj/web — TanStack Start SSR 前端镜像
#
# 构建上下文:仓库根
# 构建命令(从仓库根):
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://your-domain \
#     -t myj-web .
#
# VITE_* 是 build-time 烧入,跨环境部署需要为每个环境单独 build。
# 生产 SSR 由 srvx CLI 启动(@tanstack/react-start 的 transitive 依赖)。
# =============================================================================

# ============== Build stage ==============
FROM node:22-alpine AS build
WORKDIR /app

# 接收 VITE_* 构建参数 → 烧进 client bundle
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# 依赖清单 layer
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# 安装全 workspace 依赖(build 需要 vite/typescript)
RUN npm ci

# Copy 源码
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vite build → apps/web/dist/{client,server}/
# envDir 指向根,Vite 会读 /app/.env*,但容器里没有这些文件 →
# 仅 ARG 注入的 VITE_API_BASE_URL 生效
RUN npm run -w apps/web build

# ============== Runtime stage ==============
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 仅生产依赖(srvx 是 @tanstack/react-start 的 transitive 依赖,会被装上)
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev && npm cache clean --force

# 仅拷贝构建产物
COPY --from=build /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

# srvx 把 dist/server/server.js 导出的 fetch handler 跑成 Node HTTP server
# --static dist/client → 把客户端静态资源一起服务,无需额外 nginx 处理
CMD ["node", "/app/node_modules/srvx/bin/srvx.mjs", "serve", "--prod", \
     "--entry", "dist/server/server.js", \
     "--static", "dist/client", \
     "--port", "3000", \
     "--host", "0.0.0.0"]
