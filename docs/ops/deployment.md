# 生产部署手册

## 拓扑

```
互联网 → 边缘 Caddy (TLS + 域名路由)
       → 宿主机 127.0.0.1:${WEB_PORT}  (默认 8088)
       → docker network myj_network
           ├── nginx 容器  (反代 /api → api,/ → web)
           ├── api   容器  (Express,端口 8787,仅集群内可见)
           └── web   容器  (TanStack Start SSR + srvx,端口 3000,仅集群内可见)
         ↓
       阿里云 RDS  (Postgres,外部托管,不在 compose 内)
```

## 一次性 RDS 初始化(首次部署前)

```bash
# 在 RDS 控制台或本地 psql 用 RDS 主账号连接
psql -h <RDS_HOST> -U <RDS_ADMIN> -d postgres -f database/prod-setup.sql
```

记得**先**改 `prod-setup.sql` 里的 `CHANGE_ME_BEFORE_DEPLOY` 为强密码,并同步到服务器 `.env.production` 的 `DATABASE_URL`。

## 服务器准备

```bash
# 1. 创建部署目录
mkdir -p /opt/myj-integrated-app && cd /opt/myj-integrated-app

# 2. 创建 .env.production(基于仓库根 .env.production.example)
#    填入 RDS 连接串、飞书 / OSS / Dify / OpenRouter 真实密钥
vi .env.production

# 3. 验证 docker compose v2 可用
docker compose version
```

## 部署

在**开发者本机**:

```bash
# 默认目标 SSH_HOST=myj-prod,REMOTE_DIR=/opt/myj-integrated-app
bash deploy.sh                 # 仅代码更新 + 重启容器
bash deploy.sh --migrate       # 含数据库 schema 增量迁移
bash deploy.sh --check         # dry-run:只跑配置完整性校验,不部署

# 覆盖目标(测试环境 / 多节点)
SSH_HOST=staging.example.com REMOTE_DIR=/srv/myj bash deploy.sh
```

### deploy.sh 5 步流程

| 步骤 | 动作 | 失败处理 |
|---|---|---|
| 1 | rsync 同步代码,排除 `.git` / `node_modules` / `dist` / `.env*`(白名单 `.env.production.example`) | rsync 失败立即终止 |
| 2 | **drift 校验**:`comm -23 服务器.env.production.example 服务器.env.production` —— 模板有但实参缺的字段 | 缺字段则中止,列出清单让运维补 |
| 3 | `docker compose -f base -f prod --env-file .env.production up -d --build` | compose 异常终止 |
| 4 | (可选 `--migrate`)`docker compose ... run --rm --no-deps api node dist/db/migrate.js up` | 迁移失败立即终止,容器不变(已运行的服务不受影响) |
| 5 | `curl http://localhost:${WEB_PORT}/api/v1/health` 期望 200 | 失败提示查日志命令 |

## 运维与开发的职责边界

| 文件 | 维护方 | 备注 |
|---|---|---|
| `.env.production.example` | **开发** | 真相源:新加 env 变量必须同步更新;deploy.sh 用它做 drift 校验 |
| `.env.production` | **运维** | 仅服务器有;包含真实 RDS 连接串、API 密钥 |
| `docker-compose.yml` | **开发** | 基础服务定义 |
| `docker-compose.prod.yml` | **开发 + 运维协作** | 生产 overlay;仅含架构(端口、target、command),不含密钥 |
| `deploy.sh` | **开发** | 5 步流程;运维可调 SSH_HOST/REMOTE_DIR |
| 边缘 Caddy 配置 | **运维** | TLS、域名路由;不在本仓库 |

## 排查

**部署后 502/504**

```bash
ssh myj-prod 'cd /opt/myj-integrated-app && docker compose -f docker-compose.yml -f docker-compose.prod.yml ps'
ssh myj-prod 'cd /opt/myj-integrated-app && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 api web nginx'
```

**zod env 校验失败**

api 启动时如果环境变量缺失,日志会有 `[config] Invalid environment variables:`。检查 `.env.production` 该字段是否填了实值(不能是空字符串)。

**容器间通信失败(macOS Docker Desktop only)**

宿主代理被注入容器导致 nginx → backend 502。`docker-compose.yml` 已经 `HTTP_PROXY=""` 兜底,Linux 服务器不受此影响。

## 回滚

deploy.sh **没有**自带回滚,临时回滚靠 git + 重新部署:

```bash
git checkout <last-good-sha>
bash deploy.sh
```

如果数据库迁移过,回滚还需要手动写降级 SQL —— 所以**生产迁移要慎重**,改表前先在 staging 验证。
