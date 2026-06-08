# 美宜佳门店助手 · 统一接口规划 v2

> 这份文档是**接口的 single source of truth**。
> 改接口的步骤：① 先改这份 → ② 改 `packages/shared/src/index.ts` → ③ 改后端 routes/services → ④ 改前端 hooks/UI。
>
> **v1 → v2 最大的变化**：门店上下文统一从会话读取，业务接口不再接受 `storeId` 入参。下面 § 0 是全局硬约束，所有人必读。

---

## 0. 全局约束：门店上下文规则 ⚠️ MUST READ

### 0.1 核心原则

> 一次会话只对应一家门店。业务接口**绝不接受** `storeId` 入参，全部从 session 取。

```
┌─────────────────────────────────────────────────────────────────┐
│  登录 ─────→ session.storeId 确定（飞书部门 / 账号绑定）          │
│   │                                                             │
│   │ ┌── 多店用户 ────→ POST /portal/active-store 切店              │
│   │ │                                                           │
│   ▼ ▼                                                           │
│  所有业务接口（货盘 / 价盘 / 海报）─────→ 从 session.storeId 执行  │
└─────────────────────────────────────────────────────────────────┘
```

### 0.2 三类 storeId 来源（按优先级）

| 来源 | 触发场景 | 谁来写 |
|---|---|---|
| **登录身份解析** | 飞书部门末端段匹配到 1 家店 / 账号本身只绑了 1 家店 | 后端在登录链路里写入 session |
| **门户切店接口** | 用户在门户首页下拉切店；超管想看别人的店 | 客户端调 `POST /portal/active-store`，后端更新 session |
| **session 注入** | 业务接口入参 | 后端 middleware 读 session 写入 `req.user.currentStoreId`，handler 直接用 |

### 0.3 业务接口 vs 资源 CRUD：两条不同的路

| | 业务接口 | 资源 CRUD |
|---|---|---|
| 含义 | "以当前店身份执行操作" | "管理某一行数据本身" |
| storeId 来自哪里 | `session.currentStoreId`（必有） | URL `:id` 段（必填） |
| 路径里能不能有 storeId | ❌ 不行 | ✅ 可以（且必须） |
| 示例路径 | `GET /skus`、`POST /prices/adjust` | `PUT /master/stores/:id`、`GET /master/environment/:storeId` |
| 典型调用方 | 店长、店主、做业务的超管 | 超管开关店 / 改地址等后台操作 |

判断口诀：**"我在以谁的身份操作？"**
- 答 "以某一家店的身份" → 业务接口，storeId 走 session
- 答 "我在管理这条记录本身" → 资源 CRUD，storeId 走 URL

### 0.4 超管想看别人门店的业务数据怎么办？

**没有 `?storeId=` override**。流程统一：
1. 调 `GET /portal/stores` 看可见门店列表（超管 = 全部）
2. 调 `POST /portal/active-store { storeId }` 切过去
3. 调业务接口（自动以新身份执行）
4. 看完想切回去再调一次 `/portal/active-store`

这样做的好处：**业务接口签名完全一致，没有"超管特殊分支"，前端代码零分叉**。

### 0.5 session 里没 storeId 时怎么办？

| 场景 | 行为 |
|---|---|
| 用户名下只有 1 家店 | 后端在登录链路自动选这家，session 永远有值 |
| 用户名下 0 家店（飞书部门未匹配） | 登录成功但 `notice = NO_STORE_MATCHED`，所有业务接口返 `409 NO_STORE_SELECTED` |
| 用户名下多家店但还没切 | 登录成功 + 默认选 primary 店；如果没标 primary 则选 `code` 升序第一家 |
| 超管账号 | 登录后默认 `currentStoreId = null`，业务接口返 `409`，必须先 `/portal/active-store` |

错误响应统一格式：

```json
{
  "error": { "code": "NO_STORE_SELECTED", "message": "请先选择门店再操作" },
  "requestId": "req_xxx"
}
```

前端拦截这个 code 后跳到门店选择 UI。

### 0.6 与 v1 spec 的差异速览

