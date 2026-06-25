# 美宜佳门店助手 · integratedApp

> 美宜佳门店运营的统一前后端 + 数据库。**移动端**给一线店长用,**PC 超管控制台**给总部用,共用同一套后端 + Postgres。

---

## 这是什么

把原来三个独立项目([skuSelection](https://github.com/rollingai-myj/skuSelection)、[priceChange](https://github.com/rollingai-myj/priceChange)、[poster](https://github.com/rollingai-myj/poster))合并、重写、扩展后的统一应用。涉及四块业务:

| 业务 | 谁用 | 入口 |
|---|---|---|
| **货盘选品** | 店长 | 移动端 `/shelves` |
| **价盘管理** | 店长 | 移动端 `/prices` |
| **活动海报** | 店长 | 移动端 `/posters` |
| **总部超管** | 总部 | PC 端 `/`(数据维护 / 调改记录 / 仪表盘 / 门店信息) |

## 双入口

代码合一,部署分端口分页面:

| 端 | 受众 | 本机 | 局域网 | 路径风格 |
|---|---|---|---|---|
| 📱 移动端门店助手 | 店长(微信/飞书内打开) | http://localhost:8089 | http://192.168.0.101:8089 | iOS 风格,IOSDevice 包装 |
| 🖥️ PC 超管控制台 | 总部(浏览器) | http://localhost:8090 | http://192.168.0.101:8090 | 三栏后台,Tailwind tokens |

两端走的是**同一组 `/api/v1/*` 后端 + session cookie**,只是 nginx 按 80/81 分流到不同前端容器。

## 仓库结构(monorepo / npm workspaces)

```
integratedApp/
├── README.md                       # 你在看的这份
├── CONTRIBUTING.md                 # 协作规范(GitHub Flow,必读)
├── docker-compose.yml              # 本地 + 生产共用骨架
├── docker-compose.prod.yml         # 生产 overlay
├── docker-compose.override.yml.example   # 本地端口覆盖示例
├── deploy.sh                       # 生产部署脚本
├── nginx/                          # 反向代理(80 → 移动端,81 → admin)
│
├── apps/
│   ├── api/                        # 后端 — Express + Postgres + tsx watch
│   ├── web/                        # 移动端前端 — Vite + TanStack Start (SSR)
│   └── admin-web/                  # PC 超管前端 — Vite + TanStack Router (SPA,无 SSR)
│
├── packages/
│   └── shared/                     # 前后端共享 TypeScript 类型
│
├── docs/                           # 架构 / 契约 / 业务 / 运维文档
└── dumps/                          # 本地 DB dump + 还原步骤(`.gitignore` 排除)
```

## 本地一把启动(Docker)

需要先装好 **Docker Desktop**、**Node.js 22+**、**npm 10+**。

```bash
# 1. 装 workspace 依赖(给 IDE 用,容器内有自己的 node_modules)
npm install

# 2. 复制本地 env(填 OSS / Dify / 飞书等真实密钥;开发期可只留 DB/JWT/COCO)
cp .env.example .env

# 3. 一把起全栈(postgres + api + api-worker + web + admin-web + nginx)
docker compose --profile dev up -d

# 4. 跑数据库迁移(首次启动时 + 每次添加新 migration 后)
docker exec myj-api npx tsx src/db/migrate.ts up

# 5. 打开浏览器
#   - 移动端:http://localhost:8089
#   - PC 超管:http://localhost:8090
```

启动后健康检查:

```bash
curl http://localhost:8089/                                    # 200 = 移动端 SSR 正常
curl http://localhost:8090/                                    # 200 = PC SPA 正常
curl http://localhost:8090/api/v1/health                       # {"status":"ok",...}
```

### 常用调试命令

```bash
# 看实时日志
docker compose --profile dev logs -f api
docker compose --profile dev logs -f admin-web

# 进 api 容器(跑迁移 / 测试)
docker exec -it myj-api sh

# 进 postgres 看表
docker exec -it myj-postgres psql -U myj -d myj_dev

# 改 nginx 配置后重建镜像(template 是烘焙的,不能热加载)
docker compose build nginx && docker compose --profile dev up -d --force-recreate nginx
```

### 本地端口冲突

复制示例覆盖文件:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# 编辑里面的端口
```

## 协作 / 流程

**GitHub Flow** + 分支保护:

```
1. 从 main 拉一个分支     feat/xxx 或 fix/xxx
2. 在分支上完成你的任务
3. push 到 GitHub
4. 开 Pull Request
5. 合并后删除分支
```

直接 push 到 main 会被分支保护规则拦截。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 关键文档

| 我想知道 | 看哪里 |
|---|---|
| 怎么贡献代码 / 分支命名规则 / Conventional Commits | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 后端怎么开发 / 路由结构 / 环境变量 | [apps/api/README.md](apps/api/README.md) |
| 移动端前端怎么开发 / 路由 / 状态 | [apps/web/README.md](apps/web/README.md) |
| **所有 HTTP 接口契约(85+ 端点)** | [docs/api-contracts.md](docs/api-contracts.md) |
| **每张表 / 每个字段的业务含义 + ER 图** | [docs/database-schema.md](docs/database-schema.md) |
| 数据从 DB → service → route → 前端的转换链路 | [docs/data-flow.md](docs/data-flow.md) |
| 前端状态管理清单(Query / Context / localStorage) | [docs/state-management.md](docs/state-management.md) |
| 海报促销活动的业务流程(白话版,无技术词) | [docs/promotion-flow.md](docs/promotion-flow.md) |
| 生产部署拓扑 + deploy.sh 流程 | [docs/ops/deployment.md](docs/ops/deployment.md) |
| 商品识别微服务(detect-service)部署 | [docs/ops/detect-service-deployment.md](docs/ops/detect-service-deployment.md) |
| 竞品采集模块对接(外部协作者) | [docs/modules/competitor-collector.md](docs/modules/competitor-collector.md) |
| 用 dump 还原本地 DB 的 step-by-step | [dumps/RESTORE.md](dumps/RESTORE.md) |

## 当前技术栈速查

| 层 | 选择 |
|---|---|
| 后端 | Express 4 + TypeScript ESM + tsx watch + Pino + Zod |
| 数据库 | PostgreSQL 16 + 手写 SQL migration(`V001` → 当前 `V038`) |
| 移动端 | React 19 + TanStack Start (SSR) + TanStack Router + TanStack Query + Tailwind 4 + shadcn |
| PC 超管 | React 19 + Vite SPA + TanStack Router + TanStack Query(无 SSR) |
| 鉴权 | HttpOnly cookie session + 飞书 OAuth + 账号密码兜底 |
| AI 网关 | Dify 工作流(诊断 / 选品 / 虚拟陈列 / 凑单) + Corelays Gemini(海报生图) |
| 外部检测 | Roboflow YOLO + Qdrant + PE Embed(独立 detect-service) |
| 对象存储 | 阿里云 OSS |

## 角色

`system_role` enum 共 4 种:

| 角色 | 用途 |
|---|---|
| `super_admin` | 总部,能登录 PC 超管控制台 |
| `store_owner` | 店长,日常用移动端 |
| `analyst` | 分析师(预留,暂未启用) |
| `account_manager` | 渠道客户经理(预留,暂未启用) |

## 团队

- 组织:[rollingai-myj](https://github.com/rollingai-myj)
- 仓库:[rollingai-myj/integratedApp](https://github.com/rollingai-myj/integratedApp)
- 问题反馈:在 GitHub 上开 issue
