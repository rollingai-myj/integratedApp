# 接口契约清单

> 重构后的后端 HTTP 端点完整目录。**目的**：把"前端可能还在按旧数据结构调"这个最容易出问题的地方一次盘清。
>
> **基础约定**：全部端点挂在 `/api/v1` 前缀下；认证靠 HttpOnly cookie `sso_token`；业务接口的 `storeId` 一律从 session 取（**路径里看不到 `:storeId`** 的就是这种）；资源 CRUD 例外接口（如 `PUT /master/stores/:id`）才显式带 `:id`。
>
> **数据源**：
> - 路由实现：[apps/api/src/routes/](../apps/api/src/routes/)
> - OpenAPI（声明性）：[apps/api/openapi.yaml](../apps/api/openapi.yaml)
> - 服务层：[apps/api/src/services/](../apps/api/src/services/)
>
> 端点总数约 85 个，分 12 个模块。

---

## 全局错误码

| code | HTTP | 含义 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 未登录 / token 失效 |
| `FORBIDDEN` | 403 | 已登录但角色不够 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `BAD_REQUEST` | 400 | 参数校验失败 |
| `CONFLICT` | 409 | 业务冲突 |
| `NO_STORE_SELECTED` | 409 | session 没有 currentStoreId（业务接口） |
| `UPSTREAM_ERROR` | 502 | 调外部服务（飞书 / Dify / 检测服务）失败 |
| `INTERNAL` | 500 | 兜底 |

## 全局响应包络

```json
{
  "data": { /* 端点特定 payload */ },
  "error": { "code": "...", "message": "...", "details": {} },
  "requestId": "req_..."
}
```

## 全局分页

只用 `limit` query 参数；**没有 offset / cursor**。前端要分页只能多次请求或客户端缓存。

---

## 1. 认证 (Auth)

[routes/auth.routes.ts](../apps/api/src/routes/auth.routes.ts) · [services/auth.service.ts](../apps/api/src/services/auth.service.ts)

> 登录、登出、飞书 OAuth、session 管理。

| Method + Path | Auth | Inputs | Outputs (200) | 错误码 | 备注 |
|---|---|---|---|---|---|
| **POST** `/auth/login` | public | `account` (string, req), `password` (string, req) | `{ user: { id, name, email?, avatarUrl?, roles }, expiresAt }` | 401 UNAUTHENTICATED, 400 | 账密兜底登录；match `users.legacy_account` |
| **GET** `/auth/feishu/authorize` | public | `redirect_uri?` (URL) | `{ authorizeUrl, state }` | 400 | 生成 OAuth state cookie（5min 有效） |
| **POST** `/auth/feishu/exchange` | public | `code` (req), `state?`, `client` (enum: `feishu_h5\|feishu_pc\|browser`，默认 browser) | `{ user, expiresAt, notice? }` | 401, 400, 502 | code → token → identity 同步；门店未匹配时返回 `notice` |
| **GET** `/auth/feishu/jsapi-config` | public | `url` (req, URL) | `{ appId, timestamp, nonceStr, signature }` | 400 | H5 SDK 签名 |
| **GET** `/auth/me` | optional | — | `{ user?, currentStore?, stores[], feishuLinked, modules[], notice? }` | — | 未登录返回 `user: null`（不是 401） |
| **POST** `/auth/logout` | required | — | 204 | 401 | 清 cookie + 吊销 session |
| **POST** `/auth/feishu/callback` | — | — | **410 GONE** | — | 已弃用，请用 `/auth/feishu/exchange` |
| **POST** `/auth/feishu/h5-sign` | — | — | **410 GONE** | — | 已弃用，请用 `/auth/feishu/jsapi-config` |

**字段映射**：`display_name → name`，`avatar_url → avatarUrl`，snake_case → camelCase 全量。

---

## 2. 门户 (Portal)

[routes/portal.routes.ts](../apps/api/src/routes/portal.routes.ts) · [services/portal.service.ts](../apps/api/src/services/portal.service.ts)

> 模块清单 + 门店列表 + 切店（**唯一改 session storeId 的入口**）+ 在线使用心跳。

