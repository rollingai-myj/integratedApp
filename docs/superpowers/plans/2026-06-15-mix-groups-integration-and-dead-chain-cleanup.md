# 凑单组前端接入 + mix_groups TABLE→VIEW + hq_promo_sku_texts 死链清理 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `hq_promo_mix_groups` 数据展示在店长 /posters 首页（组卡置顶到所属分类），同时把 mix_groups 从 TABLE 改成 VIEW 消除上传期双写漂移，再彻底清掉 `hq_promo_sku_texts` 死链（代码 + 表 + seed + 文档）。

**Architecture:**
- **A'（结构化）**：`hq_promo_mix_groups` 从 TABLE 改为 VIEW，所有字段直接从 `hq_promo_batch_items` GROUP BY 派生；upload 服务删掉 ~40 行聚合 INSERT，改成 `SELECT COUNT(*)` 取 group_count。
- **A（前端接入）**：后端 `/promotions/recommend` 补返回 `groups`；前端 shim 把 groups 折成 `is_group=true` 的 CategoryItem（组卡与单品卡独立展示）；Home.tsx 排序加 group-first 保护。
- **B（死链清理）**：服务 + 路由 + 表 + seed + 文档一并删除，V021 迁移落地。

**Tech Stack:** Express + zod + node-postgres（后端）、React + TanStack Router + Vite（前端）、vitest（API 测试）。前端无单测框架，验收用浏览器 + 手工 SQL 灌 mix_group 测试数据。

**Spec reference:** [docs/superpowers/specs/2026-06-15-mix-groups-integration-and-dead-chain-cleanup-design.md](../specs/2026-06-15-mix-groups-integration-and-dead-chain-cleanup-design.md)

---

## 文件改动清单

**任务 A' · TABLE → VIEW：**
- Create `apps/api/src/db/migrations/V020__mix_groups_to_view.sql` — DROP TABLE + CREATE VIEW
- Modify `apps/api/src/services/promotions.service.ts:180-222` — 删聚合 INSERT，改 COUNT 取 group_count
- Modify `docs/database-schema.md` — mix_groups 节标 (VIEW) 并更新"谁写"列

**任务 A · mix_groups 前端接入：**
- Modify `packages/shared/src/index.ts:497-500` — `RecommendPromotionsResponse` 加 `groups`
- Modify `apps/api/src/services/promotions.service.ts:441-472` — `recommendForUser` 返回 `groups`
- Modify `apps/api/src/routes/promotions.integration.test.ts` — 验 recommend 返回 groups
- Modify `apps/web/src/lib/promotions.functions.ts` — 读 body.groups + 折叠成 CategoryItem（组卡与单品卡独立展示）
- Modify `apps/web/src/components/posters/screens/Home.tsx:411-422` — group-first 排序

**任务 B · 死链清理：**
- Modify `apps/api/src/services/scene.service.ts:562-591` — 删 `listScenePromoTexts`
- Modify `apps/api/src/routes/scenes.routes.ts:23, 449-457` — 删路由 + import
- Create `apps/api/src/db/migrations/V021__drop_hq_promo_sku_texts.sql` — DROP TABLE
- Modify `apps/api/src/db/seeds/dev-seed.sql:1547-2444` — 删 COPY 段
- Modify `docs/database-schema.md` — 删 sku_texts 章节 + §4 速查 + 业务域索引
- Modify `docs/api-contracts.md:165, 353` — 删 promo-texts 引用

---

## Task 1: 新增 V020 mix_groups TABLE → VIEW 迁移

**Files:**
- Create: `apps/api/src/db/migrations/V020__mix_groups_to_view.sql`

- [ ] **Step 1.1: 写迁移文件**

Run:
```bash
cat > apps/api/src/db/migrations/V020__mix_groups_to_view.sql <<'SQL'
-- V020: hq_promo_mix_groups 从 TABLE 改为 VIEW
--
-- 原 TABLE 的所有字段都能从 hq_promo_batch_items 按 mix_group_code GROUP BY 派生，
-- 唯一非派生字段 representative_image_url 始终为 NULL、无写入路径、无消费方（YAGNI）。
-- 改成 VIEW 后：
--   - upload 服务删掉 ~40 行聚合 INSERT 代码，单一事实源
--   - service 层 SELECT 一行不变，前端零感知
--   - 旧 TABLE 内的历史 dummy 数据（2 t-first 批次各 1 行）会随 DROP 一并清掉
--     —— 这些是测试占位，不影响业务

BEGIN;

DROP TABLE IF EXISTS hq_promo_mix_groups;

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
SQL
```