| v1 接口 | v2 接口 | 变化 |
|---|---|---|
| `GET /master/stores/:id/skus` | `GET /skus` | path 去掉 `:id`，从 session 读 |
| `POST /master/stores/:id/skus:import` | `POST /skus:import` | 同上 |
| `GET /shelves/config/:storeId` | `GET /shelves/config` | 同上 |
| `POST /shelves/config/:storeId` | `POST /shelves/config` | 同上 |
| `PUT /shelves/config/:storeId/:shelfId` | `PUT /shelves/config/:shelfId` | 同上 |
| `DELETE /shelves/config/:storeId` | `DELETE /shelves/config` | 同上 |
| `PUT /shelves/config/:storeId:replace-all` | `PUT /shelves/config:replace-all` | 同上 |
| `GET /scenes/:storeId/adjustments-count` | `GET /scenes/adjustments-count` | 同上 |
| `POST /scenes/:storeId/:sceneId/apply` | `POST /scenes/:sceneId/apply` | 同上 |
| `GET /scenes/:storeId/:sceneId/history` | `GET /scenes/:sceneId/history` | 同上 |
| `GET /scenes/:storeId/:sceneId/virtual-shelf-history` | `GET /scenes/:sceneId/virtual-shelf-history` | 同上 |
| `POST /scenes/:storeId/:sceneId/virtual-shelf` | `POST /scenes/:sceneId/virtual-shelf` | 同上 |
| `GET /shelves/state/:storeId` | `GET /shelves/state` | 同上 |
| `PUT /shelves/state/:storeId/:shelfId` | `PUT /shelves/state/:shelfId` | 同上 |
| `DELETE /shelves/state/:storeId` | `DELETE /shelves/state` | 同上 |
| `GET /shelves/photos/:storeId/:shelfId` | `GET /shelves/photos/:shelfId` | 同上 |
| `POST /shelves/photos/:storeId/:shelfId` | `POST /shelves/photos/:shelfId` | 同上 |
| `PUT /shelves/photos/:storeId/:shelfId/current` | `PUT /shelves/photos/:shelfId/current` | 同上 |
| `GET /surveys/:storeId/:shelfId/questions` | `GET /surveys/:shelfId/questions` | 同上 |
| `PUT /surveys/:storeId/:shelfId/questions` | `PUT /surveys/:shelfId/questions` | 同上 |
| `GET /surveys/:storeId/:shelfId/answers` | `GET /surveys/:shelfId/answers` | 同上 |
| `PUT /surveys/:storeId/:shelfId/answers` | `PUT /surveys/:shelfId/answers` | 同上 |
| `GET /shelves/errata/:storeId` | `GET /shelves/errata` | 同上 |
| `POST /shelves/errata/:storeId` | `POST /shelves/errata` | 同上 |
| `GET /prices/curve?storeId=xxx` | `GET /prices/curve` | 去掉 query |
| `GET /prices/changes/:storeId` | `GET /prices/changes` | 同上 |
| `POST /prices/adjust` body 含 `storeId` | body 不含 | body 删字段 |
| `POST /prices/diagnose` body 含 `storeId` | body 不含 | 同上 |
| `POST /posters/generate` body 含 `storeId` | body 不含 | 同上 |
| `POST /posters/queue/enqueue` body 含 `storeId` | body 不含 | 同上 |
| `GET /posters?storeId=xxx` | `GET /posters` | 去掉 query（scope=mine 看自己跨店的，scope=current 看本店；超管 scope=all） |

**保留的 `:id` / `:storeId`（资源 CRUD 例外）**：

| 接口 | 为什么保留 |
|---|---|
| `GET /master/stores?id=xxx` 和 `PUT /master/stores/:id` | 操作门店实体本身，不是"以这家店身份" |
| `GET /master/environment/:storeId` 和 `PUT /master/environment/:storeId` | 同上，门店周边洞察绑定到具体门店行 |
| `POST /portal/active-store` body `{ storeId }` | 这是**改 storeId 本身**的接口，必须显式 |

---

## 1. 通用约定

### 1.1 URL 前缀

所有接口都在 `/api/v1` 下。下面文档为了简洁省略前缀。

### 1.2 认证

```
请求带 Cookie: sso_token=xxx   （HttpOnly + SameSite=Lax）
```

未登录请求保护接口 → `401 UNAUTHORIZED`。

### 1.3 角色

- `super_admin` — 看全部门店、改全部门店主数据
- `store_owner` — 仅看 / 改自己绑定的门店

某些接口只允许特定角色，会在说明里注明。

