# docs/ 文档索引

整个 repo 的设计 / 契约 / 业务 / 运维文档都在这里。按你想知道的事分类:

## 我刚加入项目,第一次看哪个?

按顺序读这三份就能对项目有完整画面:

1. [../README.md](../README.md) — 仓库总览(双入口 / 目录结构 / 一把启动)
2. [database-schema.md](database-schema.md) — 数据库结构(35+ 表 + ER 图 + 字段含义,这是项目的"地基")
3. [api-contracts.md](api-contracts.md) — HTTP 接口契约(85+ 端点,前后端对齐基准)

读完这三份基本能开始干活。

## 按内容分类

### 架构 / 数据 / 契约

| 文档 | 讲什么 |
|---|---|
| [database-schema.md](database-schema.md) | 每张表、每个字段、ER 图、跨表规则、动作→写入路径速查;V001 → V038 演进记录 |
| [api-contracts.md](api-contracts.md) | 12 个模块共 85+ 个 HTTP 端点,含 admin-web 体系 20+ 新接口 |
| [data-flow.md](data-flow.md) | 数据从 DB → service → route → 前端的转换链路,每个字段在哪一层做了 snake_case → camelCase / NUMERIC → number 等转换 |
| [state-management.md](state-management.md) | 前端状态管理清单(Query 缓存 / Context / localStorage),核心是 mobile web 部分 |

### 业务流程

| 文档 | 讲什么 |
|---|---|
| [promotion-flow.md](promotion-flow.md) | 海报促销活动的端到端业务流程(白话版,无技术词):总部上传 → 翻译 → 海报 → 销量跟踪 |

### 模块对接(给协作者)

| 文档 | 讲什么 |
|---|---|
| [modules/competitor-collector.md](modules/competitor-collector.md) | 竞品采集模块怎么对接(数据模型 / 三张表 / 集成约定);⚠️ 旧"全局渠道维度模型"已下线 |

### 运维 / 部署

| 文档 | 讲什么 |
|---|---|
| [ops/deployment.md](ops/deployment.md) | 生产部署拓扑(两个域名 + nginx 双端口) + deploy.sh 流程 + 排查 |
| [ops/detect-service-deployment.md](ops/detect-service-deployment.md) | 商品识别微服务(detect-service)独立部署说明(Python FastAPI + GPU + Roboflow + Qdrant) |

### 一线开发参考

跟 docs/ 平级的几个 README,也都是常看的:

| 文档 | 讲什么 |
|---|---|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | GitHub Flow + 分支命名 + Conventional Commits + 数据库改动特别规则 |
| [../apps/api/README.md](../apps/api/README.md) | 后端启动 / 路由清单 / service 清单 / migration 工作流 / worker 说明 |
| [../apps/web/README.md](../apps/web/README.md) | 移动端启动 / 路由表 / 目录约定 / 状态层 |
| [../apps/admin-web/README.md](../apps/admin-web/README.md) | PC 超管控制台启动 / 路由表 / 鉴权门 / 常用模式 |
| [../packages/shared/README.md](../packages/shared/README.md) | 前后端共享类型层 |
| [../dumps/RESTORE.md](../dumps/RESTORE.md) | 用 dump 还原本地 DB 的 step-by-step |

## superpowers/

`superpowers/{plans,specs}/` 下的是**历史实施计划和设计文档**(按日期命名),不是当前在做的事。看代码现状以代码为准,看 plan 是为了理解"当时为什么这么设计"。已完成或被推翻的会移到 `superpowers/archive/`。

## 加新文档放哪儿?

- 一个**模块的对接说明**(给协作者或外部团队):`docs/modules/<name>.md`
- 一份**运维 / 部署文档**:`docs/ops/<name>.md`
- 一份**业务流程图 / 设计说明**(白话面向产品):`docs/<name>-flow.md`
- 一份**当前在做的事的设计草案 + 实施计划**:`docs/superpowers/specs/<date>-<name>-design.md` + `docs/superpowers/plans/<date>-<name>.md`(做完后移到 archive/)
- 改了 schema / 接口 → 优先**改这里现有的 `database-schema.md` / `api-contracts.md`**,而不是开新文档

> 让 docs/ 的结构稳定:**每加一个新文档,顺手在本索引里加一行。** 否则新人不知道有它存在。