- [ ] **Step 1.2: 验证文件**

Run: `cat apps/api/src/db/migrations/V020__mix_groups_to_view.sql`
Expected: 完整 SQL 内容，含 DROP TABLE + CREATE VIEW + COMMENT。

---

## Task 2: 简化 upload 服务 — 删掉 mix_groups 聚合 INSERT

**Files:**
- Modify: `apps/api/src/services/promotions.service.ts:180-222`

- [ ] **Step 2.1: 找到聚合 INSERT 块**

打开 [apps/api/src/services/promotions.service.ts](apps/api/src/services/promotions.service.ts)，定位 "// 4) 聚合 hq_promo_mix_groups（按 mix_group_code）" 注释开始的整段（约 line 180-222）。

- [ ] **Step 2.2: 替换为 COUNT 查询**

把整段（从 `// 4) 聚合 hq_promo_mix_groups...` 到 `const groupCount = groupRes.rows.length;`）替换成：
```ts
    // 4) 从 VIEW hq_promo_mix_groups（V020 起为派生视图）直接 COUNT 出本批的凑单组数
    const groupCountRes = await client.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM hq_promo_mix_groups WHERE batch_id = $1`,
      [batchId],
    );
    const groupCount = groupCountRes.rows[0]!.c;
```

- [ ] **Step 2.3: typecheck**

Run: `npm run -w apps/api typecheck`
Expected: PASS（删的只是局部变量 + INSERT 调用，无外部依赖）

- [ ] **Step 2.4: 跑 db:reset 把 V020 应用上**

Run: `npm run -w apps/api db:reset`
Expected: 跑通，全 19 个迁移依次应用。

- [ ] **Step 2.5: 确认 VIEW 而非 TABLE**

Run: `docker exec myj-postgres psql -U myj -d myj_dev -c "SELECT table_type FROM information_schema.tables WHERE table_name='hq_promo_mix_groups';"`
Expected: `VIEW`

- [ ] **Step 2.6: 跑 promotions integration test 验 uploadPromotion 路径**

Run: `INTEGRATION_DB=1 DATABASE_URL=postgresql://myj:myj@localhost:5432/myj_test npm run -w apps/api test -- promotions.integration.test.ts`
Expected: 全部通过 —— 特别是 upload 测试不再走老 INSERT 路径，但 group_count 字段在 batches 表上仍正确填充。

- [ ] **Step 2.7: Commit V020 + service 简化**

```bash
git add apps/api/src/db/migrations/V020__mix_groups_to_view.sql apps/api/src/services/promotions.service.ts
git commit -m "refactor(promo): mix_groups TABLE→VIEW + 删 upload 聚合 INSERT (V020)"
```

---

## Task 3: 更新 database-schema.md — mix_groups 节标记 (VIEW)

**Files:**
- Modify: `docs/database-schema.md`

- [ ] **Step 3.1: 改节标题**

打开 [docs/database-schema.md](docs/database-schema.md)，找到 `### \`hq_promo_mix_groups\``，改成 `### \`hq_promo_mix_groups\`（VIEW · 从 V020 起）`。

- [ ] **Step 3.2: 改介绍段**

把节顶的描述段改成：
```md
> 凑单组卡片的数据源。**V020 起从 TABLE 改为 VIEW**：所有字段直接从 [`hq_promo_batch_items`](#hq_promo_batch_items) 按 `mix_group_code` GROUP BY 实时派生，不再有独立写入路径。原表的 `representative_image_url` 字段在 VIEW 里恒为 NULL（YAGNI；前端未消费）。[V020.sql](../apps/api/src/db/migrations/V020__mix_groups_to_view.sql)
>
> ✅ **前端已接入**（V020 同期）：店长 /posters 首页通过 [apps/web/src/lib/promotions.functions.ts](../apps/web/src/lib/promotions.functions.ts) shim 把 groups 折成 CategoryItem，按 `category_name` 分桶后置顶在所属分类。**组卡与单品卡独立展示**：两种促销玩法（凑单组合价 vs 单品最优档）均可见。
```
（原本"⚠️ 当前前端未消费"块完全替换掉。）

