# 数据流向图

> 数据从 **数据库 → 服务层 → 路由层 → 前端消费** 的完整链路。**目的**：把字段名 / 嵌套结构在哪一层做了转换、消费方有没有跟上，逐域查清。
>
> 入口指引：
> - DB 迁移：[apps/api/src/db/migrations/](../apps/api/src/db/migrations/)（V001 - V013）
> - Service：[apps/api/src/services/](../apps/api/src/services/)
> - Route：[apps/api/src/routes/](../apps/api/src/routes/)
> - 共享类型：[packages/shared/src/index.ts](../packages/shared/src/index.ts)
> - 前端 API client：[apps/web/src/lib/api-client.ts](../apps/web/src/lib/api-client.ts)
> - 接口契约速查：[api-contracts.md](./api-contracts.md)
>
> **TL;DR 漂移**：全栈对齐 ✓
> - ~~🔴 `/hq/products` 的 dimensions / productName / 5 缺字段~~ → **已修**（2026-06-14 重构后补全；详见 [§ 3](#3--主数据-master--hq)）
> - ~~🟡 `/scenes/:scene/runtime` 的 photos~~ → **不是漂移**（上传路径已 wrap 成 `{url}`，是真对齐）
> - ~~🟢 `postersApi.generate/list`~~ → **已删**（一并删了 shared 的 `PosterGenerateRequest/Response`、`PosterRecord`、`PosterListResponse`）

---

## 通用转换规则

后端**所有**响应统一做：

| 输入（DB） | 输出（JSON） |
|---|---|
| `snake_case` 列名 | `camelCase` 字段名 |
| NUMERIC（PG 用字符串表示） | `number`（`Number()` 显式转） |
| DATE | `'YYYY-MM-DD'` 字符串 |
| TIMESTAMPTZ | ISO 8601 字符串 |
| TEXT[] | `string[]` |
| JSONB | 原样返回（**未类型化** —— 这是漂移多发区） |

例外（仍用 snake_case 或保留 DB 形状）：路由里手写返回时偶有遗漏；详见各域。

---

## 1 · 身份 / 认证 / Session

> 状态：**全栈对齐** ✓

### DB

[V002__identity_org.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

- `users`: `id, display_name, email, avatar_url, phone, legacy_account, legacy_password_hash, status, last_login_at, ...`
- `user_sessions`: `id, user_id, token_hash, auth_method, client_type, active_store_id, ...`
- `user_roles`: `user_id, system_role`
- `user_stores`: `user_id, store_id, is_primary, ...`
- `user_feishu_identities`: 飞书 OAuth 映射

### Service

[auth.service.ts](../apps/api/src/services/auth.service.ts) + [portal.service.ts](../apps/api/src/services/portal.service.ts)

```
display_name      → name
avatar_url        → avatarUrl
is_primary        → isPrimary
is_project_store  → isProjectStore
store_code        → code
store_name        → name
active_store_id   → 嵌入 me.currentStore
latitude/longitude (NUMERIC) → number
```

`getMeByToken()` 返回 `MeResponse = { user?, currentStore?, stores[], modules[], feishuLinked, notice? }`。

### Route → 前端

| 端点 | 前端消费 |
|---|---|
| `GET /auth/me` | `authApi.me()` → 缓存在 `['auth', 'me']`（[lib/auth.ts](../apps/web/src/lib/auth.ts)） |
| `POST /auth/login` | `useLogin()` → 成功后 invalidate `['auth', 'me']` |
| `POST /auth/logout` | `useLogout()` → invalidate `['auth', 'me']` + `['portal', 'stores']` |

前端 TS 类型在 [packages/shared/src/index.ts](../packages/shared/src/index.ts) 的 `CurrentUser`, `MeResponse`, `StoreRef`，**字段名 100% 对齐**。

---

## 2 · 门户 (Portal)

> 状态：**全栈对齐** ✓

### DB

复用 `users` / `user_stores` / `stores` / `user_roles`。

### Service

[portal.service.ts](../apps/api/src/services/portal.service.ts)

- `listModulesForRoles(roles)` → `{ modules: [{ key, label, enabled, disabledReason? }] }`
- `listStoresForUser(userId, isSuperAdmin)` → `{ stores: StoreRef[], total }`
  - super_admin 走全表，非超管走 `user_stores` join
  - 注释明示：`latitude/longitude` 不做字符串拼接，原值返回（数字）
- `switchActiveStore(userId, sessionToken, storeId, isSuperAdmin)` → `{ currentStore: StoreRef }`
  - 更新 `user_sessions.active_store_id`
  - **session 没选店时业务接口返 409 NO_STORE_SELECTED**

### 前端

- `portalApi.modules()` / `portalApi.stores()` / `portalApi.switchStore({storeId})` 全部在 [lib/api-client.ts](../apps/web/src/lib/api-client.ts)
- 切店后 `useSwitchStore()` invalidate `['auth', 'me']`，所有带 `storeId` 的 queryKey 自动失效重拉（详见 [state-management.md § 1](./state-management.md#1-认证--session-state)）

---

## 3 · 主数据 (Master / HQ)

> 状态：**全栈对齐** ✓（2026-06-14 修复完毕）

### DB

[V004__hq_master_data.sql](../apps/api/src/db/migrations/V004__hq_master_data.sql)

- `hq_categories`: `id, parent_id, level (0-3), scene, category_code, category_name, ...`
- `hq_products`: `id, sku_code, product_name, brand, spec, unit, series, shelf_life_days, length_mm, width_mm, height_mm, category_id, suggested_retail_price, official_image_url, ...`
- `hq_benchmark_skus`: `id, product_id, sku_code, segment ('core'|'innovation'), reason, ...`
- `stores`: `id, store_code, store_name, ownership, province, city, district, address, latitude, longitude, opened_at, is_project_store, status, ...`

### Service

[hq.service.ts](../apps/api/src/services/hq.service.ts)

**`getCategoryTree()`**：平表自下而上构 4 级树，`children?: CategoryNode[]` 嵌套。

**`listProducts()` 返回的 ProductRow**：

```ts
{ id, skuCode, productName, brand, spec, unit, series, shelfLifeDays,
  lengthMm, widthMm, heightMm,                          // 平铺三维（mm）
  categoryId, categoryPath, scene,                       // categoryPath/scene 由 SQL 函数算
  isNewProduct, isPrivateLabel,                          // 总部标签
  wholesalePrice, suggestedRetailPrice, introducedAt, status }
```

字段名 / 形状和 [packages/shared/src/index.ts:177-199](../packages/shared/src/index.ts) 的 `ProductRow` **完全一致**；OpenAPI 也一致。

### 路由 → 前端

| 端点 | 前端 |
|---|---|
| `GET /hq/categories` | 后端 `{ tree }` → 前端 `useStores()` 等用 |
| `GET /hq/products` | 后端 `{ products }` → 前端 `masterApi.listStores()` / 海报选品 grid |

### 已修：重构后的字段补全（2026-06-14）

重构期间后端 `listProducts()` 投影暂时瘦身（丢了 `productName`、`isNewProduct`、`isPrivateLabel`、`wholesalePrice`、`introducedAt`、`status`，且把尺寸嵌套成 `dimensions:{}`），与 OpenAPI / shared / 前端消费方都不一致。本轮把 `hq.service.ts` 的 SQL SELECT 和投影补回完整 11 个字段，回到 OpenAPI 设计形态。

同时连带修复 `store-skus.service.ts`：把 `name` 字段统一改回 `productName`，**自动修好** 海报销量跟踪 `SalesTrackingView.tsx:48` 静默拿 undefined 的 bug（它本来读的就是 `s.productName`）。

---

## 4 · 货盘 (Shelves / Scenes)

> 状态：**全栈对齐** ✓

### DB

[V006__store_state.sql](../apps/api/src/db/migrations/V006__store_state.sql) + [V008__store_actions.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 表 | 用途 |
|---|---|
| `store_scene_state` | scene 工作流的 in-progress 状态：`status, photos (JSONB), detection_data, virtual_*, env_*, draft (JSONB)` |
| `store_scene_shelves` | 货架配置：`group_index, shelf_type, width_cm, layer_count, categories[]` |
| `store_scene_adjustments` | 调整记录 + items JSONB |
| `store_assortment_changes` | 单 SKU 调整明细 |
| `store_scene_remakes` | 重做计数 |
| `store_sku_corrections` | 误检 / 漏检的纠错反馈 |
| `store_scene_virtual_history` | 虚拟货架历史图 |
| `store_survey_questions` + `store_survey_answers` | 调研问卷 |

### Service

[scene.service.ts](../apps/api/src/services/scene.service.ts) + [store-skus.service.ts](../apps/api/src/services/store-skus.service.ts) + [surveys.service.ts](../apps/api/src/services/surveys.service.ts)

主要类型：

**`SceneOverview`** —— `shelf_configured → shelfConfigured`，`qa_done → qaDone`，`adjustment_count → adjustmentCount`，`has_draft → hasDraft`，`draft_updated_at → draftUpdatedAt`，运行时算 `lastSalesDeltaPercent`。

**`SceneRuntime`** —— 标准 snake → camel；`photos` JSONB 原样返回。

写入路径已经在 [scenes.routes.ts:167](../apps/api/src/routes/scenes.routes.ts) 把上传的 URL 一律 wrap 成 `{ url }` 后再 merge 进 runtime，所以 DB 里实际形状就是 `Array<{url}>`，和前端类型对齐。

**`StoreSkuRow`** —— 含 `salesAmountChange30d` / `salesQtyChange30d` 同比百分比（运行时算）。

### 前端

[apps/web/src/features/shelves/api.ts](../apps/web/src/features/shelves/api.ts) 本地定义类型，绕开 shared package。FlowPage / QAPage / SetupPage 等场景页全部消费。


---

## 5 · 价盘 (Prices)

> 状态：**全栈对齐** ✓

### DB

[V006__store_state.sql](../apps/api/src/db/migrations/V006__store_state.sql) + [V008__store_actions.sql](../apps/api/src/db/migrations/V008__store_actions.sql) + [V010__views.sql](../apps/api/src/db/migrations/V010__views.sql)

| 表 / 视图 | 用途 |
|---|---|
| `store_sku_snapshots` | 周期性价格 + 销量快照 |
| `store_price_changes` | 调价事件流（含 `source`, `ai_advice`, `note`） |
| `v_store_product_curve` | 视图：合并最新快照（manual 优先 erp_sync） |

### Service

[prices.service.ts](../apps/api/src/services/prices.service.ts)

`getPriceCurve()`：从 snapshots + price_changes 两个源拼出 `PriceCurvePoint[]`，每个点带 `source: 'snapshot' | 'change'` 区分来源，`priceChangeId` 仅 change 行有。

```
retail_price (NUMERIC string) → retailPrice (number, Number() 转)
sales_amount_30d → salesAmount30d (number)
gross_margin_30d → grossMargin30d (number)
snapshot_date (DATE) → snapshotDate ('YYYY-MM-DD')
```

### 前端

- `pricesApi.curve()` → shared 类型 `PriceCurveResponse`
- `pricesApi.changes()` → `ListPriceChangesResponse`
- `pricesApi.adjust()` → `SubmitPriceChangeRequest` / `SubmitPriceChangeResponse`

[packages/shared/src/index.ts:229-277](../packages/shared/src/index.ts) 类型与服务层 1:1 对齐。

---

## 6 · 促销 (Promotions)

> 状态：**全栈对齐** ✓

### DB

[V005__hq_promotions.sql](../apps/api/src/db/migrations/V005__hq_promotions.sql)

- `hq_promo_batches`: 上传批次 metadata
- `hq_promo_batch_items`: 行级商品 + 最佳价 / 选项 / 有效期
- `hq_promo_mix_groups`: 组合优惠组
- `hq_promo_sku_texts`: 文案

### Service

[promotions.service.ts](../apps/api/src/services/promotions.service.ts)

关键字段：`batch_id → uploadId`（**注意**：前端字段叫 `uploadId` 而不是 `batchId`），其余 snake → camel。

### 前端

`promotionsApi.*` + shared 类型 `ActivePromotionsResponse / PromotionUpload / ProductPromotion / PromotionGroupRow`。**全部对齐**。

---

## 7 · 海报 (Posters)

> 状态：**全栈对齐** ✓（但有 deprecated 残留，见末尾）

### DB

[V009__store_posters.sql](../apps/api/src/db/migrations/V009__store_posters.sql)

| 表 | 用途 |
|---|---|
| `store_poster_tasks` | 用户提交的批次任务（mode + template + copy） |
| `store_poster_task_products` | 任务关联的商品 |
| `store_poster_generations` | 每次生成尝试（worker claim、AI 结果、采纳计数） |
| `store_poster_assets` | 背景 / 商品照素材库 |

视图 `v_poster_product_sales`：销量影响指标。

### Service

[posters.service.ts](../apps/api/src/services/posters.service.ts)

`PosterTask`, `PosterGeneration`, `PosterAsset`, `PosterSalesItem` —— 全部 snake → camel，`PosterMode` / `PosterTemplate` / `PosterGenerationStatus` 枚举原样保留。

### 前端

`postersApi.*` 全套（createTasks / listTasks / getTask / adopt / gallery / listAssets / salesTracking / uploadAsset / deleteAsset），shared 类型 [packages/shared/src/index.ts](../packages/shared/src/index.ts)。

> 2026-06-14：已删 deprecated 的 `postersApi.generate/list`、`usePosters/useGeneratePoster` 以及 shared 中的 `PosterGenerateRequest/Response`、`PosterRecord`、`PosterListResponse`。

---

## 8 · 竞品 (Competitors)

> 状态：**全栈对齐** ✓

### DB

[V007__store_insight.sql](../apps/api/src/db/migrations/V007__store_insight.sql)

- `store_competitors`: 竞品门店登记
- `store_competitor_products`: 竞品的 SKU + 可选映射到 `hq_products`
- `store_competitor_price_snapshots`: 价格采集（含照片）
- `v_active_competitor_price`: 最新有效价视图

### Service

[competitors.service.ts](../apps/api/src/services/competitors.service.ts)

`competitor_name → name`，`distance_m → distanceM`，`external_sku → externalSku`，三个 `rowToXxx()` helper 统一做转换。

### 前端

`competitorsApi.*` —— 端点列在 [api-contracts.md § 9](./api-contracts.md#9-竞品-competitors)；类型未集中在 shared，多数页面内定义。

---

## 9 · 洞察 (Insights)

> 状态：**全栈对齐** ✓

### DB

复用 [V007__store_insight.sql](../apps/api/src/db/migrations/V007__store_insight.sql)：

- `store_insights`: 单店一行的环境信息 + AI 报告 markdown
- `store_survey_questions` + `store_survey_answers`: 调研问卷

### Service / Route

[insights.routes.ts](../apps/api/src/routes/insights.routes.ts) + [surveys.service.ts](../apps/api/src/services/surveys.service.ts) + [ai-shelves.service.ts](../apps/api/src/services/ai-shelves.service.ts)（Dify 调用）

字段：`main_demographic → mainDemographic`，`crowd_source_analysis → crowdSourceAnalysis`，`report_markdown → reportMarkdown` 等。

### 前端

主要在货盘的 QA 页消费（survey 部分）和（未来的）洞察页。

---

## 10 · 管理 (Admin)

> 状态：**全栈对齐** ✓

### DB

[V003__sys_crosscutting.sql](../apps/api/src/db/migrations/V003__sys_crosscutting.sql)（审计 + 使用 session + 设置）+ [V002__identity_org.sql](../apps/api/src/db/migrations/V002__identity_org.sql)（账号）。

- `sys_audit_events`: 全局审计（含 AI 调用字段 `ai_*`）
- `sys_usage_sessions`: 使用 session（心跳）
- `sys_settings`: KV 配置（如 image-model）

### Service

[admin-stats.service.ts](../apps/api/src/services/admin-stats.service.ts) + [admin-accounts.service.ts](../apps/api/src/services/admin-accounts.service.ts)

`LoginEventRow`, `AuditEventRow` —— 全字段 snake → camel；时间戳 ISO。

### 前端

admin 模块 SPA 在 [routes/admin.index.tsx](../apps/web/src/routes/admin.index.tsx)。

---

## 全局漂移结论

### 已修（2026-06-14）

| # | 位置 | 修复 |
|---|---|---|
| 1 | `/hq/products` ProductRow 字段 | hq.service.ts 补全 SELECT，投影改成 `productName` + 平铺尺寸 + 5 个总部标签字段；和 shared / OpenAPI 三方对齐 |
| 2 | `/store/skus` StoreSkuRow.name 字段名 | store-skus.service.ts 把 `name` 改成 `productName`；自动修好 [SalesTrackingView.tsx:48](../apps/web/src/components/posters/SalesTrackingView.tsx) 静默拿 undefined 的 bug |
| 3 | `postersApi.generate/list` 残留 | 连同 `usePosters/useGeneratePoster` hook + shared 中 `PosterGenerateRequest/Response/PosterRecord/PosterListResponse` 一起删 |

### 仍存在的弱点（不是 bug 但要警惕）

| # | 位置 | 说明 |
|---|---|---|
| A | `store-skus.service.ts` 的 `StoreSkuRow` 实际返回字段 < shared `StoreSkuRow extends ProductRow` 声明 | shared 把 `id / shelfLifeDays / lengthMm/widthMm/heightMm / categoryId / series / isNewProduct / isPrivateLabel / suggestedRetailPrice / introducedAt / status / salesQty90d / salesAmount90d / hasPriceChange / lastDeliveryAt` 都摆在 StoreSkuRow 上，但 service 没返。**前端访问这些字段会拿 undefined**，TS 不报错。修复方向需要再确认：是 service 补全 SELECT，还是 shared StoreSkuRow 不再 extend ProductRow 改成局部声明子集。 |
| B | VirtualShelf 渲染 | `extractVirtualShelf()` 拿到 raw outputs 无 schema，Dify workflow 改字段时静默崩 |

### 全栈对齐（验证过）

- 身份 / 认证 / Session
- 门户
- 主数据（包括 ProductRow 已修复后）
- 货盘 / 场景（photos 不是漂移，本来对齐）
- 价盘
- 促销
- 海报（清理 deprecated 后）
- 竞品
- 洞察
- 管理

---

## 检查方法（给下次重构用）

1. **追字段时反向走**：从前端用到的字段名开始 → grep service 层有没有；再 grep 迁移文件确认 DB 列名；不一致就是漂移。
2. **shared 类型是契约**：如果 [packages/shared/src/index.ts](../packages/shared/src/index.ts) 没覆盖到的端点（如 shelves / competitors 用了局部类型），漂移风险翻倍。
3. **新加列时**：迁移、service interface、service 投影、shared 类型、前端消费 —— **5 处必须一起改**（项目惯例 in CLAUDE memory）。
