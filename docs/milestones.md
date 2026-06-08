# 里程碑与进度

> 这份文档是 integratedApp 的"开发路线图"。所有团队成员（包括 AI 工具）都从这里挑任务认领。

## 总体策略

完整重写一个统一的门店助手是几周的工程，按业务模块分成 6 个里程碑（M0-M5），每个里程碑通过一个或多个 Pull Request 推进。

每个里程碑完成的标志：
- 该里程碑涵盖的功能在本地能跑通
- 相关接口从"返回 501"变成"返回真实数据"
- 至少在 [docs/planning/unified-api-spec.md](planning/unified-api-spec.md) 上把对应接口标记为"已实现"

---

## M0 · 骨架与协作基础 ✅ 已完成

**目标**：建立仓库骨架，让团队能开始分支协作开发。

**产物**：
- ✅ GitHub 仓库 `rollingai-myj/integratedApp` 创建
- ✅ 顶层文档（README、CONTRIBUTING、PR 模板）
- ✅ 项目目录结构（apps/api + apps/web + packages/shared + docs）
- ✅ 后端 Express + TypeScript 骨架（80 个接口路由占位，2 个真实接口：`GET /api/v1/auth/me` 返回未登录、`GET /api/v1/health`）
- ✅ 前端 React + TanStack Start 骨架（门户首页 + 4 个模块路由壳子）
- ✅ 数据库 SQL 初始化文件（35 张表，按 12 个推荐决策默认值实现）
- ✅ `docker-compose.yml` 起本地 PostgreSQL
- ✅ `.env.example` 模板
- ✅ `main` 分支保护规则

**验收**：clone 仓库 → 按 README 步骤 → 本地能看到门户首页。

---

## M1 · 身份认证与门户 ⏳ 进行中

**目标**：飞书 SSO 登录跑通，店长能在门户首页看到自己的店和可访问的模块。

**涉及接口**（来自统一接口规划文档的"模块 1"和"模块 2"）：
- ✅ `GET /api/v1/auth/me` — 返回真实身份 + 可见门店 + 可访问模块（M1-PR1）
- ✅ `POST /api/v1/auth/login` — 账密兜底登录（D2 决策的过渡期方案，M1-PR1）
- ✅ `POST /api/v1/auth/logout` — 退出登录（M1-PR1）
- ⏳ `GET /api/v1/auth/feishu/authorize` — 飞书 OAuth 发起（M1-PR2）
- ⏳ `GET /api/v1/auth/feishu/callback` — 飞书 OAuth 回调（M1-PR2）
- ⏳ `POST /api/v1/auth/feishu/exchange` — 飞书 H5 SDK 码兑换（M1-PR2）
- ⏳ `GET /api/v1/auth/feishu/jsapi-config` — 飞书 H5 SDK 签名（M1-PR2）
- ⏳ `GET /api/v1/portal/modules` — 当前用户可访问的模块（M1-PR3）
- ⏳ `GET /api/v1/portal/stores` — 当前用户可访问的门店列表（M1-PR3）
- ⏳ `POST /api/v1/portal/switch-store` — 切换当前激活的门店（M1-PR3）
- ⏳ `GET /api/v1/portal/store/:storeId/profile` — 门店基本信息（M1-PR3）

**前端**：
- 登录页（飞书登录按钮 + 账号密码兜底）
- 飞书回调处理页
- 门户首页升级为读取真实模块和门店
- 切店组件

**外部依赖**：
- 需要先在飞书开放平台创建一个企业自建应用，拿到 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
- 配置飞书的"重定向 URL"指向本仓库的回调地址

**建议拆分**（每个一个 PR）：
- M1-PR1 `feat(auth): 账密兜底登录 + auth/me 真实实现`
- M1-PR2 `feat(auth): 飞书 OAuth 完整链路`
- M1-PR3 `feat(portal): 门户首页对接真实数据 + 切店`

---

## M2 · 货盘选品 ⏳ 待开始

**目标**：选品模块完整跑通——店长能拍照、做诊断、应用调改、生成虚拟货架。

**涉及接口**：[unified-api-spec.md 模块 4](planning/unified-api-spec.md) + [模块 5](planning/unified-api-spec.md)

**外部依赖**：
- 接通 Python detect-service（YOLO + PE + OCR）
- 接通 Dify 5 个工作流（selection、align、insight、questions、virtual_shelf）
- 阿里云 OSS 配置