- [ ] **Step 3.3: 字段表里"谁写"列**

把字段表里所有派生字段的"谁写"列改成"派生自 batch_items 聚合"（除 id 改成 `md5(batch_id || '|' || mix_group_code)::uuid` 生成）。`representative_image_url` 改成"始终 NULL（VIEW 占位列，无写入路径）"。

- [ ] **Step 3.4: §4 顶部速查更新**

打开 §4 节，把原本三表盘点改写为：
```md
> **使用情况速查**：`hq_promo_batches` / `hq_promo_batch_items` 是海报模块核心数据源；`hq_promo_mix_groups` 从 V020 起改为派生视图（VIEW），前端 shim 已折成"凑单组"卡片置顶在所属分类。原 `hq_promo_sku_texts` 在 V021 已删（端到端从未启用）。
```

- [ ] **Step 3.5: Commit**

```bash
git add docs/database-schema.md
git commit -m "docs(db): mix_groups 节标 VIEW + 反映 V020 重构"
```

---

## Task 4: 共享类型 RecommendPromotionsResponse 加 groups

**Files:**
- Modify: `packages/shared/src/index.ts:497-500`

- [ ] **Step 4.1: 编辑接口**

打开 [packages/shared/src/index.ts:497-500](packages/shared/src/index.ts#L497-L500)：
```ts
export interface RecommendPromotionsResponse {
  upload: PromotionUpload | null;
  products: ProductPromotion[];
}
```
改成：
```ts
export interface RecommendPromotionsResponse {
  upload: PromotionUpload | null;
  products: ProductPromotion[];
  groups: PromotionGroupRow[];
}
```

- [ ] **Step 4.2: typecheck**

Run: `npm run -w apps/api typecheck`
Expected: PASS

- [ ] **Step 4.3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): RecommendPromotionsResponse 加 groups 字段"
```

---

## Task 5: 后端 recommend 返回 groups

**Files:**
- Modify: `apps/api/src/services/promotions.service.ts:441-472`

- [ ] **Step 5.1: 编辑 recommendForUser 签名 + 返回值**

打开 [apps/api/src/services/promotions.service.ts:441-472](apps/api/src/services/promotions.service.ts#L441-L472)。当前：
```ts
export async function recommendForUser(userId: string): Promise<{
  upload: PromotionUpload | null;
  products: ProductPromotion[];
}> {
  const active = await listActivePromotions();
  if (!active.upload) return { upload: null, products: [] };
  // …省略中间排序逻辑…
  return { upload: active.upload, products: sorted };
}
```
改成：
```ts
export async function recommendForUser(userId: string): Promise<{
  upload: PromotionUpload | null;
  products: ProductPromotion[];
  groups: PromotionGroupRow[];
}> {
  const active = await listActivePromotions();
  if (!active.upload) return { upload: null, products: [], groups: [] };
  // …省略中间排序逻辑…
  return { upload: active.upload, products: sorted, groups: active.groups };
}
```

- [ ] **Step 5.2: typecheck**

Run: `npm run -w apps/api typecheck`
Expected: PASS

- [ ] **Step 5.3: Commit**

```bash
git add apps/api/src/services/promotions.service.ts
git commit -m "feat(promotions): recommend 端点补返回 groups"
```

---

## Task 6: 集成测试验证 recommend 含 groups

**Files:**
- Modify: `apps/api/src/routes/promotions.integration.test.ts`

- [ ] **Step 6.1: 找到 recommend 测试用例**

Run: `grep -n "/promotions/recommend" apps/api/src/routes/promotions.integration.test.ts`
预期能找到约 line 186 附近的用例。

- [ ] **Step 6.2: 加 groups 断言**

在调用 `/promotions/recommend` 的测试用例里追加：
```ts
expect(r.body.groups).toBeDefined();
expect(Array.isArray(r.body.groups)).toBe(true);

