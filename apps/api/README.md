# @myj/api · 统一后端

美宜佳门店助手的统一后端 API。

- 框架：Express 4 + TypeScript（ESM）
- 数据库：PostgreSQL 16
- 鉴权：HTTP-only Cookie + Session（M1 实现）
- 校验：Zod
- 日志：Pino

## 启动

```bash
# 在仓库根目录
npm install                                  # 装所有 workspace 依赖
docker compose --profile dev up -d postgres  # 起本地 Postgres
cp .env.example .env                          # 环境变量统一在仓库根管理

# 初始化数据库（建表 + 写种子数据）
npm run migrate

# 启动开发服务器（端口 8787）
npm run dev:api
```

启动成功后访问：

- `http://localhost:8787/api/v1/health` → `{"status":"ok","version":"0.1.0-m0"}`
- `http://localhost:8787/api/v1/auth/me` → `{"user":null,...}`（未登录占位）

其它接口在 M0 阶段全部返回 `501 NOT_IMPLEMENTED`，将在 M1-M5 逐步实现。

## 目录结构

```
apps/api/src/
├── index.ts                  进程入口（启动 HTTP + 优雅退出）
├── app.ts                    Express app 装配
├── config/env.ts             环境变量解析（zod 强类型）
├── db/
│   ├── index.ts              pg 连接池
│   ├── migrate.ts            迁移 CLI（npm run migrate）
│   └── migrations/           SQL 迁移文件（V001 ~ V015）
├── lib/
│   ├── errors.ts             错误类与错误码
│   └── logger.ts             Pino 日志实例
├── middleware/
│   ├── request-id.ts         为每个请求生成 ULID
│   ├── error.ts              全局错误处理 → 统一响应
│   ├── auth.ts               requireAuth / optionalAuth
│   └── role.ts               requireRole('super_admin')
├── routes/                   11 个业务模块的路由
│   ├── auth.routes.ts        模块 1 + 设备绑定
│   ├── portal.routes.ts      模块 2
│   ├── master.routes.ts      模块 3 + 4
│   ├── shelves.routes.ts     模块 5
│   ├── prices.routes.ts      模块 6
│   ├── posters.routes.ts     模块 7
│   ├── promotions.routes.ts  模块 8
│   ├── admin.routes.ts       模块 9
│   ├── storage.routes.ts     模块 10
│   ├── ai.routes.ts          模块 11
│   ├── sessions.routes.ts    模块 12
│   ├── detect.routes.ts      选品 detect + 虚拟货架触发
│   └── index.ts              路由总注册
├── services/                 外部服务接入点（M1+ 实现）
│   ├── feishu.service.ts
│   ├── dify.service.ts
│   ├── coco-image.service.ts
│   └── oss.service.ts
└── types/
    ├── api.ts                通用 API 类型
    └── express.d.ts          Express Request 扩展（req.user）
```

## 接口路径总览（M0）

所有路径前缀 `/api/v1/`。

| 模块 | 前缀 | 状态 | 详见规划文档 |
|---|---|---|---|
| 健康 | `/health` | ✅ M0 真实实现 | — |
| 登录 + 设备 | `/auth/*`, `/devices/*` | ⚠️ 仅 `/auth/me` M0 真实，其它 501 | 模块 1 + 模块 2 |
| 门户 | `/portal/*` | ⏳ 501（M1 实现） | 模块 2 |
| 主数据 | `/master/*` | ⏳ 501（M2 / M3 实现） | 模块 3 + 4 |
| 货盘选品 | `/scenes/*`, `/shelves/*`, `/config/*`, `/surveys/*`, `/environment` | ⏳ 501（M2 实现） | 模块 5 |
| 价盘管理 | `/prices/*` | ⏳ 501（M3 实现） | 模块 6 |
| 活动海报 | `/posters/*` | ⏳ 501（M4 实现） | 模块 7 |
| 促销 | `/promotions/*` | ⏳ 501（M4 实现） | 模块 8 |
| 后台 | `/admin/*` | ⏳ 501（M5 实现） | 模块 9 |
| 文件 | `/storage/*` | ⏳ 501（M2 / M4 实现） | 模块 10 |
| AI 网关 | `/dify/*` | ⏳ 501（M2 / M3 实现） | 模块 11 |
| 使用会话 | `/sessions/*`, `/usage/*` | ⏳ 501（M1 实现） | 模块 12 |

完整字段定义见 [docs/planning/unified-api-spec.md](../../docs/planning/unified-api-spec.md)。

## 数据库

15 个 SQL 迁移文件构建完整 schema（35+ 张表 / 视图）。按 12 个推荐决策默认值实现，每张表上方都标注了对应的决策号。决策详情见 [docs/planning/unified-database-spec.md](../../docs/planning/unified-database-spec.md) 第四部分。

### 增加新表 / 改字段

```bash
# 新建一个 migration 文件
touch src/db/migrations/V016__add_xxx.sql

# 在文件里写 SQL
# 然后执行
npm run migrate
```

**不要**直接改已跑过的 migration 文件，那样会让本地与生产 schema 分叉。

## 实现一个接口（M1+）的标准步骤

1. 找到对应路由文件（如 `src/routes/auth.routes.ts`）
2. 把 handler 里的 `next(new NotImplementedError())` 替换为真实逻辑
3. 入参用 `zod` 在 handler 顶部校验
4. 调 service 层（如 `feishuService.exchangeCode(code)`）
5. 写一份 `audit_events`（决策 D7：所有关键操作都留痕）
6. 返回 JSON

接口的字段定义以 [docs/planning/unified-api-spec.md](../../docs/planning/unified-api-spec.md) 为权威，不要凭记忆写。

## 环境变量

见 `.env.example`。关键项：

| 变量 | 何时需要 |
|---|---|
| `DATABASE_URL` | 必填，启动时检测 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | M1 飞书登录 |
| `OSS_*` | M2 / M4 文件上传 |
| `DIFY_*` | M2 / M3 AI 工作流 |
| `COCO_API_KEY` / `COCO_BASE_URL` | M4 海报生成 (Corelays gpt-image-2) |
| `DETECT_SERVICE_URL` | M2 商品检测 |

## 调试技巧

- 启动后看 Pino 日志（带颜色）
- 触发任何接口：响应里都有 `requestId`，复制后到日志里全文搜索能查到该次请求的全链路
- 写库失败：检查 `DATABASE_URL`、Postgres 是否在跑、迁移是否执行成功