### 1.4 统一响应格式

成功（业务数据直接返）：

```json
{ "stores": [...], "total": 12 }
```

失败：

```json
{
  "error": { "code": "BAD_REQUEST", "message": "skuCode 必填", "details": {} },
  "requestId": "req_xxx"
}
```

### 1.5 标准错误码

| code | HTTP | 含义 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 未登录 / token 失效 |
| `FORBIDDEN` | 403 | 已登录但角色不够 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `BAD_REQUEST` | 400 | 参数校验失败 |
| `CONFLICT` | 409 | 业务冲突（如重复提交） |
| `NO_STORE_SELECTED` | 409 | session 没有 currentStoreId（须先 /portal/active-store） |
| `UPSTREAM_ERROR` | 502 | 调外部服务失败（飞书 / Dify / OpenRouter） |
| `INTERNAL` | 500 | 兜底 |

---

## 2. 模块 1：认证

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/auth/me` | 任何（含未登录） | 返当前用户 + currentStore + 可见门店 + 可见模块 + notice。未登录 → `{user: null, ...}` |
| POST | `/auth/login` | 任何 | 账密兜底（决策 D2 过渡期）。成功种 cookie + 返 `{user, expiresAt, notice?}` |
| POST | `/auth/logout` | 任何 | 清 cookie，`204` |
| GET | `/auth/feishu/authorize?redirect_uri=xxx` | 任何 | 拿飞书登录跳转 URL + 顺便种 state cookie |
| POST | `/auth/feishu/exchange` | 任何 | `{code, state?, client?}` → 兑换 session |
| GET | `/auth/feishu/jsapi-config?url=xxx` | 已登录 | 飞书 H5 SDK 免登所需签名 |

**`GET /auth/me` 响应（重要 — 前端用它做路由守卫）**：

```typescript
{
  user: { id, name, email, avatarUrl, roles[] } | null,
  currentStore: { id, code, name, isPrimary } | null,
  stores: StoreRef[],            // 该用户可见的全部门店
  feishuLinked: boolean,
  modules: ('shelves'|'prices'|'posters'|'admin')[],
  notice?: { code: 'NO_STORE_MATCHED', message, unmatchedCandidates? } | null
}
```

`currentStore` 为 `null` 的两种场景：① 超管未切店；② 用户 0 门店（带 notice）。

---

## 3. 模块 2：门户与门店切换

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/portal/modules` | 已登录 | 当前用户可点亮的 4 个模块卡片（含 disabledReason） |
| GET | `/portal/stores` | 已登录 | 当前用户可见门店列表（店主 = 绑定的；超管 = 全部） |
| POST | `/portal/active-store` | 已登录 | `{storeId}` — **唯一改 session.currentStoreId 的接口** |

**`POST /portal/active-store` 行为**：

- 校验 `storeId` 在用户可见门店里（超管全过）
- 更新 session（DB users.active_store_id + 后端缓存）
- 返新的 `{currentStore}`
- 不通过 → `403 FORBIDDEN`

---

## 4. 模块 3：门店与组织主数据（资源 CRUD 例外区）

> ⚠️ 这一节大部分接口**显式带 `:id`**，因为是操作门店实体本身。仅超管可写。

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/master/stores?id=xxx` | 已登录 | 列出可见门店（带 `id` 查单家）。**只读，不切 session** |
| PUT | `/master/stores/:id` | 超管 | 新增 / 更新门店（id 可以是新生成的 UUID） |
| GET | `/master/environment/:storeId` | 已登录 | 门店周边洞察 |
| PUT | `/master/environment/:storeId` | 超管 / 店主（自己门店） | 同上写入 |

---

## 5. 模块 4：商品 / 销售主数据

> 凡是"当前门店在售 SKU"类接口，**全部从 session 读 storeId**。

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/master/categories` | 已登录 | 全局商品分类树 |
| GET | `/master/products?search&categoryId&limit` | 已登录 | 全局商品主数据（不区分门店） |
| GET | `/skus?search&categoryPath` | 已登录 + 有当前门店 | **当前门店**在售 SKU（含售价 / 销量快照） |
| POST | `/skus:import` | 超管 | 批量导入**当前门店** SKU 数据 |
| GET | `/master/competitors?categoryPath&skuCodes` | 已登录 | 竞品价格（按品类或按 SKU 查） |
| GET | `/master/baseline-skus?segment` | 已登录 | 基准 SKU 名单（core / innovation） |
| GET | `/master/promotion-skus` | 已登录 | 有促销文案的 SKU 列表 |
| GET | `/master/promotions-text?categoryPath&skuCodes` | 已登录 | 促销文案详情 |