// recommend 透传 active 的 groups（V020 后 VIEW 派生，含 mix_group_code 的 batch_items 即贡献一组）
const active = await call('GET', '/api/v1/promotions/active', { ctx: opsCtx });
expect(r.body.groups.length).toBe(active.body.groups.length);
```

- [ ] **Step 6.3: 跑测试**

Run: `INTEGRATION_DB=1 DATABASE_URL=postgresql://myj:myj@localhost:5432/myj_test npm run -w apps/api test -- promotions.integration.test.ts`
Expected: PASS

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/routes/promotions.integration.test.ts
git commit -m "test(promotions): 验证 recommend 端点返回 groups 字段"
```

---

## Task 7: 前端 shim 折叠 groups 成 CategoryItem

**Files:**
- Modify: `apps/web/src/lib/promotions.functions.ts:107-151`

- [ ] **Step 7.1: 读懂当前 getPersonalizedPromotions 结构**

阅读 [apps/web/src/lib/promotions.functions.ts:107-151](apps/web/src/lib/promotions.functions.ts#L107-L151)。当前只读 `body.products`，进 byCategory。任务是：(a) 同时读 `body.groups`；(b) 把 group 折成 CategoryItem 加入 byCategory（组卡与单品卡独立展示，两者并存）；(c) groups 项排在 category 列表的最前面。

- [ ] **Step 7.2: import 增 PromotionGroupRow + RecommendPromotionsResponse**

文件顶部 `import type` 块改成：
```ts
import type {
  ActivePromotionsResponse,
  ProductPromotion,
  ProductPromotionDealOption,
  PromotionGroupRow,
  RecommendPromotionsResponse,
} from '@myj/shared';
```

- [ ] **Step 7.3: CategoryItem 接口加 best_applies_to_skus 字段**

文件顶部 `interface CategoryItem` 里现有字段后追加：
```ts
  is_group?: boolean;
  group_id?: string | null;
  brand_label?: string | null;
  group_members?: Array<{ sku: string; productName: string }> | null;
  best_applies_to_skus?: string[] | null;  // 新增
```
（如已有前 4 项则只补 best_applies_to_skus；GroupCard 后续可能用到。）

- [ ] **Step 7.4: 把 const groups 提升为 let，能在 active 兜底分支累加**

在 `let products: ProductPromotion[] = [];` 之后立刻加：
```ts
let groups: PromotionGroupRow[] = [];
```

- [ ] **Step 7.5: recommend 路径类型注解换成 RecommendPromotionsResponse**

原 line 115：
```ts
const body = (await recoRes.json()) as { products?: ProductPromotion[]; upload?: { id: string; fileName: string; createdAt: string } };
```
改成：
```ts
const body = (await recoRes.json()) as RecommendPromotionsResponse;
```
下面取值改成：
```ts
products = body.products ?? [];
groups = body.groups ?? [];
if (body.upload) {
  upload = { id: body.upload.id, filename: body.upload.fileName, created_at: body.upload.createdAt };
}
```

- [ ] **Step 7.6: active 兜底分支也读 groups**

原 line 122-129 active 分支改成：
```ts
if (products.length === 0) {
  const actRes = await fetch(`${BASE}/promotions/active`, { credentials: 'include' });
  if (actRes.ok) {
    const body = (await actRes.json()) as ActivePromotionsResponse;
    products = body.products ?? [];
    groups = body.groups ?? [];
    if (body.upload) {
      upload = { id: body.upload.id, filename: body.upload.fileName, created_at: body.upload.createdAt };
    }
  }
}
```

- [ ] **Step 7.7: 把"按品类分组"代码块替换成新版（group 折叠 + 组卡与单品卡独立展示）**

把原 line 132-144 的 byCategory 构建段整个替换为：
```ts
// SKU → product 反查表（折叠 group 时用）
const skuToProduct = new Map<string, ProductPromotion>();
for (const p of products) skuToProduct.set(p.skuCode, p);

const byCategory = new Map<string, CategoryItem[]>();
const pushTo = (groupName: string, item: CategoryItem) => {
  if (!byCategory.has(groupName)) byCategory.set(groupName, []);
  byCategory.get(groupName)!.push(item);
};

