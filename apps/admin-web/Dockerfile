# syntax=docker/dockerfile:1.7
# =============================================================================
# @myj/admin-web — PC 端超管控制台(纯客户端 SPA)
#
# 跟 apps/web 区别:
#   - 没有 SSR,Vite 直接产出 dist/ 静态资源
#   - dev 阶段:Vite dev server on :5174
#   - 生产阶段:静态产物由 nginx 直接服务(不需要 srvx)
# =============================================================================

# ============== Build stage(dev compose 用 target=build) ==============
FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# 依赖清单 layer(整 monorepo workspace,vite/typescript 在 root devDeps)
COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/
COPY packages/shared/package.json packages/shared/

RUN npm ci

# 源码
COPY packages/shared packages/shared
COPY apps/admin-web apps/admin-web

# 生产构建(dev compose 不会到 runtime,直接在 build target 跑 vite dev)
RUN npm run -w apps/admin-web build

# ============== Runtime stage(prod overlay 用)==============
FROM nginx:1.27-alpine AS runtime

# 直接把 vite 产物 copy 到 nginx 静态目录;路由由 SPA fallback 处理
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html

# SPA fallback:把所有 404 fallback 到 /index.html(交给 TanStack Router 处理)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