| Method + Path | Auth | Inputs | Outputs (200) | 错误码 | 备注 |
|---|---|---|---|---|---|
| **GET** `/portal/modules` | required | — | `{ modules: [{ key, label, enabled, disabledReason? }] }` | 401 | 4 模块：shelves / prices / posters / admin（按角色 gate） |
| **GET** `/portal/stores` | required | — | `{ stores: [StoreRef], total }` | 401 | super_admin 见所有门店；普通用户见自己绑定的 |
| **POST** `/portal/active-store` | required | `storeId` (UUID, req) | `{ currentStore: StoreRef }` | 401, 400, 403, 404 STORE_NOT_FOUND | 校验访问权 |
| **POST** `/portal/usage:start` | required | `deviceId?` (max 128) | 201 `{ id }` | 401 | 启动使用 session，返回 id 用于心跳 |
| **POST** `/portal/usage/:usageId/heartbeat` | required | `:usageId` (UUID) | 204 | 401, 400, 404 | 刷新超时 |

`StoreRef` = `{ id, code, name, isPrimary?, isProjectStore?, city?, latitude?, longitude?, address? }`，latitude/longitude **是 number**（DB 里是 NUMERIC 字符串，service 层 `Number()` 转过）。

---

## 3. 主数据 (HQ / Master)

[routes/hq.routes.ts](../apps/api/src/routes/hq.routes.ts) · [services/hq.service.ts](../apps/api/src/services/hq.service.ts)

> 分类树、商品主数据、benchmark SKU、门店主数据维护。

| Method + Path | Auth | Inputs | Outputs (200) | 错误码 | 备注 |
|---|---|---|---|---|---|
| **GET** `/hq/categories` | required | — | `{ tree: CategoryNode[] }` | 401 | 4 级树（in-memory 构建） |
| **GET** `/hq/products` | required | `q?`, `categoryId?` (UUID), `scene?` (0-12), `skuCodes?` (CSV), `limit?` (1-500, 默认 50) | `{ products: ProductRow[] }` | 401, 400 | |
| **GET** `/hq/products/:skuCode/official-image` | public | `w?` (像素宽，触发 OSS resize) | 302 redirect 到 OSS URL | 404 | 用于 `<img src>`，所以不验登录 |
| **GET** `/hq/products/:skuCode/barcode` | public | — | 302 redirect 到条码图 | 404 | |
| **GET** `/hq/benchmark-skus` | required | `segment?` (`core\|innovation`) | `{ benchmarks: BenchmarkRow[] }` | 401 | |
| **PUT** `/hq/stores/:storeId` | super_admin | body: `{ code, name, province?, city?, address?, latitude?, longitude?, openedAt?, isProjectStore?, storeAreaSqm?, poiCategory? }` | `{ id }` | 401, 403, 400, 404 | 审计 |

**`CategoryNode`** = `{ id, parentId, level (0-3), scene?, code, name, children? }`

**`ProductRow`** = `{ id, skuCode, productName, brand?, spec?, unit?, series?, shelfLifeDays?, lengthMm?, widthMm?, heightMm?, categoryId?, categoryPath?, scene?, isNewProduct, isPrivateLabel, wholesalePrice?, suggestedRetailPrice?, introducedAt?, status }` —— 平铺尺寸、含 5 个总部标签字段；和 shared 类型一致。

---

## 4. 货盘 (Shelves / Scenes)

[routes/scenes.routes.ts](../apps/api/src/routes/scenes.routes.ts) · [services/scene.service.ts](../apps/api/src/services/scene.service.ts)

> 场景配置、货架管理、拍照检测、AI 诊断/选品/虚拟货架、调整、纠错、调研问卷。

### 配置 / 概览

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/scenes` | required | — | `{ scenes: SceneDef[] }` | HQ 定义（不带门店上下文） |
| **GET** `/scenes/overview` | required + store | — | `{ scenes: SceneOverview[] }` | 当前门店每个场景的状态、调整数、草稿 |
| **GET** `/scenes/:scene/benchmark` | required + store | `:scene` (0-12) | `{ scene, items: [...] }` | 实时计算 |

### Runtime（草稿状态机）

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/scenes/:scene/runtime` | required + store | `:scene` | `SceneRuntime` 或空 stub | |
| **PUT** `/scenes/:scene/runtime` | required + store | body: `Partial<SceneRuntime>` | merged `SceneRuntime` | upsert + merge |
| **DELETE** `/scenes/:scene/runtime` | required + store | `:scene` | 204 | 清空 |

`SceneRuntime` = `{ scene, status (empty\|photo_uploaded\|detected\|reviewing\|confirmed), photos[], detectionData, virtualStatus, virtualRawOutputs?, virtualContext?, lastSnapshot?, envCrowd?, envCompetitor?, draft?, updatedAt? }`