// 1) 先入 groups（让它们排在每个 category 的最前面）
for (const g of groups) {
  const groupName = mapCategoryToGroup(g.categoryName ?? '');
  const members = (g.skuCodes ?? []).map((sku) => skuToProduct.get(sku));
  const firstMember = members.find((m): m is ProductPromotion => m != null);
  const origSum = members.reduce((s, m) => s + (toNum(m?.originalPrice) ?? 0), 0);
  const total = toNum(g.bestTotalPrice);
  const item: CategoryItem = {
    sku: `group:${g.id}`,
    product_name: g.displayName ?? '凑单组',
    unit: firstMember?.unit ?? null,
    original_price: origSum > 0 ? origSum : null,
    category: g.categoryName,
    best_label: g.bestLabel,
    best_qty: g.productCount,
    best_total: total,
    best_effective_price: total != null && g.productCount > 0 ? total / g.productCount : null,
    best_saving_percent: toNum(g.bestSavingPercent),
    display_text: null,
    best_valid_from: null,
    best_valid_to: null,
    best_valid_dates: null,
    all_options: null,
    is_group: true,
    group_id: g.id,
    brand_label: g.displayName,
    group_members: (g.skuCodes ?? []).map((sku) => ({
      sku,
      productName: skuToProduct.get(sku)?.productName ?? sku,
    })),
    best_applies_to_skus: null,
  };
  pushTo(groupName, item);
}

// 2) 再入全部单品（group 卡与单品卡独立展示）
for (const p of products) {
  const item = rowToCategoryItem(p);
  pushTo(mapCategoryToGroup(item.category ?? ''), item);
}

const categories = Array.from(byCategory.entries()).map(([name, items]) => ({
  name,
  items,
}));
```

- [ ] **Step 7.8: 启动 dev，浏览器查看无 TS 报错**

Run: `docker logs myj-web --tail 50 2>&1 | grep -E "error|✓"`
Expected: vite 编译通过，无 TS error。

- [ ] **Step 7.9: build 验证 TS**

Run: `npm run -w apps/web build 2>&1 | grep -E "error TS|✓ built"`
Expected: 无 error。

- [ ] **Step 7.10: Commit**

```bash
git add apps/web/src/lib/promotions.functions.ts
git commit -m "feat(posters): shim 折叠 mix_groups 成 CategoryItem（组卡与单品卡独立展示）"
```

---

## Task 8: Home.tsx pickPerCategory 加 group-first 排序

**Files:**
- Modify: `apps/web/src/components/posters/screens/Home.tsx:411-422`

- [ ] **Step 8.1: 编辑 pickPerCategory**

打开 [apps/web/src/components/posters/screens/Home.tsx:411-422](apps/web/src/components/posters/screens/Home.tsx#L411-L422)，当前：
```ts
const pickPerCategory = (items: CategoryItem[]) => {
  const arr = items.map(it => ({ it, best: bestMap.get(it.sku) ?? null }));
  arr.sort((a, b) => {
    const ap = a.best?.savingPercent ?? -Infinity;
    const bp = b.best?.savingPercent ?? -Infinity;
    if (bp !== ap) return bp - ap;
    const apr = a.best?.effectivePrice ?? -Infinity;
    const bpr = b.best?.effectivePrice ?? -Infinity;
    return bpr - apr;
  });
  return arr.map(x => x.it);
};
```
改成：
```ts
const pickPerCategory = (items: CategoryItem[]) => {
  const arr = items.map(it => ({ it, best: bestMap.get(it.sku) ?? null }));
  arr.sort((a, b) => {
    const ag = a.it.is_group ? 1 : 0;
    const bg = b.it.is_group ? 1 : 0;
    if (bg !== ag) return bg - ag;          // 凑单组永远排前
    const ap = a.best?.savingPercent ?? -Infinity;
    const bp = b.best?.savingPercent ?? -Infinity;
    if (bp !== ap) return bp - ap;
    const apr = a.best?.effectivePrice ?? -Infinity;
    const bpr = b.best?.effectivePrice ?? -Infinity;
    return bpr - apr;
  });
  return arr.map(x => x.it);
};
```

- [ ] **Step 8.2: build 验证 TS**

Run: `npm run -w apps/web build 2>&1 | grep -E "error TS|✓ built"`
Expected: 无 error

- [ ] **Step 8.3: Commit**

```bash
git add apps/web/src/components/posters/screens/Home.tsx
git commit -m "feat(posters): pickPerCategory 加 group-first 排序保护"
```

---

## Task 9: 任务 A' + A 端到端验收

> 注意：现在 mix_groups 是 VIEW，要让它返回行，必须给 batch_items 写 mix_group_code（VIEW 实时派生）。

- [ ] **Step 9.1: 给 06-05 批次的 3 个饮料 SKU 打 TEST_MIX_DRINK 标签**

Run（取 3 个真实 SKU）：
```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "
  SELECT sku_code, product_name, category_name FROM hq_promo_batch_items
  WHERE batch_id='5d34fd6d-6a82-4c77-ab3a-37594006686a' AND category_name LIKE '%饮料%'
  ORDER BY best_saving_percent DESC NULLS LAST LIMIT 5;