**v1 → v2 路径变化**：
- `GET /master/stores/:id/skus` → `GET /skus`
- `POST /master/stores/:id/skus:import` → `POST /skus:import`

---

## 6. 模块 5：货盘选品

> 全部接口**从 session 读 storeId**。

### 6.1 货架配置

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/shelves/config` | 已登录 | 本店货架配置列表 |
| POST | `/shelves/config` | 店主 / 超管 | 新增一架 |
| PUT | `/shelves/config/:shelfId` | 店主 / 超管 | 更新一架 |
| DELETE | `/shelves/config` | 店主 / 超管 | body `{shelfCodes[]}` 批量删 |
| PUT | `/shelves/config:replace-all` | 店主 / 超管 | body `{configs[]}` 整店覆盖 |

### 6.2 场景调改

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/scenes` | 已登录 | 全局场景定义（货架位 × 品类） |
| GET | `/scenes/adjustments-count` | 已登录 | 本店各场景的调改次数 |
| POST | `/scenes/:sceneId/apply` | 店主 / 超管 | 一键应用调改（D4：写 scene_adjustment + N 行 ops_store_assortment_change） |
| GET | `/scenes/:sceneId/history?limit` | 已登录 | 本店本场景历史调改 |
| GET | `/scenes/:sceneId/virtual-shelf-history?limit` | 已登录 | 本店本场景虚拟货架历史 |
| POST | `/scenes/:sceneId/virtual-shelf` | 店主 / 超管 | 落一条虚拟货架生成结果 |

### 6.3 货架运行时

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/shelves/state` | 已登录 | 本店所有货架当前状态（含 SKU 列表 / 照片 / 检测） |
| PUT | `/shelves/state/:shelfId` | 店主 / 超管 | 更新单架运行时 |
| DELETE | `/shelves/state` | 店主 / 超管 | body `{shelfCodes[]}` 重置 |
| GET | `/shelves/photos/:shelfId?limit` | 已登录 | 单架照片历史 |
| POST | `/shelves/photos/:shelfId` | 店主 / 超管 | body `{imageUrls[]}` 新增一条历史 |
| PUT | `/shelves/photos/:shelfId/current` | 店主 / 超管 | body `{imageUrls[]}` 更新当前照片（不入历史） |

### 6.4 调研问卷

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/surveys/:shelfId/questions` | 已登录 | 本店本架题目 |
| PUT | `/surveys/:shelfId/questions` | 店主 / 超管 | 保存题目（AI 生成后存） |
| GET | `/surveys/:shelfId/answers` | 已登录 | 答案 |
| PUT | `/surveys/:shelfId/answers` | 店主 / 超管 | 提交答案 |

### 6.5 勘误

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/shelves/errata?limit` | 已登录 | 本店勘误记录 |
| POST | `/shelves/errata` | 店主 / 超管 | body `{shelfCode, skuCode, errorType, description}` |

---

## 7. 模块 6：价盘管理

> 全部接口**从 session 读 storeId**。

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/prices/curve?skuCodes&daysBack` | 已登录 | 本店指定 SKU 的价格 / 销量曲线 |
| GET | `/prices/changes?skuCode&limit` | 已登录 | 本店调价历史 |
| POST | `/prices/adjust` | 店主 / 超管 | body `{skuCode, newPrice, oldPrice?, source?, aiAdvice?, aiModel?, effectiveDate?, note?}`。**不含 storeId** |
| POST | `/prices/diagnose` | 店主 / 超管 | body `{skus: [{skuCode, currentPrice, ...}]}` 批量 AI 诊断 |

**v1 → v2 body 变化**：`/prices/adjust` 和 `/prices/diagnose` 的 body 都去掉 `storeId` 字段。

---

## 8. 模块 7：活动海报

> 全部接口**从 session 读 storeId**。海报记录会带上 storeId 落库供后台统计，但客户端不需要传。

