# 凑单组前端接入 + hq_promo_sku_texts 死链清理 + mix_groups 表→VIEW 重构

**日期**：2026-06-15
**分支**：chore/refactor-snapshot-2026-06-14（或新切分支）
**关联**：[database-schema.md §4 促销](../../database-schema.md#4--促销-v005) 的两条 ⚠️ 提示

## 1 · 目标

1. **任务 A**：让 `hq_promo_mix_groups` 数据出现在店长 /posters 首页（当前服务端已写已查、API 已返回，但前端 shim 丢弃了），以"组合凑单"卡片形式展示。
2. **任务 A'（结构化重构）**：把 `hq_promo_mix_groups` 从 TABLE 改成 VIEW（直接 GROUP BY `hq_promo_batch_items`），消除"upload 阶段双写 + 漂移风险"。前端零感知。
3. **任务 B**：清理彻底未启用的 `hq_promo_sku_texts` 死链（服务函数 + 路由 + 表 + seed）。

三件事独立，但有依赖关系：A' 必须在 A 的"后端补返回 groups"之前完成（因为 A 中的 service 行为依赖 mix_groups 的查询，VIEW 后行为一致就是简化），B 与 A/A' 独立可单 PR。本期合在一个 spec 里说清楚。

## 2 · 任务 A' · `hq_promo_mix_groups` 表 → VIEW

### 2.0.1 为什么做

- 当前 `hq_promo_mix_groups` 的所有字段（除 `representative_image_url` 始终为 NULL 之外）都可以从 `hq_promo_batch_items` 按 `mix_group_code` GROUP BY 派生出来。
- 当前流程：upload 时分两步写（写 batch_items + 聚合写 mix_groups），代码 ~40 行（[promotions.service.ts:180-222](../../../apps/api/src/services/promotions.service.ts#L180-L222)），且引入"items 改了 groups 没同步"的潜在漂移。
- `representative_image_url` 是唯一非派生字段，但**全表为 NULL**、**上传无写入路径**、**前端无消费**，属于 YAGNI 状态。
- 将 TABLE 换成 VIEW 后：upload 不写、查询不变（service 层 SELECT 一行不动）、前端零感知。

### 2.0.2 设计

**新增迁移 `V020__mix_groups_to_view.sql`：**

```sql
BEGIN;

-- 1. 删旧表（包含历史 dummy 数据；新表/旧 batch 的 mix_group_code 仍在 batch_items 里，VIEW 会重新派生）
DROP TABLE IF EXISTS hq_promo_mix_groups;

-- 2. 建 VIEW，列与原 TABLE 一致（service 层 SELECT 不变）
CREATE VIEW hq_promo_mix_groups AS
SELECT
  md5(batch_id::text || '|' || mix_group_code)::uuid                                  AS id,
  batch_id,
  mix_group_code,
  ((array_agg(category_name) FILTER (WHERE category_name IS NOT NULL))[1]) || ' 系列' AS display_name,
  (array_agg(category_name)  FILTER (WHERE category_name IS NOT NULL))[1]             AS category_name,
  array_agg(sku_code ORDER BY row_index)                                              AS sku_codes,
  COUNT(*)::int                                                                       AS product_count,
  (array_agg(best_label ORDER BY best_saving_percent DESC NULLS LAST))[1]             AS best_label,
  MIN(best_total_price)                                                               AS best_total_price,
  MAX(best_saving_percent)                                                            AS best_saving_percent,
  NULL::text                                                                          AS representative_image_url
FROM hq_promo_batch_items
WHERE mix_group_code IS NOT NULL
GROUP BY batch_id, mix_group_code;

COMMENT ON VIEW hq_promo_mix_groups IS
  '从 hq_promo_batch_items 按 mix_group_code 聚合派生的凑单组视图（V020：从原 TABLE 切换为 VIEW，消除上传期双写漂移风险）';

COMMIT;
```

**id 稳定性**：用 `md5(batch_id || '|' || mix_group_code)::uuid`，PostgreSQL md5 是 32 字符 hex，可直接 cast UUID。同一 (batch, code) 永远得到同一 UUID → React key、`group_id` 稳定，selection 状态不会丢。

**`display_name` NULL 安全**：PostgreSQL 中 `NULL || ' 系列'` 自然返回 NULL，无需额外 COALESCE。

**删 upload 期聚合 INSERT 代码：**
- [promotions.service.ts:180-222](../../../apps/api/src/services/promotions.service.ts#L180-L222) "// 4) 聚合 hq_promo_mix_groups" 整段（包括 `groupCount = groupRes.rows.length;`）删除。
- 改成：`const groupCount = (await client.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM hq_promo_mix_groups WHERE batch_id = $1', [batchId])).rows[0]!.c;`（VIEW 直接 COUNT 派生）
- 后续 line 225 的"回写批次的计数 + warnings"逻辑保持不变（`group_count` 字段还在 batches 表上）。

### 2.0.3 验收

1. `npm run -w apps/api db:reset` 跑通（含 V020）。
2. `docker exec myj-postgres psql -U myj -d myj_dev -c "\d hq_promo_mix_groups"` 显示是 `view`，不是 `table`。
3. 跑 promotions integration test 全绿，特别是 `uploadPromotion` 用例（验证不写 INSERT 也能 GROUP COUNT 出 group_count）。
4. 老 06-05 批次本身就没 mix_group_code，VIEW 返回 0 行，符合预期。
5. 手工 INSERT 一条 batch_items 给个 mix_group_code，VIEW 立刻多一行（验派生实时性）。

### 2.0.4 文档同步

- `docs/database-schema.md` §4 的 `hq_promo_mix_groups` 章节：把表头"### `hq_promo_mix_groups`"改为"### `hq_promo_mix_groups`（VIEW）"，介绍段说明从 V020 起改成派生视图，删除"上传时聚合写入"相关 5 行描述，字段表里"谁写"列对所有派生字段改成"派生自 batch_items 聚合"。

---

## 3 · 任务 A · mix_groups 前端接入

### 3.1 当前断点

- 后端 `listActivePromotions()` 已返回 `{ upload, products, groups }`，`groups` 来自 `hq_promo_mix_groups`。
- 后端 `recommendForUser()` 只返回 `{ upload, products: sorted }` —— **groups 在 recommend 端点被丢弃**，需要补。
- 前端 shim [`apps/web/src/lib/promotions.functions.ts`](../../../apps/web/src/lib/promotions.functions.ts) `getPersonalizedPromotions()` 解 API 响应时只读 `body.products`，groups 完全没接。
- 前端 `GroupCard` 组件 [Home.tsx:207](../../../apps/web/src/components/posters/screens/Home.tsx#L207) 完整存在，UI 就绪，等数据。

### 3.2 设计

**后端补返回 groups（recommend 端点）：**
- `apps/api/src/services/promotions.service.ts` `recommendForUser()` 返回 `{ upload, products: sorted, groups: active.groups }`。
- 路由 `/promotions/recommend` 的响应 schema 同步加 `groups: PromotionGroupRow[]`。
- `packages/shared` 里的 `RecommendPromotionsResponse` 类型（若已定义）加 `groups`。

**前端 shim 把 group 折成 CategoryItem：**

借鉴老 [poster 仓库](https://github.com/rollingai-myj/poster/blob/main/src/lib/promotions.functions.ts#L280-L368) 已经验证过的折叠逻辑。新 schema 比老 schema 少了几个字段，全部在 shim 层用成员 SKU 反算（不动 DB）：

| GroupCard 需要的 CategoryItem 字段 | 来源 |
|---|---|
| `sku` | `'group:' + group.id`（前缀防与真 SKU 串） |
| `is_group` | `true` |
| `group_id` | `group.id` |
| `brand_label` / `product_name` | `group.displayName` |
| `category` | `group.categoryName` |
| `unit` | 首成员的 `unit`（从 products[] 查） |
| `original_price` | `sum(members.originalPrice)`（从 products[] 查） |
| `best_label` | `group.bestLabel` |
| `best_qty` | `group.productCount`（"凑齐 N 件"） |
| `best_total` | `group.bestTotalPrice` |
| `best_effective_price` | `group.bestTotalPrice / group.productCount` |
| `best_saving_percent` | `group.bestSavingPercent` |
| `best_valid_*` | `null`（新 schema 无日期字段；`deriveBest` 默认通过 → 组的"有效"等同"批次还在线"） |
| `all_options` | `null` |
| `group_members` | `group.skuCodes.map(sku => ({sku, productName: products 反查 ?? sku}))` |
| `best_applies_to_skus` | `null`（全员适用） |

**SKU 去重（关键）：**
- 老 repo 的核心做法：被任一 mix_group 收编的 SKU **不再以单品卡身份出现**。
- 实现：`const skusInGroup = new Set(groups.flatMap(g => g.skuCodes));` → 过滤掉 `products` 里 `skusInGroup.has(skuCode)` 的项。
- 不去重的话同一 SKU 会同时出现在组卡和单品卡里 → 视觉重复 + 加入海报选品时重复入选。

**分桶 + 置顶：**
- 单品和组都走 `mapCategoryToGroup(categoryName)` 进同一个 byCategory map。
- 用户选定：组卡置顶在所属分类顶部。
- 实现：`Home.tsx` 的 `pickPerCategory`（line 411-422）加一层 group-first 排序，优先于现有的 `savingPercent` / `effectivePrice` 比较。

### 3.3 文件改动清单

| 文件 | 改动 |
|---|---|
| `apps/api/src/services/promotions.service.ts` | `recommendForUser()` 返回值加 `groups: active.groups` |
| `apps/api/src/routes/promotions.routes.ts` | recommend 路由响应 schema 加 `groups` 字段（如有 zod schema） |
| `packages/shared/src/index.ts` | recommend 响应类型加 `groups`（若 active 类型已有则复用） |
| `apps/web/src/lib/promotions.functions.ts` | shim 加 SKU 去重 + groups → CategoryItem 折叠；调整 byCategory 写入顺序 |
| `apps/web/src/components/posters/screens/Home.tsx` | `pickPerCategory` 加 group-first 排序保护 |

### 3.4 验收

**数据前置**：当前激活的 06-05 批次 1083 条 `mix_group_code` 全部为 NULL（上传的 Excel 没含凑单组），所以 `hq_promo_mix_groups` 在该批次下是空表。光改代码 UI 上看不到任何 GroupCard。为了能可视化验证，**先手工灌一两条测试组数据**：

```sql
-- 测试用：取 06-05 批次里任意 3 个同品类 SKU 拼一个组
INSERT INTO hq_promo_mix_groups
  (batch_id, mix_group_code, display_name, category_name, sku_codes,
   product_count, best_label, best_total_price, best_saving_percent)
VALUES
  ('5d34fd6d-6a82-4c77-ab3a-37594006686a',
   'TEST_MIX_DRINK', '快乐水系列', '饮料',
   ARRAY['15041289','08079259','15029827'],  -- 替换成实际 06-05 批次里同品类的真 SKU
   3, '任选 3 件特价', 29.9, 35.0);
```
验收后清掉：`DELETE FROM hq_promo_mix_groups WHERE mix_group_code = 'TEST_MIX_DRINK';`

**验收清单：**
1. 后端 `GET /api/v1/promotions/recommend` 响应体含 `groups` 数组（非空）。
2. /posters 首页"饮料"分类顶部出现 GroupCard：2×2 缩略图 + "可混搭 · 3 款" + `-35%`。
3. 测试组的 3 个成员 SKU 不再单独出现在"饮料"分类的单品卡里。
4. 点击组卡 → 进入选品队列（顶部计数 +1）；切换到其他屏后再回来选中态保留。
5. 关掉"今日有效"开关组卡仍在（组无日期 → 默认有效）。
6. 没有测试数据时（删完 TEST_MIX_DRINK 后），分类内单品卡数量恢复，不报错、不闪烁。

### 3.5 已知 trade-off

- **组没有日期 → 默认有效**：等于"组的有效性 = 批次是否激活"。后续若需要更精确的"今日有效"语义，需要在 DB 层补 `valid_from / valid_to / valid_dates` 列。本期 YAGNI。
- **`original_price` 算的是成员原价之和**：和老 repo 上传时点的"组级原价快照"语义一致，但万一未来主数据 product 价格变了，会出现重算 vs 快照不一致。本期不打算引入快照列，因为现 `hq_promo_batch_items` 的 original_price 已经是快照。

## 4 · 任务 B · hq_promo_sku_texts 死链清理

### 4.1 现状

- 服务函数 `listScenePromoTexts()` 在 [scene.service.ts:564](../../../apps/api/src/services/scene.service.ts#L564)。
- 路由 `GET /api/v1/scenes/:scene/promo-texts` 在 [scenes.routes.ts:451](../../../apps/api/src/routes/scenes.routes.ts#L451)。
- 前端 0 调用方（grep `promo-texts` / `promoText` / `scenePromoTexts` 在 `apps/web/src/features/shelves/` 下均无命中）。
- 0 写接口（INSERT/UPDATE/DELETE 在服务层、路由层均不存在）。
- 仅 [dev-seed.sql:1547](../../../apps/api/src/db/seeds/dev-seed.sql#L1547) 灌种子数据存活。

### 4.2 改动清单

| 文件 | 改动 |
|---|---|
| `apps/api/src/services/scene.service.ts` | 删 `listScenePromoTexts` 函数（line 562-591） |
| `apps/api/src/routes/scenes.routes.ts` | 删 `/scenes/:scene/promo-texts` 路由（line 449-457）+ import |
| `apps/api/src/db/migrations/V021__drop_hq_promo_sku_texts.sql` **新增** | `DROP TABLE IF EXISTS hq_promo_sku_texts;`（编号从 V020 顺延到 V021，因为 V020 被 §2 任务 A' 占了 mix_groups TABLE→VIEW） |
| `apps/api/src/db/seeds/dev-seed.sql` | 删 `hq_promo_sku_texts` 的 COPY 段 |
| `docs/database-schema.md` | 删 §4 下 `hq_promo_sku_texts` 章节 + 更新 §4 顶部"使用情况速查" + 更新业务域索引行 |
| `docs/api-contracts.md` | 若有提到该端点，同步删除 |

### 4.3 验收

1. `npm run db:reset` 跑通（含 V020 + V021 迁移）。
2. `npm run -w apps/api typecheck` 全绿。
3. `npm run -w apps/api test` 全绿。
4. 选品页（/shelves）正常打开、各场景能进、不报 404（确认没有隐藏调用）。

### 4.4 回滚

- 任务 B 涉及 DROP TABLE，强烈建议合入前执行 `npm run db:reset` 验证。
- 万一未来要恢复，老结构在 [V005__hq_promotions.sql:83-112](../../../apps/api/src/db/migrations/V005__hq_promotions.sql#L83-L112)，可作为复活模板。

## 5 · 实施顺序

1. **任务 A' V020 迁移**（mix_groups TABLE → VIEW）+ **删 upload 期聚合 INSERT 代码** + db:reset 跑通 + promotions integration test 全绿。
2. **任务 A 后端**（service recommend 补 groups + shared types）—— 在 A' 基础上加返回字段。
3. **任务 A 前端**（shim 折叠 + Home.tsx 排序保护）—— 依赖 #2。
4. **任务 A 端到端验收** —— 浏览器打开 /posters + 手工 SQL 灌 TEST_MIX_DRINK 验组卡出现 + 成员去重生效。
5. **任务 B 代码**（删 service + route + import）。
6. **任务 B V021 迁移**（DROP hq_promo_sku_texts）+ 清 seed + db:reset 验证。
7. **任务 B 文档**（database-schema.md + api-contracts.md）。
8. 单 commit 或拆 PR 按用户偏好定（建议：A'+A 一组、B 一组）。

## 6 · 范围之外（不做）

- 不给 `hq_promo_mix_groups` 加日期 / 原价 / 单位列（本期通过 shim 反算）。
- 不引入"组合凑单"独立伪分类（用户已定：置顶到所属分类）。
- 不调整 GroupCard 视觉（直接复用现有 UI）。
- 不重做 promo Excel 上传流程。
- **不做"后台"模块 / CSV 上传通路**：用户已确认作为独立 spec 单独 brainstorm。本期 mix_groups 验收沿用 §3.4 的手工 SQL 灌 TEST_MIX_DRINK；后台模块上线后再用真 CSV 验证补一遍。当前 API `POST /promotions/batches:upload` 收的是已解析 JSON，不含 xlsx/csv 解析。