"
```
挑 3 个 sku_code，运行（替换 `<SKU1>` 等）：
```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "
  UPDATE hq_promo_batch_items
     SET mix_group_code = 'TEST_MIX_DRINK', updated_at = now()
   WHERE batch_id='5d34fd6d-6a82-4c77-ab3a-37594006686a'
     AND sku_code IN ('<SKU1>','<SKU2>','<SKU3>');
"
```

- [ ] **Step 9.2: 确认 VIEW 即刻派生出 1 行**

Run: `docker exec myj-postgres psql -U myj -d myj_dev -c "SELECT id, mix_group_code, display_name, sku_codes, product_count, best_saving_percent FROM hq_promo_mix_groups;"`
Expected: 1 行，display_name=`饮料 系列`，sku_codes 含 3 个 SKU，best_saving_percent 取 3 条里最大。

- [ ] **Step 9.3: 浏览器打开 /posters 验证 6 项**

打开 http://localhost:8089/posters，逐项确认：
1. F12 Network 看 `/api/v1/promotions/recommend` 响应 body 含 `groups` 数组（应该是 1 元素）。
2. "饮料"分类（或所选品类）顶部出现 GroupCard：2×2 缩略图 + `可混搭 · 3 款` + 顶角折扣率。
3. 测试组的 3 个成员 SKU 在"饮料"分类中**组卡与单品卡独立并存**（两种促销玩法均可见）。
4. 点击组卡 → 顶部计数 +1；离开页面再回来选中态保留。
5. 切换"今日有效"开关，组卡仍在（组无日期 → 默认有效）。
6. 没问题截图保留。

- [ ] **Step 9.4: 清理测试数据**

Run:
```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "
  UPDATE hq_promo_batch_items
     SET mix_group_code = NULL, updated_at = now()
   WHERE mix_group_code = 'TEST_MIX_DRINK';
"
```
确认 VIEW 不再返回：
```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "SELECT COUNT(*) FROM hq_promo_mix_groups;"
```
Expected: 0

刷新 /posters，确认分类内单品卡数量恢复、不报错、不闪烁。

---

## Task 10: 删 listScenePromoTexts 服务

**Files:**
- Modify: `apps/api/src/services/scene.service.ts:562-591`

- [ ] **Step 10.1: 删函数**

打开 [apps/api/src/services/scene.service.ts:562-591](apps/api/src/services/scene.service.ts#L562-L591)。删除从注释行 `// ---- 场景下的促销文案 (虚拟陈列 / 选品页用) ----` 起到函数体闭合 `}` 的整段。

下方相邻的 `export const _internal = { rowToRuntime } as const;` 保留。

- [ ] **Step 10.2: typecheck 期望失败（仍有 import）**

Run: `npm run -w apps/api typecheck 2>&1 | grep "listScenePromoTexts"`
Expected: 报错指向 `apps/api/src/routes/scenes.routes.ts:23` 的 import 未定义。

---

## Task 11: 删 /scenes/:scene/promo-texts 路由

**Files:**
- Modify: `apps/api/src/routes/scenes.routes.ts:23, 449-457`