### 照片、检测

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **POST** `/scenes/:scene/photos` | required + store | multipart: `files` (最多 3 张，每张 ≤ 8 MB) | 201 `{ urls: string[] }` | 传 OSS，append 到 runtime.photos |
| **POST** `/scenes/:scene/detect` | required + store | `{ imageBase64 (req), filename? }` | `{ boxes: DetectBox[], elapsedMs }` | 转 detect-service，挂掉走 mock；`?error=upstream_down` 强制 502 |

### 货架配置

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/scenes/:scene/shelves` | required + store | `:scene` | `{ groups: ShelfGroup[] }` | |
| **PUT** `/scenes/:scene/shelves` | required + store | `{ groups: [...] }` | `{ groups: [...] }` | 全量替换 |

`ShelfGroup` = `{ storeId, scene, groupIndex, shelfType?, widthCm?, layerCount?, categories: string[], notes? }`

### 调整 (Adjustments) + 纠错 (Corrections)

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **POST** `/scenes/:scene/adjustments` | required + store | `{ summaryText?, aiSessionId?, items: [{ action (add\|remove), skuCode, productName?, reasonCode?, reasonText? }] }` | 201 `Adjustment` | 审计 |
| **GET** `/scenes/:scene/adjustments` | required + store | `limit?` (1-200, 默认 50) | `{ adjustments: Adjustment[] }` | |
| **POST** `/scenes/:scene/corrections` | required + store | `{ skuCode, kind (missed\|false_positive\|remove\|add\|observe), scope (detection\|decision), reasonCode, reasonText?, evidenceImageUrl? }` | 201 `Correction` | |
| **GET** `/scenes/:scene/corrections` | required + store | `scope?` | `{ corrections: Correction[] }` | |

### 虚拟货架历史

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/scenes/:scene/virtual-history` | required + store | `limit?` (1-50, 默认 20) | `{ history: [...] }` | |
| **POST** `/scenes/:scene/virtual-history` | required + store | `{ imageUrl (URL), rawOutput?, aiSessionId? }` | 201 `{ id, ... }` | |

### 文案 + AI Workflows (SSE)

| Method + Path | Auth | Inputs | Outputs | 备注 |
|---|---|---|---|---|
| **POST** `/scenes/:scene/ai/diagnose` | required + store | `{ photoUrl }` | **SSE 流**（Dify align workflow） | `text/event-stream`，非 JSON wrapped |
| **POST** `/scenes/:scene/ai/strategy` | required + store | — | **SSE 流**（Dify selection workflow） | |
| **POST** `/scenes/:scene/ai/virtual-shelf` | required + store | — | **SSE 流**（Dify virtual_shelf workflow） | |

⚠️ **SSE 端点**：返回 newline-delimited Dify 原始 chunk，前端必须用 streaming parser（见 [apps/web/src/features/shelves/sse.ts](../apps/web/src/features/shelves/sse.ts)）。

---

## 5. 价盘 (Prices)

[routes/prices.routes.ts](../apps/api/src/routes/prices.routes.ts) · [services/prices.service.ts](../apps/api/src/services/prices.service.ts)

> 价格曲线、调价记录、调价提交。

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/prices/curve` | required + store | `skuCode?` 或 `skuCodes?` (CSV), `daysBack?` (默认 365，max 1825) | `{ curves: PriceCurveSku[] }` | merge snapshots + changes |
| **GET** `/prices/changes` | required + store | `skuCode?`, `limit?` | `{ changes: PriceChangeRecord[] }` | |
| **POST** `/prices/changes` | required + store | `{ skuCode, newPrice, oldPrice?, source?, effectiveDate?, note? }` | 201 `{ record }` | 审计 |

`PriceCurveSku` = `{ skuCode, productName?, points: [{ snapshotDate, retailPrice?, originalPrice?, wholesalePrice?, salesQty30d?, salesAmount30d?, grossMargin30d?, source ('snapshot'\|'change'), priceChangeId? }] }` —— **关键字段** `source` 区分原点。

---

## 6. 门店 SKU + 货架 (Store)

[routes/store.routes.ts](../apps/api/src/routes/store.routes.ts) · [services/store-skus.service.ts](../apps/api/src/services/store-skus.service.ts)

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/store/skus` | required + store | `scene?` (0-12), `q?` | `{ skus: StoreSkuRow[] }` | 最新快照 + 同比变化 |
| **GET** `/store/shelves` | required + store | — | `{ shelves: ShelfGroup[] }` | 跨所有场景 |
| **POST** `/store/skus:import` | super_admin + store | `{ snapshotDate, rows: [...] }` | 201 `{ inserted, updated, skipped }` | 批量 upsert |