### 8.1 海报生成（单张同步）

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| POST | `/posters/generate` | 已登录 | body `{template, mode, copyText, sourcePhotoUrl?, productImageUrl?, officialImageUrls?, customStyleDescription?, skuCode?, categoryName?}`。**不含 storeId**，从 session 取 |

### 8.2 海报生成（批量队列）

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| POST | `/posters/queue/enqueue` | 已登录 | body `{jobs: [generateInput, ...]}`。**不含 storeId** |
| POST | `/posters/queue/process` | 已登录 | 认领并跑一个任务。body `{jobId?}` |
| GET | `/posters/queue/active` | 已登录 | 我的活跃任务 |
| DELETE | `/posters/queue/batch/:batchId` | 任务创建者 / 超管 | 整批取消 |
| POST | `/posters/queue/task/:taskId/reset` | 任务创建者 / 超管 | 重置卡死 |
| POST | `/posters/queue/task/:taskId/retry` | 任务创建者 / 超管 | 失败重生成 |

### 8.3 历史

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/posters?scope&limit` | 已登录 | `scope=mine`（默认，跨店看自己生成的） / `scope=current`（仅当前店） / `scope=all`（仅超管） |

---

## 9. 模块 8：促销批次管理（超管）

> 促销批次是全局生效（决策 D6），与门店无关，无 storeId 概念。

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| POST | `/promotions/batches:upload` | 超管 | body `{fileName, sourceFileUrl?, notes?, activate?, rows[]}` |
| GET | `/promotions/batches?limit` | 超管 | 列出全部批次 |
| GET | `/promotions/active` | 已登录 | 当前生效批次的全部商品 + 混搭组 |
| GET | `/promotions/recommend` | 已登录 | 按用户近 30 天海报品类偏好重排 |
| DELETE | `/promotions/batches/:batchId` | 超管 | 删批次 |
| POST | `/promotions/batches/:batchId/activate` | 超管 | 切换激活批次（原激活的自动失活） |

---

## 10. 模块 9：后台管理（超管）

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| GET | `/admin/accounts?role&storeId&limit` | 超管 | 账号列表（带筛选，**这里 storeId 是 query 过滤条件，不影响 session**） |
| POST | `/admin/accounts` | 超管 | 创建账号（店主 / 超管） |
| POST | `/admin/accounts/:userId/reset-password` | 超管 | 重置密码 |
| DELETE | `/admin/accounts/:userId` | 超管 | 删账号 |
| PUT | `/admin/accounts/:userId/stores` | 超管 | body `{storeIds[]}` 重置该账号的门店绑定 |
| PUT | `/admin/accounts/:userId/roles` | 超管 | body `{roles[]}` 重置角色 |
| GET | `/admin/login-events?userId&limit` | 超管 | 登录事件 |
| GET | `/admin/audit-events?eventKind&userId&storeId&from&to` | 超管 | 审计查询 |
| GET | `/admin/usage-stats?storeId&from&to` | 超管 | 用户使用时长 |
| GET | `/admin/store-stats` | 超管 | 全部门店综合统计 |
| GET | `/admin/realtime-stats` | 超管 | 实时大屏 |
| GET | `/admin/settings/image-model` | 超管 | 当前海报 AI 模型 |
| PUT | `/admin/settings/image-model` | 超管 | 切换模型 |
| POST | `/admin/load-test/poster` | 超管 | 批量并发压测海报生成 |

> 说明：超管后台的 `storeId` 都是**过滤条件**（"我要看 A 门店的统计"），不写 session，不影响后续业务接口。

---

## 11. 模块 10：文件存储

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| POST | `/storage/upload` | 已登录 | multipart 上传，返 `{key, publicUrl}` |
| GET | `/storage/proxy?url=xxx` | 已登录 | 图片代理，绕开跨域 |
| GET | `/storage/official/:skuCode` | 已登录 | 商品官方图重定向（按 SKU 规则拼地址） |
| GET | `/storage/local/:key` | 已登录 | 仅 dev 模式：从 `/tmp/myj-uploads/` 取本地上传文件 |

---

## 12. 模块 11：AI 网关

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| POST | `/ai/dify/:workflow` | 已登录 | 统一 Dify 调用入口。`:workflow` 为 `price-diagnose` / `shelf-diagnose` / 等。body 透传给 Dify |
| POST | `/detect/shelf` | 已登录 | multipart 商品检测（拍照识别），转发到独立 detect service |

---

## 13. 模块 12：审计与使用统计

| Method | Path | 角色 | 说明 |
|---|---|---|---|
| POST | `/audit/events` | 服务端调（也接受已登录前端调） | 写一条审计 |
| POST | `/usage/sessions:start` | 已登录 | 开始使用会话（前端心跳） |
| POST | `/usage/sessions/:sessionId/heartbeat` | 已登录 | 续命心跳 |
| GET | `/usage/poster-count-today` | 已登录 | 本店本日海报数 |

---

## 14. 健康检查

| Method | Path | 说明 |
|---|---|---|
| GET | `/health` | 返 `{status: 'ok', version}` |

---

## 附录 A：v1 → v2 实施清单（给后续 PR 当 checklist）

### A.1 后端 routes 改名

| 文件 | 路由变化 |
|---|---|
| `apps/api/src/routes/master.routes.ts` | `GET /master/stores/:id/skus` → `GET /skus`；`POST /master/stores/:id/skus:import` → `POST /skus:import` |
| `apps/api/src/routes/shelves.routes.ts` | 全部 `/shelves/config/:storeId*` 和 `/shelves/state/:storeId*` 去掉 `:storeId` 段；`/scenes/:storeId/*` 去掉 `:storeId`；`/surveys/:storeId/:shelfId/*` 去掉 `:storeId`；`/shelves/errata/:storeId` 去掉 `:storeId`；`/shelves/photos/:storeId/:shelfId` 去掉 `:storeId` |
| `apps/api/src/routes/prices.routes.ts` | `?storeId=` query 去掉；body 去 `storeId` 字段 |
| `apps/api/src/routes/posters.routes.ts` | body 去 `storeId` 字段；`/posters?storeId` query 去掉，改 `scope` 语义 |

### A.2 后端 services 签名

所有 service 的 `storeId: string` 参数应改为从 `req.user.currentStoreId` 取（在 route handler 里读，再传给 service）。Middleware 增加：业务路由命中前确保 `currentStoreId !== null`，否则直接返 `409 NO_STORE_SELECTED`。

### A.3 前端 shared 类型

`packages/shared/src/index.ts` 删字段：
- `SubmitPriceChangeRequest.storeId`
- `PosterGenerateRequest.storeId`
- `EnqueuePostersRequest.storeId`（如果有）

### A.4 前端 api-client

- `pricesApi.curve(storeId, ...)` → `pricesApi.curve(params)`（去掉 storeId）
- `pricesApi.adjust(body)` body 不含 storeId
- `postersApi.generate(body)` body 不含 storeId
- `postersApi.list({ scope })` 含义改为：`scope=mine`（默认）/ `scope=current` / `scope=all`
- `masterApi.listStoreSkus(storeId, ...)` → `masterApi.listSkus(params)`
- `shelvesApi.listConfigs(storeId)` → `shelvesApi.listConfigs()`
- 等等

### A.5 前端 hooks 与 UI

- `useStoreSkus(storeId, ...)` → `useSkus(...)`
- `usePriceCurve(storeId, skus, days)` → `usePriceCurve(skus, days)`
- `useShelfConfigs(storeId)` → `useShelfConfigs()`
- 全局加一个 ErrorBoundary：捕获 `409 NO_STORE_SELECTED` → 跳门店选择 UI
- 切店 mutation 成功后失效所有业务 query

### A.6 v1 兼容期？

**不做**。v1 已经在 main 上但未上线，直接强切。

---

## 附录 B：错误码完整清单

见 § 1.5。新增的 `NO_STORE_SELECTED` 是 v2 唯一引入的 code。

---

## 附录 C：v1 历史（已废弃，仅供参考）

v1 spec 含 3 个层次：
1. 三个旧项目（skuSelection / priceChange / poster）的原始接口清单
2. 合并分析（哪些接口可以合并、怎么合）
3. 12 个统一模块的清单

v2 已把这些信息固化进上面的模块描述，原始 v1 完整内容在 git 历史里：
```bash
git show <在本文件加入 v2 之前的最后一个 commit>:docs/planning/unified-api-spec.md
```

如果想看历史合并决策的来龙去脉，再去看 v1；做日常开发参考 v2 即可。