- [ ] **Step 11.1: 删 import**

打开 [apps/api/src/routes/scenes.routes.ts:23](apps/api/src/routes/scenes.routes.ts#L23)，把 `listScenePromoTexts,` 从 import 列表里删掉。

- [ ] **Step 11.2: 删路由块**

打开 [apps/api/src/routes/scenes.routes.ts:449-457](apps/api/src/routes/scenes.routes.ts#L449-L457)，删除整段：
```ts
// ---- 场景促销文案 --------------------------------------------------------

scenesRouter.get(
  '/scenes/:scene/promo-texts', requireAuth,
  asyncHandler(async (req, res) => {
    const scene = parseScene(req);
    res.json({ texts: await listScenePromoTexts(scene) });
  }),
);
```

- [ ] **Step 11.3: typecheck**

Run: `npm run -w apps/api typecheck`
Expected: PASS

- [ ] **Step 11.4: 跑全量 API 测试**

Run: `npm run -w apps/api test`
Expected: 全部通过。

- [ ] **Step 11.5: Commit**

```bash
git add apps/api/src/services/scene.service.ts apps/api/src/routes/scenes.routes.ts
git commit -m "chore(scenes): 删除未调用的 promo-texts 路由与服务"
```

---

## Task 12: 新增 V021 DROP TABLE 迁移

**Files:**
- Create: `apps/api/src/db/migrations/V021__drop_hq_promo_sku_texts.sql`

- [ ] **Step 12.1: 写迁移文件**

Run:
```bash
cat > apps/api/src/db/migrations/V021__drop_hq_promo_sku_texts.sql <<'SQL'
-- V021: 移除 hq_promo_sku_texts 表
--
-- 该表原计划用于选品页商品旁的促销标语（与海报促销批次独立的体系），
-- 但端到端从未启用：
--   - 后端 listScenePromoTexts / GET /scenes/:scene/promo-texts 已在本期同步删除（前端 0 调用方）
--   - 始终缺写接口（INSERT/UPDATE/DELETE 在服务层 / 路由层均不存在）
--   - 仅 dev-seed.sql 灌种子数据存活
--
-- 等"商品旁标语"产品决策落地后，可参考 V005 中本表的原 DDL 重建。

BEGIN;

DROP TABLE IF EXISTS hq_promo_sku_texts;

COMMIT;
SQL
```

- [ ] **Step 12.2: 验证文件**

Run: `cat apps/api/src/db/migrations/V021__drop_hq_promo_sku_texts.sql`
Expected: 内容正确。

---

## Task 13: 清 seed 文件

**Files:**
- Modify: `apps/api/src/db/seeds/dev-seed.sql`

- [ ] **Step 13.1: 确认 COPY 段范围**

Run: `awk '/^COPY hq_promo_sku_texts/{start=NR} start && /^\\\.$/{print start","NR; exit}' apps/api/src/db/seeds/dev-seed.sql`
Expected: 输出 `<起始行>,<结束行>` 例如 `1547,2444`。如果偏移，下一步用实际行号替换。

- [ ] **Step 13.2: 删 COPY 段**

Run（用上一步的实际行号）：
```bash
sed -i.bak '1547,2444d' apps/api/src/db/seeds/dev-seed.sql && rm apps/api/src/db/seeds/dev-seed.sql.bak
```

- [ ] **Step 13.3: 验证 grep 找不到了**

Run: `grep -nc "hq_promo_sku_texts" apps/api/src/db/seeds/dev-seed.sql`
Expected: `0`

- [ ] **Step 13.4: Commit V021 + seed**

```bash
git add apps/api/src/db/migrations/V021__drop_hq_promo_sku_texts.sql apps/api/src/db/seeds/dev-seed.sql
git commit -m "chore(db): V021 DROP TABLE hq_promo_sku_texts + 清 seed"
```

---

## Task 14: db:reset 验证基线干净

- [ ] **Step 14.1: 重置数据库**

Run: `npm run -w apps/api db:reset`
Expected: 全 20 个迁移依次应用，无报错。

- [ ] **Step 14.2: 确认 hq_promo_sku_texts 已不存在**

Run: `docker exec myj-postgres psql -U myj -d myj_dev -c "SELECT to_regclass('hq_promo_sku_texts');"`
Expected: NULL（表不存在）

- [ ] **Step 14.3: 确认 hq_promo_mix_groups 是 VIEW**

Run: `docker exec myj-postgres psql -U myj -d myj_dev -c "SELECT table_type FROM information_schema.tables WHERE table_name='hq_promo_mix_groups';"`
Expected: `VIEW`

- [ ] **Step 14.4: 跑 db:verify**

Run: `npm run -w apps/api db:verify`
Expected: 全部检查项通过。

---

## Task 15: 更新 docs/database-schema.md（任务 B 部分）

**Files:**
- Modify: `docs/database-schema.md`

- [ ] **Step 15.1: 业务域索引删 hq_promo_sku_texts**

打开 [docs/database-schema.md:42](docs/database-schema.md#L42)。当前：
```
| 促销 | hq_promo_batches, hq_promo_batch_items, hq_promo_mix_groups, hq_promo_sku_texts | promotions |
```
改成：
```
| 促销 | hq_promo_batches, hq_promo_batch_items, hq_promo_mix_groups | promotions |
```

- [ ] **Step 15.2: §4 删 hq_promo_sku_texts 整节**

找到 `### \`hq_promo_sku_texts\`` 标题，删除从该标题起到下一节 `## 5 · 门店现状 (V006)` 之前的整段（保留 `---` 分隔符和 ## 5 标题）。

- [ ] **Step 15.3: Commit**

```bash
git add docs/database-schema.md
git commit -m "docs(db): 移除 hq_promo_sku_texts 章节（V021）"
```

---

## Task 16: 更新 docs/api-contracts.md

**Files:**
- Modify: `docs/api-contracts.md:165, 353`

- [ ] **Step 16.1: 删两处引用**

打开 [docs/api-contracts.md:165](docs/api-contracts.md#L165)，删除该行（表格里的 `GET /scenes/:scene/promo-texts` 一行）。

打开 [docs/api-contracts.md:353](docs/api-contracts.md#L353)，删除 `- GET /scenes/:scene/promo-texts` 这一行。

- [ ] **Step 16.2: 验证清理彻底**

Run: `grep -nE "promo-text|promo_text|promoText|hq_promo_sku_texts|listScenePromoTexts" docs/api-contracts.md docs/database-schema.md`
Expected: 无输出。

- [ ] **Step 16.3: Commit**

```bash
git add docs/api-contracts.md
git commit -m "docs: api-contracts 移除 /scenes/:scene/promo-texts 引用"
```

---

## Task 17: 最终全量验证

- [ ] **Step 17.1: 全量 typecheck**

Run: `npm run -w apps/api typecheck && npm run -w apps/web build 2>&1 | tail -5`
Expected: 双绿，无 TS / vite 错。

- [ ] **Step 17.2: 全量测试**

Run: `npm run -w apps/api test`
Expected: 全部通过（含 Task 6 加的 recommend.groups 断言）。

- [ ] **Step 17.3: 浏览器最后回归**

打开 http://localhost:8089/posters 与 http://localhost:8089/shelves，各点开主流程页面。
Expected：
- /posters 正常显示单品卡；如果手工 UPDATE 过 mix_group_code 但忘清，组卡置顶；清完后恢复纯单品。
- /shelves 各场景能进，不报 404（确认 promo-texts 删除没影响）。

- [ ] **Step 17.4: git log 确认提交链**

Run: `git log --oneline main..HEAD`
Expected：看到 V020 重构、shared types、recommend groups、integration test、shim、Home.tsx 排序、scene 服务删除、V021、seed、文档等清晰提交链。

---

## 收尾

实施完成后：
- 任务 A' + A 可作为一个 PR（mix_groups VIEW 重构 + 前端接入），任务 B 单独 PR（死链清理）。
- 合入 main 前确认 `npm run -w apps/api db:reset` 在 CI 或本地 fresh DB 上能跑通（V020 与 V021 都是首次执行）。
- 后续"后台模块 + CSV 上传"独立 brainstorm（已在 spec §6 范围之外标注）。