`StoreSkuRow` = `{ productId, skuCode, name, brand?, spec?, unit?, categoryPath?, scene?, retailPrice?, originalPrice?, wholesalePrice?, salesQty30d?, salesAmount30d?, grossMargin30d?, stockQty?, snapshotDate, salesAmountChange30d?, salesQtyChange30d? }` —— **`salesXxxChange30d` 是百分比**，服务层运行时算出。

---

## 7. 海报 (Posters)

[routes/posters.routes.ts](../apps/api/src/routes/posters.routes.ts) · [services/posters.service.ts](../apps/api/src/services/posters.service.ts)

> 海报生成任务、画廊、素材库、销量跟踪。

### Tasks（批次 + 任务）

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **POST** `/posters/tasks` | required + store | `{ tasks: PosterTaskInput[] }` (1-20) | 201 `{ batchId, tasks: PosterTask[] }` | |
| **GET** `/posters/tasks` | required | `scope?` (`mine\|current\|all`, 默认 mine), `status?` (`active\|done\|failed`), `batchId?`, `storeId?`, `limit?` | `{ tasks: PosterTask[] }` | scope=all 要 super_admin |
| **GET** `/posters/tasks/:taskId` | required | `:taskId` | `{ task: PosterTask, generations: [...] }` | 所有权 check |
| **DELETE** `/posters/tasks/batch/:batchId` | required | `:batchId` | `{ cancelled }` | |
| **POST** `/posters/tasks/:taskId/generations` | required | `:taskId` | 201 `{ generation }` | 重新生成 |

`PosterTaskInput` 中 `mode` = `photo_compose\|official_bg_only\|multi_product`，`template` = `vibrant\|premium\|minimal\|custom`。

### Generations（worker + 用户行为）

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/posters/generations/:generationId` | required | `:generationId` | `{ generation, taskId, batchId }` | |
| **POST** `/posters/generations:claim` | required | `{ generationId? }` | `{ generation, taskId, batchId }` 或 204 | worker 拉队列 |
| **POST** `/posters/generations/:generationId/adopt` | required + store | `:generationId` | `{ generation }`（含 `adopted:true`, `adoptedAt`） | 用户采纳 |
| **POST** `/posters/generations/:generationId/download` | required + store | `:generationId` | `{ generation }`（`downloadCount` +1） | |

### 画廊 + 配额 + 素材

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/posters/gallery` | required | `scope?`, `adopted?` (`'true'\|'false'`), `limit?` (1-200), `storeId?` | `{ generations: [...] }` | scope=current 要选店 |
| **GET** `/posters/today-count` | required + store | — | `{ count, limit, resetAt }` | 当日生成配额 |
| **POST** `/posters/assets` | required + store | multipart: `file`, `kind` (`background\|product_photo`) | 201 `{ asset }` | |
| **GET** `/posters/assets` | required + store | `kind?` | `{ assets: [...] }` | |
| **DELETE** `/posters/assets/:assetId` | required + store | `:assetId` | 204 | |
| **GET** `/posters/sales-tracking` | required + store | `days?` | `{ items: [{ skuCode, adoptedCount, downloadCount, salesQty, salesAmount, roi? }] }` | |

---

## 8. 促销 (Promotions)

[routes/promotions.routes.ts](../apps/api/src/routes/promotions.routes.ts) · [services/promotions.service.ts](../apps/api/src/services/promotions.service.ts)

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **POST** `/promotions/batches:upload` | super_admin | `{ fileName, sourceFileUrl?, notes?, activate?, rows: [...] }` (≤ 20 000 行) | 201 `PromotionUpload` | Excel/CSV 批次上传 |
| **GET** `/promotions/batches` | super_admin | `limit?` | `{ batches: PromotionUpload[] }` | |
| **DELETE** `/promotions/batches/:batchId` | super_admin | `:batchId` | `{ deleted: true }` | 软删 |
| **POST** `/promotions/batches/:batchId/activate` | super_admin | `:batchId` | `{ upload }` | 激活该批，反激活其他 |
| **GET** `/promotions/active` | required | — | `{ upload: ActiveBatch \| null, products: ProductPromotion[] }` | |
| **GET** `/promotions/recommend` | required | — | `{ products: [...] }` | 个性化推荐 |

