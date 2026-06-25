# @myj/api · 后端

美宜佳门店助手的后端 API,服务**移动端**(店长)+ **PC 超管控制台**(总部),走同一组 `/api/v1/*` 路由。

| 项 | 选择 |
|---|---|
| 框架 | Express 4 + TypeScript ESM |
| 数据库 | PostgreSQL 16 |
| 鉴权 | HttpOnly cookie + DB session (`user_sessions`) |
| 校验 | Zod |
| 日志 | Pino |
| 迁移 | 手写 SQL (`V001` → 当前 `V038`) |
| 测试 | Vitest(集成测试用 supertest,跟真实 Postgres 跑) |

## 启动

平时跟全栈一起用 docker compose 一把启:

```bash
# 仓库根
docker compose --profile dev up -d        # 起 postgres + api + api-worker + web + admin-web + nginx
docker exec myj-api npx tsx src/db/migrate.ts up   # 首次启动 + 每次 add migration
```

只跑 api(脱离 docker)做调试用:

```bash
cp .env.example .env                       # 仓库根 env(包含 DATABASE_URL 等)
docker compose --profile dev up -d postgres
npm run dev:api                            # tsx watch src/index.ts,端口 8787
```

健康检查:

```bash
curl http://localhost:8787/api/v1/health      # {"status":"ok","version":"0.1.0-m0"}
curl http://localhost:8787/api/v1/auth/me     # {"user":null,...} (未登录)
```

## 目录结构

```
apps/api/src/
├── index.ts                        进程入口(HTTP server + 优雅退出)
├── app.ts                          Express app 装配
├── worker/index.ts                 海报后台 worker(独立进程,docker compose 里是 api-worker 容器)
├── config/env.ts                   环境变量解析(zod 强类型)
├── db/
│   ├── index.ts                    pg 连接池 + withTransaction
│   ├── migrate.ts                  迁移 CLI
│   └── migrations/                 SQL 迁移文件 V001 → V038
├── lib/
│   ├── errors.ts                   AppError + ErrorCodes
│   └── logger.ts                   Pino 日志实例
├── middleware/
│   ├── request-id.ts               为每个请求生成 ULID
│   ├── error.ts                    全局错误处理
│   ├── auth.ts                     requireAuth / optionalAuth
│   └── role.ts                     requireRole('super_admin')
│
├── routes/                         按业务模块拆分的 Express router
│   ├── auth.routes.ts              登录 / 登出 / 飞书 OAuth / /me
│   ├── portal.routes.ts            模块清单 / 门店列表 / 切店 / 使用心跳
│   ├── hq.routes.ts                总部主数据(分类 / 商品 / 门店主数据)
│   ├── scenes.routes.ts            货盘选品 12 个场景 + 调改流程
│   ├── store.routes.ts             门店 SKU + 货架配置
│   ├── prices.routes.ts            价盘曲线 + 模拟调价
│   ├── posters.routes.ts           海报任务 / 生成 / 收藏 / 素材
│   ├── promotions.routes.ts        促销批次 xlsx 上传 + 激活查询
│   ├── competitors.routes.ts       门店竞品维护
│   ├── insights.routes.ts          门店洞察 + 问卷
│   ├── admin.routes.ts             总部超管(账号 + 审计 + 统计 + Dashboard + 调改记录 + 数据上传 + 门店档案)
│   ├── storage.routes.ts           OSS 反代 + 本地静态
│   ├── docs.routes.ts              Swagger UI + OpenAPI JSON/YAML
│   └── index.ts                    路由总注册
│
└── services/                       业务逻辑层(被多个 route 复用 + 写库)
    ├── auth.service.ts             登录 / session
    ├── portal.service.ts           getMe / 切店 / 使用心跳
    ├── hq.service.ts               分类树 / 商品查询
    ├── scene.service.ts            场景运行时 / 调改快照
    ├── store-skus.service.ts       门店 SKU 主数据
    ├── prices.service.ts           价格曲线 / 调价
    ├── posters.service.ts          海报任务编排
    ├── poster-favorites.service.ts 海报收藏
    ├── promotions.service.ts       促销批次 xlsx 解析
    ├── promo/                      促销 4 类机制 + 最优档计算
    ├── ai-shelves.service.ts       Dify 选品 / 诊断 / 虚拟陈列
    ├── competitors.service.ts      竞品维护
    ├── surveys.service.ts          门店问卷
    ├── benchmark.service.ts        基准 SKU(白名单)
    ├── audit.service.ts            sys_audit_events 写入
    ├── feishu.service.ts           飞书 OAuth + JSAPI
    ├── feishu-identity.service.ts  飞书身份 → user 映射
    ├── coco-image.service.ts       Corelays 海报生图
    ├── dify.service.ts             Dify 工作流 SSE 网关
    ├── oss.service.ts              阿里云 OSS 上传 / 反代
    ├── amap.service.ts             高德 POI 查询(店周边商圈)
    ├── admin-accounts.service.ts   超管:账号 CRUD
    ├── admin-stats.service.ts      超管:使用统计 + 实时大屏
    ├── admin-dashboard.service.ts  超管:4 张 KPI + 调改趋势 + Top 门店 + 场景占比(admin-web)
    ├── admin-changes.service.ts    超管:调改记录列表 + 详情 + CSV 导出(admin-web)
    ├── admin-uploads/              超管:CSV 批量上传 + apply/rollback(products/snapshots/stores)
    └── admin-stores.service.ts     超管:门店列表 + 单店 CRUD(admin-web /stores)
```

