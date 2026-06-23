# syntax=docker/dockerfile:1.7
# =============================================================================
# 项目内 nginx 反向代理
#
# 拓扑:
#   外网/边缘 Caddy → 宿主机 :WEB_PORT → 本容器 :80
#                                          ├── /api/    → api:8787
#                                          └── /        → web:${WEB_UPSTREAM_PORT}
#
# 启动时 envsubst 把 nginx.conf 模板里的 ${WEB_UPSTREAM_PORT} 替换成实际端口:
#   dev(base compose):  5173 (vite dev)
#   prod(prod overlay): 3000 (srvx SSR)
# =============================================================================
FROM nginx:1.27-alpine

# 删默认配置
RUN rm /etc/nginx/conf.d/default.conf

# 把 nginx.conf 当作 envsubst 模板
COPY nginx/nginx.conf /etc/nginx/templates/default.conf.template

# nginx:alpine 镜像默认有 docker-entrypoint.d/20-envsubst-on-templates.sh
# 会自动把 /etc/nginx/templates/*.template envsubst 后输出到 /etc/nginx/conf.d/
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates
ENV NGINX_ENVSUBST_TEMPLATE_SUFFIX=.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
# 用 127.0.0.1 而不是 localhost —— 容器内 localhost 优先解 IPv6 [::1],
# 而 nginx 默认只 listen 80(IPv4),IPv6 sock 拒连 → healthcheck 永远 unhealthy。
