# 美宜佳门店助手 · 统一应用（integratedApp）

> 美宜佳门店助手的统一前后端 + 数据库。当前处于 **M0 骨架阶段**——所有目录结构、数据库表、接口路由都已就位，业务功能将在 M1 - M5 通过分支 PR 逐步实现。

---

## 这是什么

把原来三个独立项目（[skuSelection](https://github.com/rollingai-myj/skuSelection)、[priceChange](https://github.com/rollingai-myj/priceChange)、[poster](https://github.com/rollingai-myj/poster)）+ 一个"美宜佳门户" demo 合并重写后的统一应用：

- **货盘选品**：店长针对当前门店的货盘做上下架调整
- **价盘管理**：针对门店当前 SKU 调价，跟踪调价后销量变化
- **活动海报**：根据促销活动和商品照片生成海报图
- **门户**：四个模块的统一入口 + 飞书 SSO 登录

## 目录结构

```
integratedApp/
├── README.md                    # 你在看的这份
├── CONTRIBUTING.md              # 协作贡献规范（必读）
├── docker-compose.yml           # 本地起 PostgreSQL
├── .env.example                 # 环境变量模板
├── package.json                 # npm workspace 根
│
├── docs/                        # 所有规划与参考文档
│   ├── milestones.md            # M0-M5 里程碑 + 当前进度
│   ├── planning/
│   │   ├── unified-api-spec.md         # 接口规划（80 个接口的权威定义）
│   │   └── unified-database-spec.md    # 数据库规划（35 张表 + 12 个决策点）
│   └── reference/
│       ├── feishu-auth-integration.md      # 飞书登录通用方案
│       └── unified-sso-auth-architechture.md  # 统一 SSO 架构参考
│
├── apps/
│   ├── api/                     # 后端（Node.js + Express + TypeScript）
│   │   ├── src/                 # 源代码
│   │   ├── src/db/migrations/   # 数据库初始化 SQL
│   │   └── README.md            # 后端如何启动与开发
│   │
│   └── web/                     # 前端（React + TanStack Start）
│       ├── src/                 # 源代码
│       └── README.md            # 前端如何启动与开发
│
└── packages/
    └── shared/                  # 前后端共享的类型定义
```

## 当前状态（M0）

| 区块 | 状态 |
|---|---|
| 项目骨架（目录、配置） | ✅ 完成 |
| 数据库 schema（35 张表） | ✅ 完成（按 12 个推荐决策默认值实现） |
| 后端 80 个接口路由占位 | ✅ 完成（除 `auth/me`、`/health` 外都返回 501） |
| 前端门户首页 + 四个模块路由壳子 | ✅ 完成 |
| 飞书 OAuth 集成 | ⏳ M1 实现 |
| 货盘选品业务功能 | ⏳ M2 实现 |
| 价盘管理业务功能 | ⏳ M3 实现 |
| 活动海报业务功能 | ⏳ M4 实现 |
| 后台管理 + 上线打磨 | ⏳ M5 实现 |

详见 [docs/milestones.md](docs/milestones.md)。

## 本地启动（5 分钟）

需要先装好：**Docker Desktop**、**Node.js 22+**、**npm 10+**。

```bash
# 1. 装依赖
npm install

# 2. 启动本地 PostgreSQL（用 Docker）
docker-compose up -d postgres

# 3. 复制环境变量模板
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 4. 初始化数据库（建表 + 写入种子数据）
npm run -w apps/api migrate

# 5. 启动后端（端口 8787）
npm run -w apps/api dev

# 6. 另开一个终端启动前端（端口 5173）
npm run -w apps/web dev

# 7. 浏览器打开 http://localhost:5173
```

如果某一步报错，去看对应的 README：
- 后端启动问题：[apps/api/README.md](apps/api/README.md)
- 前端启动问题：[apps/web/README.md](apps/web/README.md)

## 协作开发

**这个项目用 GitHub Flow 开发**：所有改动都通过分支 + Pull Request 进入 main 分支，不允许直接 push 到 main。

开始干活前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。一句话概要：

```
1. 从 main 拉一个分支 → feat/xxx 或 fix/xxx
2. 在分支上完成你的任务
3. 推到 GitHub，开一个 Pull Request
4. 至少 1 人 review 通过后才能合并
5. 合并后删除分支
```

## 关键文档导航

| 我想知道 | 看哪里 |
|---|---|
| **第一次接手本仓的同事看这里** | **[docs/team-quickstart.md](docs/team-quickstart.md)** |
| 项目要做什么、当前进度 | 这份 README + [docs/milestones.md](docs/milestones.md) |
| 所有接口的设计 | [docs/planning/unified-api-spec.md](docs/planning/unified-api-spec.md) |
| 所有数据库表的设计 + 12 个决策点 | [docs/planning/unified-database-spec.md](docs/planning/unified-database-spec.md) |
| 怎么贡献代码（规则参考） | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 后端怎么写、跑、调试 | [apps/api/README.md](apps/api/README.md) |
| 前端怎么写、跑、调试 | [apps/web/README.md](apps/web/README.md) |
| 飞书登录怎么接入 | [docs/reference/feishu-auth-integration.md](docs/reference/feishu-auth-integration.md) |

## 团队

- 组织：[rollingai-myj](https://github.com/rollingai-myj)
- 仓库：[rollingai-myj/integratedApp](https://github.com/rollingai-myj/integratedApp)
- 问题反馈：在 GitHub 上开 issue