## 路由总览

所有路径前缀 `/api/v1/`。完整字段定义见 [docs/api-contracts.md](../../docs/api-contracts.md)(85+ 端点)。

| 模块 | 前缀 | 给谁用 |
|---|---|---|
| 认证 / 设备 | `/auth/*`, `/devices/*` | 公共(移动端 + admin) |
| 门户 | `/portal/*` | 移动端 |
| 总部主数据 | `/hq/*`, `/master/*` | 移动端 + admin |
| 货盘选品 | `/scenes/*`, `/shelves/*`, `/config/*`, `/surveys/*`, `/environment` | 移动端 |
| 价盘管理 | `/prices/*` | 移动端 |
| 门店 SKU + 货架 | `/store/*` | 移动端 |
| 海报 | `/posters/*` | 移动端 |
| 促销批次 | `/promotions/*` | 移动端读 + 超管写 |
| 竞品 + 洞察 | `/competitors/*`, `/insights/*` | 移动端 |
| 后台 | `/admin/*` | **PC admin-web** |
| 文件 | `/storage/*` | 公共 |
| AI 网关 | `/dify/*` | 移动端 |
| 健康 / 文档 | `/health`, `/docs*` | 公共 |

接口交互式文档:启动后访问 [http://localhost:8787/api/v1/docs](http://localhost:8787/api/v1/docs)(Swagger UI)。

## 数据库

V001 → V038 共 38 个迁移。当前 schema 含 **35+ 张表 / 8 个视图 / 多个 SQL 函数**。每张表的字段含义、读写位置见 [docs/database-schema.md](../../docs/database-schema.md)。

### 加新表 / 改字段

**绝对不要改已经跑过的 migration 文件**——会让本地与生产 schema 分叉。

```bash
# 1. 新建一个 migration 文件,序号递增
touch src/db/migrations/V039__描述.sql

# 2. 写 SQL(ALTER TABLE / CREATE TABLE / ALTER TYPE ...)

# 3. 应用到本地 DB
docker exec myj-api npx tsx src/db/migrate.ts up

# 4. 同步更新 docs/database-schema.md(顶部"schema 演进记录"加一段 + 影响章节追加表说明)
```

## 海报后台 worker

`src/worker/index.ts` 是单独进程,轮询 `store_poster_generations` 里 `queued` 行,认领 + 调 AI + 写回结果。docker compose 里跑在 `api-worker` 容器里,跟 api 共用镜像、源码挂载、env,只是入口换成 worker。

并发槽位通过 `POSTER_WORKER_CONCURRENCY`(默认 2)和 `POSTER_WORKER_POLL_MS`(默认 1000)控制。停机给 60s grace 让正在跑的那条 AI 完成再退。

## 环境变量

完整列表见 `.env.example`。关键项:

| 变量 | 何时需要 |
|---|---|
| `DATABASE_URL` | 必填,启动时检测 |
| `JWT_SECRET` | 必填,签 session cookie |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 移动端飞书登录 |
| `OSS_*` | 海报 / 货架照片上传 |
| `DIFY_KEY_*` | 选品 / 诊断 / 虚拟陈列 4 个 Dify workflow |
| `COCO_API_KEY` / `COCO_BASE_URL` | Corelays Gemini 海报生图 |
| `DETECT_SERVICE_URL` | 商品识别微服务(可选,缺省时红框标注不可用) |

## 调试

- 启动后看 Pino 日志(本地带颜色)
- 每个响应都有 `requestId`,复制到日志里全文搜能查到全链路
- 报错带 `code`(`UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / `BAD_REQUEST` / `CONFLICT` / `UPSTREAM_ERROR` 等)
- 写库失败:检查 `DATABASE_URL`、Postgres 是否在跑、迁移有没全部应用

```bash
# 看实时 api 日志
docker compose --profile dev logs -f api

# 进 api 容器跑测试
docker exec myj-api npm test

# 看 worker 日志
docker compose --profile dev logs -f api-worker
```