---

## 9. 竞品 (Competitors)

[routes/competitors.routes.ts](../apps/api/src/routes/competitors.routes.ts) · [services/competitors.service.ts](../apps/api/src/services/competitors.service.ts)

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/competitors` | required + store | — | `{ competitors: Competitor[] }` | |
| **POST** `/competitors` | required + store | `{ name, kind ('online'\|'offline'), province?, city?, address?, distanceM? }` | 201 `{ competitor }` | |
| **PUT** `/competitors/:competitorId` | required + store | partial | `{ competitor }` | |
| **GET** `/competitors/:competitorId/products` | required + store | `:competitorId` | `{ products: CompetitorProduct[] }` | |
| **POST** `/competitors/:competitorId/products` | required + store | `{ externalSku?, productName, brand?, spec?, mappedProductId?, productUrl?, imageUrl? }` | 201 `{ product }` | |
| **POST** `/competitors/products/:productId/prices` | required + store | multipart: `photo?`, `retailPrice` (req), `promoPrice?`, `promoText?`, `snapshotDate?` | 201 `{ price }` | |
| **GET** `/competitors/price-compare` | required + store | `skuCode?` | `{ items: [{ skuCode, ourPrice?, competitorPrices: [...] }] }` | **未在 OpenAPI 中** |

---

## 10. 洞察 (Insights)

[routes/insights.routes.ts](../apps/api/src/routes/insights.routes.ts)

| Method + Path | Auth | Inputs | Outputs (200) | 备注 |
|---|---|---|---|---|
| **GET** `/insights` | required + store | — | `StoreInsight \| null` 即 `{ category, crowdSourceAnalysis, competitorAnalysis, topCompetitors }` | V015 起精简至 4 字段 |
| **PUT** `/insights` | required + store | `{ category?, crowdSourceAnalysis?, competitorAnalysis?, topCompetitors? }` | 同 GET | upsert |
| **POST** `/insights/ai/report` | required + store | — | **SSE 流**（Dify insight workflow，POI inputs 取自 `store_insights.poi_data` 缓存；首次未命中则同步调高德 + 写回） | |
| **GET** `/insights/surveys/questions` | required + store | `scene?` (0-12) | `{ questions: [...] }` | scope=null 表全店 |
| **PUT** `/insights/surveys/questions` | required + store | `scene?` query, `{ questions: [...], source? ('ai'\|'manual') }` | `{ questions: [...] }` | 替换 scope 内问题 |
| **POST** `/insights/surveys/questions/ai` | required + store | `scene` (req!) | **SSE 流** | |
| **PUT** `/insights/surveys/answers` | required + store | `{ answers: [{ questionId, value }] }` | `{ written }` | 批量提交 |

---

## 11. 管理 (Admin)

[routes/admin.routes.ts](../apps/api/src/routes/admin.routes.ts) · [services/admin-stats.service.ts](../apps/api/src/services/admin-stats.service.ts) · [services/admin-accounts.service.ts](../apps/api/src/services/admin-accounts.service.ts)

> 全部要 `super_admin` 角色。

### 账号

| Method + Path | Inputs | Outputs (200) |
|---|---|---|
| **GET** `/admin/accounts` | — | `{ accounts: AdminAccount[] }` |
| **POST** `/admin/accounts` | `{ account, password (8-128), displayName, email?, roles?, storeIds? }` | 201 `{ id, account, displayName, ... }` |
| **POST** `/admin/accounts/:userId/reset-password` | `{ password (8-128) }` | `{ ok: true }` |
| **DELETE** `/admin/accounts/:userId` | — | 204 |
| **PUT** `/admin/accounts/:userId/stores` | `{ storeIds: [UUID], primaryStoreId? }` | `{ ok: true }` |
| **PUT** `/admin/accounts/:userId/roles` | `{ roles: [string] }` | `{ ok: true }` |

### 审计 + 登录

| Method + Path | Inputs | Outputs (200) |
|---|---|---|
| **GET** `/admin/login-events` | `limit?` (1-1000), `userId?` | `{ events: LoginEvent[] }` |
| **GET** `/admin/audit-events` | `kind?`, `storeId?`, `from?`, `to?`, `limit?` | `{ events: AuditEvent[] }` |

### 使用统计

| Method + Path | Outputs (200) |
|---|---|
| **GET** `/admin/usage-stats` | `{ today: { activeUsers, sessionMinutes }, thisWeek, thisMonth, total, onlineCount }` |
| **GET** `/admin/store-stats` | `{ stores: [...] }` |
| **GET** `/admin/realtime-stats` | `{ last5min, lastHour, today, onlineUsers: [...] }` |

### 设置 + 压测

| Method + Path | Inputs | Outputs (200) |
|---|---|---|
| **GET** `/admin/settings/image-model` | — | `{ key: "image-model", value, updatedAt }` |
| **PUT** `/admin/settings/image-model` | `{ value (1-256) }` | `{ key, value, updatedAt }` |
| **POST** `/admin/load-test/poster` | `{ concurrency (1-20), storeId, skuCode, template? }` | `{ batchId, created, elapsedMs }` |

---

## 12. 存储 + 文档 + 健康

| Method + Path | Auth | Outputs | 备注 |
|---|---|---|---|
| **GET** `/storage/local/:key` | public | 文件流 | dev fallback，仅本地 |
| **GET** `/storage/oss-image` | public | 图片二进制 | OSS 反代；key 必须前缀 `myjadviser/`（防 SSRF） |
| **GET** `/docs` | public | HTML（Swagger UI） | |
| **GET** `/docs.json` | public | OpenAPI JSON | |
| **GET** `/docs.yaml` | public | OpenAPI YAML | |
| **GET** `/health` | public | `{ status: 'ok', version }` | 不在 OpenAPI 里 |

---

## 漂移热点（前端最容易踩坑的地方）

### A. OpenAPI 漏了，代码里活的

- `GET /health`
- `POST /portal/usage:start` + `POST /portal/usage/:usageId/heartbeat`
- `GET /hq/products/:skuCode/barcode`
- `POST /admin/load-test/poster`
- `GET /competitors/price-compare`

### B. 已废弃（前端别再调）

- `POST /auth/feishu/callback` → 用 `/auth/feishu/exchange`
- `POST /auth/feishu/h5-sign` → 用 `/auth/feishu/jsapi-config`

两个都返 410 GONE。

### C. 响应字段转换最复杂的端点

| 端点 | 复杂点 |
|---|---|
| `GET /store/skus` | 拼 snapshot + 上期，运行时算 `salesAmountChange30d` / `salesQtyChange30d` 百分比 |
| `GET /hq/categories` | 平表 → 4 级树（in-memory） |
| `GET /prices/curve` | snapshots + price_changes 双源合并、按日排序、`source` 字段区分 |
| `GET /scenes/overview` | 大 join，含可选嵌套 draft 对象 |
| `GET /admin/store-stats` | 跨表聚合 |

### D. 嵌套对象（已收敛）

- `ProductRow.dimensions` 嵌套形态已在 2026-06-14 改成平铺 `lengthMm / widthMm / heightMm`，详见 [data-flow.md § 3](./data-flow.md#3--主数据-master--hq)。
- `scenes/:scene/runtime.photos` 上传路径已 wrap 成 `{url}`，DB 形状和前端类型一致。

### E. SSE 端点（不能按 JSON 解析）

5 个 AI workflow 端点全是 SSE：

- `POST /scenes/:scene/ai/diagnose`
- `POST /scenes/:scene/ai/strategy`
- `POST /scenes/:scene/ai/virtual-shelf`
- `POST /insights/ai/report`
- `POST /insights/surveys/questions/ai`

`Content-Type: text/event-stream`，OpenAPI 里基本没写清。

---

## 前端核对清单（按域快速验）

1. **Auth**：`POST /auth/login` 设置 `sso_token` cookie；`/auth/me` 未登录返 `user: null` 不是 401。
2. **Portal**：`POST /portal/active-store` 之后必须等 `['auth', 'me']` 重新拿回新 `currentStore`，前端不能本地缓存 storeId。
3. **Master**：`/hq/products` 的 `dimensions` 是嵌套对象。
4. **Scenes**：5 个 SSE 端点用 streaming parser；`runtime.photos` 形状要核对。
5. **Prices**：`/prices/curve` 返回的 `source: 'snapshot' | 'change'` 区分来源；`salesAmountChange30d` 是百分比。
6. **Posters**：`scope=all` 要 super_admin；`adopted` query 是字符串 `'true'/'false'` 不是 boolean。
7. **Competitors**：`/competitors/price-compare` 不在 OpenAPI 里。
8. **Admin**：usage-stats 是嵌套 `today: { activeUsers, sessionMinutes }` 不是平铺。