**建议拆分**：
- M2-PR1 主数据查询（商品、分类、SKU 列表、竞品）
- M2-PR2 门店货架配置 + 场景定义
- M2-PR3 货架运行时（拍照、检测、状态管理）
- M2-PR4 调研问卷 + 周边洞察
- M2-PR5 一键调改 + 虚拟货架生成
- M2-PR6 SKU 勘误

---

## M3 · 价盘管理 ⏳ 待开始

**目标**：价盘模块完整跑通——店长能查看商品价格、调价、看曲线、对标竞品、做 AI 诊断。

**涉及接口**：[unified-api-spec.md 模块 6](planning/unified-api-spec.md)

**外部依赖**：Dify 价盘诊断工作流

**建议拆分**：
- M3-PR1 商品列表（含价格） + 价格曲线 + 竞品对标
- M3-PR2 调价提交 + 落两份数据（D3 + D4 决策）
- M3-PR3 AI 诊断网关

---

## M4 · 活动海报 ⏳ 待开始

**目标**：海报模块完整跑通——超管能上传促销 Excel，店长能选品 + 生成海报。

**涉及接口**：[unified-api-spec.md 模块 7](planning/unified-api-spec.md) + [模块 8](planning/unified-api-spec.md)

**外部依赖**：
- OpenRouter API（Gemini 图片生成）
- 阿里云 OSS 用于海报存储

**建议拆分**：
- M4-PR1 促销 Excel 上传、解析、激活
- M4-PR2 当前生效促销查询 + 个性化推荐
- M4-PR3 单张海报同步生成
- M4-PR4 批量海报队列
- M4-PR5 海报历史

---

## M5 · 后台管理 + 上线打磨 ⏳ 待开始

**目标**：超管后台完整功能 + 上线前的所有打磨。

**涉及接口**：[unified-api-spec.md 模块 9](planning/unified-api-spec.md) + [模块 12](planning/unified-api-spec.md)

**内容**：
- 账号管理、角色管理、门店分配
- 审计事件查询
- 用户使用时长统计
- 门店综合统计 + 实时大屏
- AI 模型切换 + 压测
- 自动清理过程数据（D12 决策的清理任务）
- CI / CD 配置
- 生产环境部署文档

---

## 12 个决策点的实现追踪

每个决策点在代码 / SQL 文件里都有对应注释（搜索 `D1`、`D2` 等）。如果未来要改某个决策：

1. 在 issue 里讨论变更理由
2. 开一个 `chore/decision-D{X}-change` 分支
3. 改代码 + 改 SQL（用新的 migration）+ 改 [unified-database-spec.md](planning/unified-database-spec.md)
4. 走 PR 流程

| 决策 | 默认实现 | 状态 |
|---|---|---|
| D1 一人一店 + 超管特权 | C | ✅ M0 落地 |
| D2 分阶段切换登录 | C | 🟡 账密兜底 done (M1-PR1)，飞书 OAuth ⏳ M1-PR2 |
| D3 调价插快照 | B | ⏳ M3 落实 |
| D4 调改记录 + SKU 流水两层 | C | ⏳ M2 落实 |
| D5 海报批次独立实体 | B | ⏳ M4 落实 |
| D6 选品 / 海报促销两套并存 | B | ⏳ M2 / M4 各自落实 |
| D7 业务表 + 统一审计表 | C | ✅ M0 落 schema，✅ 各 PR 持续埋点 |
| D8 商品库加官方图字段 | B | ✅ M0 落地 |
| D9 海报模板写在代码 | A | ⏳ M4 落实 |
| D10 周边洞察关键字段 + JSONB | C | ✅ M0 落 schema，⏳ M2 落业务 |
| D11 关键 AI 调用落库 | C | ⏳ 各 PR 持续埋点 |
| D12 自动清理过程数据 | B | ⏳ M5 落实 |

---

## 如何开始一个里程碑

1. 在 [Issues](https://github.com/rollingai-myj/integratedApp/issues) 里找对应里程碑的标签（`milestone:M1` 等）
2. 挑一个 issue，评论"我来做这个"
3. 按 [CONTRIBUTING.md](../CONTRIBUTING.md) 的流程开分支、开 PR
4. PR 描述里关联到 issue（`Closes #N`）

如果没有现成 issue，自己开一个，标好里程碑标签，再开始干。
