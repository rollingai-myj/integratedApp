# 促销数据重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 5-sheet 促销 Excel 端到端跑通——后端解析存档案层 + 标准化优惠层，前端上传 + 海报继续工作；老数据全部丢弃，V029 一次性迁移。

**Architecture:** 档案层 (`hq_promo_raw_items`) + 计算层 (`hq_promo_offers`) 分离；4 类机制 (`flat_price` / `bundle_price` / `percent_discount` / `pool_threshold`) 覆盖实测 14 种话术；凑单池用标签字段 `pool_label` 表达，无独立表；多 batch 按 `v_active_offers` 视图按"日期 + 星期 + 是否作废"自动过滤。

**Tech Stack:** PostgreSQL（迁移）/ TypeScript ESM / Express + multer / pg / xlsx (^0.18.5，根 package.json 已有) / Vitest / React + TanStack Router。

## Global Constraints

- 迁移编号 **必须 V029**（V028 已被 `scene_state_ai_status` 占用）
- 老促销数据**全部丢弃**：不做导出、不做兼容；`hq_promo_batches` 在 V029 内 `DROP CASCADE` 重建
- 前端业务路由（含 admin 上传页）**必须 `<IOSDevice>` 包裹**（[[feedback-iosdevice-wrap]]）
- Vitest 命令：`npm run -w apps/api test`；DB verify：`npm run db:verify`；DB reset：`npm run db:reset`
- 所有迁移在容器内运行：`docker exec myj-api npm run migrate`
- 后端解析 Excel：`xlsx` 库的 `read(buffer, {type:'buffer'})` + `utils.sheet_to_json` 路径
- 上传走 **multipart/form-data**：前端发送原文件，后端 multer 接 + xlsx 解析。不再像旧 schema 那样前端预解析 JSON 发送
- 提交粒度：每个 Task 末尾必有 `git commit`；TDD 严格——失败测试先 commit 不强求，但实现合并测试一起 commit
- 不引入新依赖（`xlsx` 已在根 deps，`multer` 已在 api deps）
- ENUM 值采用语义名：`promo_activity_type` = `member_price` / `weekend_beer` / `brand_coupon` / `tuesday_member` / `regular_coupon`；`promo_mechanic` = `flat_price` / `bundle_price` / `percent_discount` / `pool_threshold`
- `bundle_price` 的子类型存 `mechanic_params.subtype` ∈ `{fixed_total, nth_ratio, add_extra, buy_m_get_n}`

---

## File Structure

### DB
- Create: `apps/api/src/db/migrations/V029__promo_data_redesign.sql`
- Modify: `apps/api/src/db/seeds/dev-seed.sql` — 删旧 COPY，加最小新 seed
- Modify: `apps/api/scripts/db-verify.sh` — 改促销相关期望值

### 共享类型
- Modify: `packages/shared/src/index.ts` — 替换 `ProductPromotion` 等为机制感知 shape

### 后端解析器（新目录 `apps/api/src/services/promo/`）
- Create: `apps/api/src/services/promo/parser/mechanic.ts` + `mechanic.test.ts`
- Create: `apps/api/src/services/promo/parser/xlsx.ts` + `xlsx.test.ts`
- Create: `apps/api/src/services/promo/parser/index.ts` + `index.test.ts`

### 后端定价 / 文案
- Create: `apps/api/src/services/promo/pricer/stacking.ts` + `stacking.test.ts`
- Create: `apps/api/src/services/promo/pricer/copy.ts` + `copy.test.ts`
- Create: `apps/api/src/services/promo/pricer/index.ts`

### 后端 service / route
- Modify: `apps/api/src/services/promotions.service.ts`（整体重写）
- Modify: `apps/api/src/routes/promotions.routes.ts`（upload 改 multipart）
- Modify: `apps/api/src/routes/promotions.integration.test.ts`

### 前端
- Modify: `apps/web/src/lib/api-client.ts` — 加 `upload` + 同步 types
- Modify: `apps/web/src/lib/promotions.functions.ts` — 适配新 shape
- Create: `apps/web/src/features/admin/PromoUploadPage.tsx`
- Create: `apps/web/src/routes/admin.promotions.tsx`
- Modify: `apps/web/src/routes/admin.index.tsx` — 加入口

### 验收
- Modify: `apps/api/scripts/db-verify.sh` — 视图改名、约束改名
- Manual smoke：用真实文件 `6月下营销活动（会员价+叠券）.xlsx` 跑一遍

---

### Task 1: V029 migration + db-verify 期望值

**Files:**
- Create: `apps/api/src/db/migrations/V029__promo_data_redesign.sql`
- Modify: `apps/api/src/db/seeds/dev-seed.sql:289-310`（删旧促销 COPY；不加新 seed 防 verify 复杂化）
- Modify: `apps/api/scripts/db-verify.sh:36-37` + `:81`

**Interfaces:**
- Produces: 表 `hq_promo_batches` / `hq_promo_raw_items` / `hq_promo_offers`；ENUM `promo_activity_type`、`promo_mechanic`；视图 `v_active_offers`

- [ ] **Step 1: 写迁移**

```sql
-- apps/api/src/db/migrations/V029__promo_data_redesign.sql
BEGIN;

-- 1. 删旧（依赖顺序：view → table）
DROP VIEW  IF EXISTS v_promotion_active;
DROP VIEW  IF EXISTS hq_promo_mix_groups;
DROP TABLE IF EXISTS hq_promo_batch_items;
DROP TABLE IF EXISTS hq_promo_batches CASCADE;

-- 2. 新 ENUM
CREATE TYPE promo_activity_type AS ENUM (
  'member_price', 'weekend_beer', 'brand_coupon', 'tuesday_member', 'regular_coupon'
);
CREATE TYPE promo_mechanic AS ENUM (
  'flat_price', 'bundle_price', 'percent_discount', 'pool_threshold'
);

-- 3. 上传批次表（语义改造）
CREATE TABLE hq_promo_batches (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name              TEXT NOT NULL,
  source_file_url        TEXT,
  uploaded_by            UUID REFERENCES users(id),
  is_voided              BOOLEAN NOT NULL DEFAULT FALSE,
  activity_window_start  DATE,
  activity_window_end    DATE,
  parse_warnings         JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_total              JSONB NOT NULL DEFAULT '{}'::jsonb,
  parsed_total           JSONB NOT NULL DEFAULT '{}'::jsonb,
  parsed_at              TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hq_promo_batches_window_idx ON hq_promo_batches (activity_window_start, activity_window_end);

-- 4. 原始活动行表（档案层）
CREATE TABLE hq_promo_raw_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES hq_promo_batches(id) ON DELETE CASCADE,
  activity_type         promo_activity_type NOT NULL,
  sheet_row_no          INTEGER NOT NULL,
  sku_code              VARCHAR(32) NOT NULL,
  sku_name_original     TEXT NOT NULL,
  unit                  VARCHAR(16),
  original_price        NUMERIC(10,2) NOT NULL,
  raw_method_text       TEXT,
  qty_required          INTEGER,
  promo_total_price     NUMERIC(10,2),
  promo_group_code      VARCHAR(64),
  category_code         VARCHAR(16),
  category_name         TEXT,
  valid_from            DATE NOT NULL,
  valid_to              DATE NOT NULL,
  fill_down_anchor_row  INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hq_promo_raw_items_batch_idx ON hq_promo_raw_items (batch_id, activity_type);
CREATE INDEX hq_promo_raw_items_sku_idx ON hq_promo_raw_items (sku_code);

-- 5. 标准化优惠表（计算层）
CREATE TABLE hq_promo_offers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_item_id           UUID NOT NULL REFERENCES hq_promo_raw_items(id) ON DELETE CASCADE,
  batch_id              UUID NOT NULL REFERENCES hq_promo_batches(id) ON DELETE CASCADE,
  activity_type         promo_activity_type NOT NULL,
  sku_code              VARCHAR(32) NOT NULL,
  mechanic              promo_mechanic NOT NULL,
  mechanic_params       JSONB NOT NULL,
  pool_label            TEXT,
  original_price        NUMERIC(10,2) NOT NULL,
  valid_weekday_mask    SMALLINT NOT NULL,  -- 7 bits: Mon=0b1000000 ... Sun=0b0000001
  valid_from            DATE NOT NULL,
  valid_to              DATE NOT NULL,
  is_stackable          BOOLEAN NOT NULL,
  parse_note            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hq_promo_offers_batch_idx     ON hq_promo_offers (batch_id);
CREATE INDEX hq_promo_offers_sku_idx       ON hq_promo_offers (sku_code);
CREATE INDEX hq_promo_offers_pool_idx      ON hq_promo_offers (batch_id, activity_type, pool_label) WHERE pool_label IS NOT NULL;
CREATE INDEX hq_promo_offers_valid_idx     ON hq_promo_offers (valid_from, valid_to);

-- 6. 视图：按日期 + 星期 + 是否作废过滤
CREATE VIEW v_active_offers AS
SELECT o.*
FROM   hq_promo_offers o
JOIN   hq_promo_batches b ON b.id = o.batch_id
WHERE  b.is_voided = FALSE
  AND  current_date BETWEEN o.valid_from AND o.valid_to
  AND  (o.valid_weekday_mask & (1 << (7 - EXTRACT(ISODOW FROM current_date)::int))) <> 0;

COMMIT;
```

> 星期掩码约定：bit 6 = 周一 ... bit 0 = 周日；`EXTRACT(ISODOW)` 周一=1...周日=7，所以 `(7 - dow)` 给出对应 bit 位。

- [ ] **Step 2: 改 dev-seed**

`apps/api/src/db/seeds/dev-seed.sql:289-310` 删除整段 `COPY hq_promo_batches ... \.` + `COPY hq_promo_batch_items ... \.`（旧表已被 DROP）。本期不补新 seed（保持 verify 简单）。

- [ ] **Step 3: 改 db-verify.sh**

`apps/api/scripts/db-verify.sh`：

```bash
# 删除以下两行：
expect "激活批次数"        "SELECT count(*) FROM hq_promo_batches WHERE is_active" 1
expect "促销单品行"        "SELECT count(*) FROM hq_promo_batch_items" 1083

# 改成：
expect "促销批次空"        "SELECT count(*) FROM hq_promo_batches" 0
expect "促销档案空"        "SELECT count(*) FROM hq_promo_raw_items" 0
expect "促销优惠空"        "SELECT count(*) FROM hq_promo_offers" 0

# 删除约束测试（旧表 / 旧 partial UQ 都没了）：
expect_reject "#9 第二条激活批次" ...
expect_reject "#6 促销文案 scope 三段配对" ...

# 视图测试改名：
expect "v_promotion_active 可查询" "SELECT (count(*) >= 0)::text FROM v_promotion_active" true
# 改成：
expect "v_active_offers 可查询"    "SELECT (count(*) >= 0)::text FROM v_active_offers" true
```

- [ ] **Step 4: 跑迁移 + verify**

```bash
docker exec myj-api npm run migrate
npm run db:verify
```

Expected: `ALL CHECKS PASSED`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/V029__promo_data_redesign.sql \
        apps/api/src/db/seeds/dev-seed.sql \
        apps/api/scripts/db-verify.sh
git commit -m "feat(promo): V029 重构 schema — 档案层 raw_items + 计算层 offers + v_active_offers 视图"
```

---

### Task 2: 共享类型 + 删旧 PromoUpload shape

**Files:**
- Modify: `packages/shared/src/index.ts`（搜 "PromotionUpload" 块）

**Interfaces:**
- Produces: TS 类型 `PromoActivityType` / `PromoMechanic` / `PromoMechanicParams` / `PromoOffer` / `PromoBatch` / `UploadResult` / `ActivePromotionsResponse` / `RecommendPromotionsResponse`

- [ ] **Step 1: 替换共享类型**

`packages/shared/src/index.ts` — 找"模块 8 · 促销 (Promotions)"段，整段替换：

```ts
// 模块 8 · 促销 (Promotions)

export type PromoActivityType =
  | 'member_price' | 'weekend_beer' | 'brand_coupon'
  | 'tuesday_member' | 'regular_coupon';

export type PromoMechanic =
  | 'flat_price' | 'bundle_price' | 'percent_discount' | 'pool_threshold';

export type PromoBundleSubtype =
  | 'fixed_total' | 'nth_ratio' | 'add_extra' | 'buy_m_get_n';

export type PromoMechanicParams =
  | { kind: 'flat_price'; target_price: number }
  | { kind: 'bundle_price'; subtype: 'fixed_total'; qty_required: number; total_price: number }
  | { kind: 'bundle_price'; subtype: 'nth_ratio'; qty_required: number; nth: number; ratio: number }
  | { kind: 'bundle_price'; subtype: 'add_extra'; qty_required: number; add_amount: number }
  | { kind: 'bundle_price'; subtype: 'buy_m_get_n'; m: number; n: number }
  | { kind: 'percent_discount'; pay_ratio: number }
  | { kind: 'pool_threshold'; threshold: number; discount: number };

export interface PromoBatch {
  id: string;
  fileName: string;
  sourceFileUrl: string | null;
  uploadedBy: string | null;
  isVoided: boolean;
  activityWindowStart: string | null;
  activityWindowEnd: string | null;
  parseWarnings: Array<{ sheet: string; row: number; reason: string; raw?: unknown }>;
  rowTotal: Record<PromoActivityType, number>;
  parsedTotal: Record<PromoActivityType, number>;
  parsedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PromoOffer {
  id: string;
  batchId: string;
  activityType: PromoActivityType;
  skuCode: string;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  poolLabel: string | null;
  originalPrice: number;
  validWeekdayMask: number;
  validFrom: string;
  validTo: string;
  isStackable: boolean;
}

export interface PromoBestResult {
  skuCode: string;
  productName: string;
  unit: string | null;
  categoryName: string | null;
  originalPrice: number;
  /** base + 至多一个 add-on 组合 */
  baseOfferId: string;
  addonOfferId: string | null;
  /** 单品摊销最低支付金额（套餐总价 / 件数） */
  bestUnitPrice: number;
  /** 套餐总价（base 算出来的 Q 件总价；A 机制 = 单件价） */
  bestBundleTotal: number;
  bestQty: number;
  bestSavingPercent: number;
  /** 拼装好的默认文案 */
  defaultCopy: string;
  /** 池子上下文，仅 B/D 机制有 */
  poolLabel: string | null;
  poolSize: number | null;
}

export interface ActivePromotionsResponse {
  batches: PromoBatch[];
  results: PromoBestResult[];
}

export interface RecommendPromotionsResponse {
  batches: PromoBatch[];
  results: PromoBestResult[];
}

export interface UploadResult {
  batch: PromoBatch;
  warnings: Array<{ sheet: string; row: number; reason: string; raw?: unknown }>;
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: 报一堆 `promotions.functions.ts` / `promotions.service.ts` 引用旧类型的错——预期，后续 Task 修。其它包应 PASS。

> 不要在这里"修"`promotions.service.ts` / shim — 它们整段在 Task 8 / 11 重写。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): 促销新 shape — 4 类机制 + 多 batch + 标准化优惠"
```

---

### Task 3: 话术 → 机制解析器（mechanic.ts）

**Files:**
- Create: `apps/api/src/services/promo/parser/mechanic.ts`
- Create: `apps/api/src/services/promo/parser/mechanic.test.ts`

**Interfaces:**
- Consumes: `PromoMechanicParams`（`@myj/shared`）
- Produces:
  ```ts
  export interface MechanicMatch {
    mechanic: PromoMechanic;
    params: PromoMechanicParams;
    note: string;  // 匹配到的子串/判定理由
  }
  export function parseMechanic(text: string): MechanicMatch | null;
  ```

- [ ] **Step 1: 写测试**

```ts
// apps/api/src/services/promo/parser/mechanic.test.ts
import { describe, it, expect } from 'vitest';
import { parseMechanic } from './mechanic.js';

describe('parseMechanic', () => {
  it.each([
    ['0.1元抢', 0.1],
    ['9.9元抢', 9.9],
    ['特价9.9元/瓶', 9.9],
    ['16.9元抢', 16.9],
  ])('flat_price: %s → target_price=%f', (txt, price) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('flat_price');
    expect(m.params).toEqual({ kind: 'flat_price', target_price: price });
  });

  it.each([
    ['9.9元/任意2盒', 2, 9.9],
    ['8元/任意2瓶', 2, 8],
    ['两件特价9元', 2, 9],
    ['3件特价9元', 3, 9],
    ['4件特价24元', 4, 24],
    ['2件特价5.2元', 2, 5.2],
  ])('bundle fixed_total: %s', (txt, qty, total) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('bundle_price');
    expect(m.params).toMatchObject({ subtype: 'fixed_total', qty_required: qty, total_price: total });
  });

  it.each(['本品第2支半价', '任意第2瓶半价', '第2包半价', '任意第2袋半价'])(
    'bundle nth_ratio: %s',
    (txt) => {
      const m = parseMechanic(txt)!;
      expect(m.params).toMatchObject({ subtype: 'nth_ratio', qty_required: 2, nth: 2, ratio: 0.5 });
    },
  );

  it.each([
    ['加1元多1包', 2, 1],
    ['加2元多任意1瓶', 2, 2],
    ['加1元多任意1瓶', 2, 1],
  ])('bundle add_extra: %s', (txt, qty, add) => {
    const m = parseMechanic(txt)!;
    expect(m.params).toMatchObject({ subtype: 'add_extra', qty_required: qty, add_amount: add });
  });

  it('bundle buy_m_get_n: 本品买3送1', () => {
    const m = parseMechanic('本品买3送1')!;
    expect(m.params).toMatchObject({ subtype: 'buy_m_get_n', m: 3, n: 1 });
  });

  it('bundle buy_m_get_n: 买一送一', () => {
    const m = parseMechanic('买一送一')!;
    expect(m.params).toMatchObject({ subtype: 'buy_m_get_n', m: 1, n: 1 });
  });

  it.each([
    ['50%折扣券', 0.5],
    ['75%折扣券', 0.75],
  ])('percent_discount: %s', (txt, ratio) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('percent_discount');
    expect(m.params).toEqual({ kind: 'percent_discount', pay_ratio: ratio });
  });

  it.each([
    ['百威系列\n满25减5元', 25, 5],
    ['满15减3元', 15, 3],
    ['怡宝水 \n满59减15元', 59, 15],
  ])('pool_threshold: %s', (txt, thr, disc) => {
    const m = parseMechanic(txt)!;
    expect(m.mechanic).toBe('pool_threshold');
    expect(m.params).toEqual({ kind: 'pool_threshold', threshold: thr, discount: disc });
  });

  it('返回 null：不可识别', () => {
    expect(parseMechanic('hello world')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试验失败**

```bash
npm run -w apps/api test -- mechanic
```

Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现 mechanic.ts**

```ts
// apps/api/src/services/promo/parser/mechanic.ts
import type { PromoMechanic, PromoMechanicParams } from '@myj/shared';

export interface MechanicMatch {
  mechanic: PromoMechanic;
  params: PromoMechanicParams;
  note: string;
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
function cnDigit(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return CN_DIGITS[s] ?? null;
}

const PATTERNS: Array<{ name: string; test: (t: string) => MechanicMatch | null }> = [
  // pool_threshold: 满 X 减 Y 元（最先匹配，话术里含"满...减"就一定是这一类）
  {
    name: 'pool_threshold',
    test: (t) => {
      const m = t.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/);
      if (!m) return null;
      return {
        mechanic: 'pool_threshold',
        params: { kind: 'pool_threshold', threshold: parseFloat(m[1]!), discount: parseFloat(m[2]!) },
        note: m[0]!,
      };
    },
  },
  // percent_discount: X% 折扣券
  {
    name: 'percent_discount',
    test: (t) => {
      const m = t.match(/(\d+)\s*%\s*折扣券/);
      if (!m) return null;
      return {
        mechanic: 'percent_discount',
        params: { kind: 'percent_discount', pay_ratio: parseInt(m[1]!, 10) / 100 },
        note: m[0]!,
      };
    },
  },
  // bundle buy_m_get_n: 买 M 送 N / 本品买 M 送 N
  {
    name: 'buy_m_get_n',
    test: (t) => {
      const m = t.match(/(?:本品)?买\s*([一二两三四五\d]+)\s*送\s*([一二两三四五\d]+)/);
      if (!m) return null;
      const M = cnDigit(m[1]!); const N = cnDigit(m[2]!);
      if (M == null || N == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: M, n: N },
        note: m[0]!,
      };
    },
  },
  // bundle nth_ratio: 第N件半价 / 本品第N支半价 / 任意第N瓶半价
  {
    name: 'nth_ratio',
    test: (t) => {
      const m = t.match(/(?:本品|任意)?第\s*([一二两三四五\d]+)\s*[支瓶包盒袋件个]半价/);
      if (!m) return null;
      const k = cnDigit(m[1]!);
      if (k == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'nth_ratio', qty_required: k, nth: k, ratio: 0.5 },
        note: m[0]!,
      };
    },
  },
  // bundle add_extra: 加 ΔY 元多任意 1 件 / 加 ΔY 元多 1 件
  {
    name: 'add_extra',
    test: (t) => {
      const m = t.match(/加\s*(\d+(?:\.\d+)?)\s*元多(?:任意)?\s*([一二两三四五\d]+)\s*[支瓶包盒袋件个]/);
      if (!m) return null;
      const add = parseFloat(m[1]!); const more = cnDigit(m[2]!);
      if (more == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'add_extra', qty_required: 1 + more, add_amount: add },
        note: m[0]!,
      };
    },
  },
  // bundle fixed_total: N件Y元 / Y元/任意N件 / N件特价Y元
  {
    name: 'fixed_total_qty_first',
    test: (t) => {
      // "两件特价9元" "3件特价9元" "4件特价24元" "2件特价5.2元"
      const m = t.match(/([一二两三四五\d]+)\s*件特价\s*(\d+(?:\.\d+)?)\s*元/);
      if (!m) return null;
      const q = cnDigit(m[1]!);
      if (q == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: q, total_price: parseFloat(m[2]!) },
        note: m[0]!,
      };
    },
  },
  {
    name: 'fixed_total_price_first',
    test: (t) => {
      // "9.9元/任意2盒" "8元/任意2瓶" "15元/任意2罐"
      const m = t.match(/(\d+(?:\.\d+)?)\s*元\s*\/\s*(?:任意)?\s*([一二两三四五\d]+)\s*[支瓶包盒袋件个罐]/);
      if (!m) return null;
      const q = cnDigit(m[2]!);
      if (q == null) return null;
      return {
        mechanic: 'bundle_price',
        params: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: q, total_price: parseFloat(m[1]!) },
        note: m[0]!,
      };
    },
  },
  // flat_price: X元抢 / 特价 X 元/件
  {
    name: 'flat_price',
    test: (t) => {
      let m = t.match(/(\d+(?:\.\d+)?)\s*元抢/);
      if (m) return {
        mechanic: 'flat_price',
        params: { kind: 'flat_price', target_price: parseFloat(m[1]!) },
        note: m[0]!,
      };
      m = t.match(/特价\s*(\d+(?:\.\d+)?)\s*元/);
      if (m) return {
        mechanic: 'flat_price',
        params: { kind: 'flat_price', target_price: parseFloat(m[1]!) },
        note: m[0]!,
      };
      return null;
    },
  },
];

export function parseMechanic(text: string): MechanicMatch | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  for (const p of PATTERNS) {
    const r = p.test(cleaned);
    if (r) return r;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试**

```bash
npm run -w apps/api test -- mechanic
```

Expected: PASS（27+ 用例）。若失败，调整正则；不要修测试用例去迎合实现。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/promo/parser/mechanic.ts \
        apps/api/src/services/promo/parser/mechanic.test.ts
git commit -m "feat(promo): 话术→4 类机制解析器（mechanic.ts）"
```

---

### Task 4: Excel sheet 列映射（xlsx.ts）

**Files:**
- Create: `apps/api/src/services/promo/parser/xlsx.ts`
- Create: `apps/api/src/services/promo/parser/xlsx.test.ts`

**Interfaces:**
- Consumes: `xlsx` 库的 `WorkBook`
- Produces:
  ```ts
  export interface RawSheetRow {
    activityType: PromoActivityType;
    sheetRowNo: number;
    skuCode: string;
    skuNameOriginal: string;
    unit: string | null;
    originalPrice: number;
    rawMethodText: string | null;
    qtyRequired: number | null;
    promoTotalPrice: number | null;
    promoGroupCode: string | null;
    categoryCode: string | null;
    categoryName: string | null;
    validFrom: Date;
    validTo: Date;
  }
  export function readWorkbook(buf: Buffer): { rows: RawSheetRow[]; sheetWarnings: Array<{sheet:string;row:number;reason:string}> };
  ```

- [ ] **Step 1: 写测试 — 用 xlsx 在内存里造一个 mini workbook**

```ts
// apps/api/src/services/promo/parser/xlsx.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbook } from './xlsx.js';

function makeWb(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('readWorkbook', () => {
  it('会员价: 10 列 → RawSheetRow 全字段', () => {
    const buf = makeWb({
      会员价: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','促销组','开始时间','结束时间'],
        ['39饼干','39080306','奥利奥87g','盒',6.5,'9.9元/任意2盒',2,9.9,23,'2026-06-15','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.activityType).toBe('member_price');
    expect(r.skuCode).toBe('39080306');
    expect(r.qtyRequired).toBe(2);
    expect(r.promoTotalPrice).toBe(9.9);
    expect(r.promoGroupCode).toBe('23');
    expect(r.categoryName).toBe('39饼干');
  });

  it('周末啤酒日: activity_type=weekend_beer', () => {
    const buf = makeWb({
      周末啤酒日: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','开始时间','结束时间'],
        ['28啤酒／预调酒','28012389','珠江纯生500ml','罐',6.5,'本品买3送1','4',19.5,'2026-06-15','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.activityType).toBe('weekend_beer');
    expect(rows[0]!.qtyRequired).toBe(4);
    expect(rows[0]!.promoGroupCode).toBeNull();
  });

  it('品牌满减券: 无大类列、无包含商品数列', () => {
    const buf = makeWb({
      品牌满减券: [
        ['商品代码','品名及规格','单位','原零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金500ml','罐',9,'百威系列\n满25减5元','2026-06-01','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.activityType).toBe('brand_coupon');
    expect(rows[0]!.categoryName).toBeNull();
    expect(rows[0]!.qtyRequired).toBeNull();
  });

  it('常规优惠券: 列名是"零售价"不是"原零售价"', () => {
    const buf = makeWb({
      常规优惠券: [
        ['商品代码','品名及规格','单位','零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金500ml','罐',9,'75%折扣券','2026-06-01','2026-06-30'],
      ],
    });
    const { rows } = readWorkbook(buf);
    expect(rows[0]!.originalPrice).toBe(9);
    expect(rows[0]!.activityType).toBe('regular_coupon');
  });

  it('未知 sheet 名：跳过且报告 warning', () => {
    const buf = makeWb({ 未知活动: [['x'], ['y']] });
    const { rows, sheetWarnings } = readWorkbook(buf);
    expect(rows).toHaveLength(0);
    expect(sheetWarnings.some((w) => w.reason.includes('未识别 sheet'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试验失败**

```bash
npm run -w apps/api test -- xlsx
```

Expected: FAIL

- [ ] **Step 3: 实现 xlsx.ts**

```ts
// apps/api/src/services/promo/parser/xlsx.ts
import * as XLSX from 'xlsx';
import type { PromoActivityType } from '@myj/shared';

export interface RawSheetRow {
  activityType: PromoActivityType;
  sheetRowNo: number;
  skuCode: string;
  skuNameOriginal: string;
  unit: string | null;
  originalPrice: number;
  rawMethodText: string | null;
  qtyRequired: number | null;
  promoTotalPrice: number | null;
  promoGroupCode: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  validFrom: Date;
  validTo: Date;
}

const SHEET_TYPE: Record<string, PromoActivityType> = {
  会员价: 'member_price',
  周末啤酒日: 'weekend_beer',
  品牌满减券: 'brand_coupon',
  周二会员日: 'tuesday_member',
  常规优惠券: 'regular_coupon',
};

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return XLSX.SSF.parse_date_code(v) as unknown as Date;
  return new Date(String(v));
}

function parseCategory(v: unknown): { code: string | null; name: string | null } {
  if (v == null) return { code: null, name: null };
  const s = String(v).trim();
  const m = s.match(/^(\d+)(.*)$/);
  if (m) return { code: m[1]!, name: s };
  return { code: null, name: s };
}

export function readWorkbook(buf: Buffer): {
  rows: RawSheetRow[];
  sheetWarnings: Array<{ sheet: string; row: number; reason: string }>;
} {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const rows: RawSheetRow[] = [];
  const sheetWarnings: Array<{ sheet: string; row: number; reason: string }> = [];

  for (const sheetName of wb.SheetNames) {
    const activityType = SHEET_TYPE[sheetName];
    if (!activityType) {
      sheetWarnings.push({ sheet: sheetName, row: 0, reason: `未识别 sheet: ${sheetName}` });
      continue;
    }
    const ws = wb.Sheets[sheetName]!;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    if (aoa.length < 2) continue;
    const header = (aoa[0] as unknown[]).map((c) => String(c ?? '').trim());
    const idx = (col: string) => header.indexOf(col);

    const cSku    = idx('商品代码');
    const cName   = idx('品名及规格');
    const cUnit   = idx('单位');
    const cPrice  = idx('原零售价') >= 0 ? idx('原零售价') : idx('零售价');
    const cMethod = idx('具体促销方式');
    const cQty    = idx('包含商品数');
    const cTotal  = idx('促销价');
    const cGroup  = idx('促销组');
    const cCat    = idx('大类');
    const cFrom   = idx('开始时间');
    const cTo     = idx('结束时间');

    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] as unknown[];
      if (!r || r.length === 0 || r[cSku] == null || r[cSku] === '') continue;
      const cat = cCat >= 0 ? parseCategory(r[cCat]) : { code: null, name: null };
      const origPrice = toNum(r[cPrice]);
      if (origPrice == null) {
        sheetWarnings.push({ sheet: sheetName, row: i + 1, reason: '原零售价缺失或非数值' });
        continue;
      }
      const row: RawSheetRow = {
        activityType,
        sheetRowNo: i + 1,
        skuCode: String(r[cSku]).trim(),
        skuNameOriginal: String(r[cName] ?? '').trim(),
        unit: cUnit >= 0 ? (r[cUnit] != null ? String(r[cUnit]).trim() : null) : null,
        originalPrice: origPrice,
        rawMethodText: cMethod >= 0 && r[cMethod] != null ? String(r[cMethod]).trim() : null,
        qtyRequired: cQty >= 0 ? toNum(r[cQty]) : null,
        promoTotalPrice: cTotal >= 0 ? toNum(r[cTotal]) : null,
        promoGroupCode: cGroup >= 0 && r[cGroup] != null ? String(r[cGroup]).trim() : null,
        categoryCode: cat.code,
        categoryName: cat.name,
        validFrom: toDate(r[cFrom]),
        validTo: toDate(r[cTo]),
      };
      rows.push(row);
    }
  }

  return { rows, sheetWarnings };
}
```

- [ ] **Step 4: 跑测试**

```bash
npm run -w apps/api test -- xlsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/promo/parser/xlsx.ts \
        apps/api/src/services/promo/parser/xlsx.test.ts
git commit -m "feat(promo): 5 sheet 列映射 + 未知 sheet 告警（xlsx.ts）"
```

---

### Task 5: 解析编排（parser/index.ts） — fill-down + raw→offer + 星期掩码

**Files:**
- Create: `apps/api/src/services/promo/parser/index.ts`
- Create: `apps/api/src/services/promo/parser/index.test.ts`

**Interfaces:**
- Consumes: `readWorkbook` (Task 4), `parseMechanic` (Task 3)
- Produces:
  ```ts
  export interface ParseOutput {
    rawItems: Array<RawSheetRow & { fillDownAnchorRow: number | null }>;
    offers: Array<Omit<PromoOffer, 'id' | 'batchId' | 'createdAt'> & { rawItemSheetRowNo: number; parseNote: string | null }>;
    warnings: Array<{ sheet: string; row: number; reason: string }>;
  }
  export function parseWorkbook(buf: Buffer): ParseOutput;
  ```

- [ ] **Step 1: 写测试 — fill-down + 池子标签 + 星期掩码 + buy_m_get_n 对账**

```ts
// apps/api/src/services/promo/parser/index.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from './index.js';

function makeWb(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseWorkbook', () => {
  it('品牌满减券 fill-down: 第二行空话术继承第一行', () => {
    const buf = makeWb({
      品牌满减券: [
        ['商品代码','品名及规格','单位','原零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金500ml','罐',9,'百威系列\n满25减5元','2026-06-01','2026-06-30'],
        ['28051568','百威236ml',     '瓶',5,null,                  '2026-06-01','2026-06-30'],
      ],
    });
    const { rawItems, offers } = parseWorkbook(buf);
    expect(rawItems).toHaveLength(2);
    expect(rawItems[1]!.rawMethodText).toContain('满25减5');
    expect(rawItems[1]!.fillDownAnchorRow).toBe(2);
    expect(offers).toHaveLength(2);
    expect(offers[0]!.poolLabel).toBe('brand_coupon/百威系列');
    expect(offers[1]!.poolLabel).toBe('brand_coupon/百威系列');
    expect(offers[0]!.mechanic).toBe('pool_threshold');
    expect(offers[0]!.isStackable).toBe(true);
  });

  it('会员价 promo_group_code → pool_label', () => {
    const buf = makeWb({
      会员价: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','促销组','开始时间','结束时间'],
        ['39饼干','39080306','奥利奥A','盒',6.5,'9.9元/任意2盒',2,9.9,23,'2026-06-15','2026-06-30'],
        ['39饼干','39044451','奥利奥B','盒',6.5,'9.9元/任意2盒',2,9.9,23,'2026-06-15','2026-06-30'],
      ],
    });
    const { offers } = parseWorkbook(buf);
    expect(offers[0]!.poolLabel).toBe('member_price/促销组23');
    expect(offers[1]!.poolLabel).toBe('member_price/促销组23');
  });

  it('周末啤酒日: 星期掩码=五六日, buy_m_get_n 对账成功', () => {
    const buf = makeWb({
      周末啤酒日: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','开始时间','结束时间'],
        ['28啤酒','28012389','珠江500ml','罐',6.5,'本品买3送1','4',19.5,'2026-06-15','2026-06-30'],
      ],
    });
    const { offers, warnings } = parseWorkbook(buf);
    // Mon=64 Tue=32 Wed=16 Thu=8 Fri=4 Sat=2 Sun=1 → Fri+Sat+Sun = 7
    expect(offers[0]!.validWeekdayMask).toBe(7);
    expect(warnings).toHaveLength(0);
  });

  it('周末啤酒日: buy_m_get_n 对账失败 → 报告 warning 但仍入库', () => {
    const buf = makeWb({
      周末啤酒日: [
        ['大类','商品代码','品名及规格','单位','原零售价','具体促销方式','包含商品数','促销价','开始时间','结束时间'],
        ['28啤酒','28012389','珠江500ml','罐',6.5,'本品买3送1','4',99,'2026-06-15','2026-06-30'],
      ],
    });
    const { offers, warnings } = parseWorkbook(buf);
    expect(offers).toHaveLength(1);
    expect(warnings.some((w) => w.reason.includes('对账'))).toBe(true);
  });

  it('周二会员日: 星期掩码=仅周二（=32）', () => {
    const buf = makeWb({
      周二会员日: [
        ['商品代码','品名及规格','单位','原零售价','具体促销方式','开始时间','结束时间'],
        ['26059606','东鹏奶茶','瓶',4.5,'50%折扣券','2026-06-01','2026-06-30'],
      ],
    });
    const { offers } = parseWorkbook(buf);
    expect(offers[0]!.validWeekdayMask).toBe(32);
    expect(offers[0]!.mechanic).toBe('percent_discount');
    expect(offers[0]!.isStackable).toBe(true);
  });

  it('话术匹配失败：写 warning，offer 不写', () => {
    const buf = makeWb({
      常规优惠券: [
        ['商品代码','品名及规格','单位','零售价','具体促销方式','开始时间','结束时间'],
        ['28052030','百威黑金','罐',9,'胡说八道一通','2026-06-01','2026-06-30'],
      ],
    });
    const { rawItems, offers, warnings } = parseWorkbook(buf);
    expect(rawItems).toHaveLength(1);
    expect(offers).toHaveLength(0);
    expect(warnings.some((w) => w.reason.includes('无法识别'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试验失败**

```bash
npm run -w apps/api test -- "parser/index"
```

Expected: FAIL

- [ ] **Step 3: 实现 parser/index.ts**

```ts
// apps/api/src/services/promo/parser/index.ts
import type { PromoActivityType, PromoMechanic, PromoMechanicParams } from '@myj/shared';
import { readWorkbook, type RawSheetRow } from './xlsx.js';
import { parseMechanic } from './mechanic.js';

export interface ParsedRawItem extends RawSheetRow {
  fillDownAnchorRow: number | null;
}

export interface ParsedOffer {
  rawItemSheetRowNo: number;
  activityType: PromoActivityType;
  skuCode: string;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  poolLabel: string | null;
  originalPrice: number;
  validWeekdayMask: number;
  validFrom: Date;
  validTo: Date;
  isStackable: boolean;
  parseNote: string | null;
}

export interface ParseOutput {
  rawItems: ParsedRawItem[];
  offers: ParsedOffer[];
  warnings: Array<{ sheet: string; row: number; reason: string; raw?: unknown }>;
}

// Mon=64 Tue=32 Wed=16 Thu=8 Fri=4 Sat=2 Sun=1
const MASK_ALL = 0b1111111;        // 127
const MASK_WEEKEND = 0b0000111;    // 7  (Fri+Sat+Sun)
const MASK_TUESDAY = 0b0100000;    // 32

function weekdayMask(t: PromoActivityType): number {
  if (t === 'weekend_beer') return MASK_WEEKEND;
  if (t === 'tuesday_member') return MASK_TUESDAY;
  return MASK_ALL;
}

const STACKABLE_MECHANICS = new Set<PromoMechanic>(['percent_discount', 'pool_threshold']);

const SHEET_LABEL: Record<PromoActivityType, string> = {
  member_price: 'member_price',
  weekend_beer: 'weekend_beer',
  brand_coupon: 'brand_coupon',
  tuesday_member: 'tuesday_member',
  regular_coupon: 'regular_coupon',
};

function poolLabel(row: ParsedRawItem, params: PromoMechanicParams): string | null {
  // 会员价 + 有促销组 → member_price/促销组N
  if (row.activityType === 'member_price' && row.promoGroupCode) {
    return `member_price/促销组${row.promoGroupCode}`;
  }
  // 品牌满减券 → brand_coupon/<段落名>，从 raw_method_text 第一行抽
  if (row.activityType === 'brand_coupon' && row.rawMethodText) {
    const firstLine = row.rawMethodText.split(/[\n\r]/).find((s) => s.trim() && !/满.*减/.test(s));
    if (firstLine) return `brand_coupon/${firstLine.trim().replace(/系列$/, '系列')}`;
    return 'brand_coupon/未命名池';
  }
  // pool_threshold 不挂在 brand_coupon 之外的类型，按规则
  void params;
  return null;
}

export function parseWorkbook(buf: Buffer): ParseOutput {
  const { rows, sheetWarnings } = readWorkbook(buf);
  const warnings: ParseOutput['warnings'] = [...sheetWarnings];
  const rawItems: ParsedRawItem[] = [];
  const offers: ParsedOffer[] = [];

  // fill-down 仅 brand_coupon 用
  let fillDownText: string | null = null;
  let fillDownAnchor: number | null = null;

  for (const r of rows) {
    let methodText = r.rawMethodText;
    let anchor: number | null = null;
    if (r.activityType === 'brand_coupon') {
      if (methodText) {
        fillDownText = methodText;
        fillDownAnchor = r.sheetRowNo;
        anchor = r.sheetRowNo;
      } else if (fillDownText) {
        methodText = fillDownText;
        anchor = fillDownAnchor;
      } else {
        warnings.push({ sheet: 'brand_coupon', row: r.sheetRowNo, reason: 'fill-down 段落起始为空' });
      }
    }
    const rawItem: ParsedRawItem = { ...r, rawMethodText: methodText, fillDownAnchorRow: anchor };
    rawItems.push(rawItem);

    if (!methodText) continue;
    const m = parseMechanic(methodText);
    if (!m) {
      warnings.push({ sheet: SHEET_LABEL[r.activityType], row: r.sheetRowNo, reason: `无法识别话术: ${methodText}` });
      continue;
    }

    // weekend_beer 对账：m*原价 == 促销价?
    if (m.params.kind === 'bundle_price' && m.params.subtype === 'buy_m_get_n' && r.promoTotalPrice != null) {
      const expected = m.params.m * r.originalPrice;
      if (Math.abs(expected - r.promoTotalPrice) > 0.01) {
        warnings.push({
          sheet: SHEET_LABEL[r.activityType],
          row: r.sheetRowNo,
          reason: `买${m.params.m}送${m.params.n}对账失败: ${m.params.m}×${r.originalPrice}=${expected} 但促销价=${r.promoTotalPrice}`,
        });
      }
    }

    offers.push({
      rawItemSheetRowNo: r.sheetRowNo,
      activityType: r.activityType,
      skuCode: r.skuCode,
      mechanic: m.mechanic,
      mechanicParams: m.params,
      poolLabel: poolLabel(rawItem, m.params),
      originalPrice: r.originalPrice,
      validWeekdayMask: weekdayMask(r.activityType),
      validFrom: r.validFrom,
      validTo: r.validTo,
      isStackable: STACKABLE_MECHANICS.has(m.mechanic),
      parseNote: m.note,
    });
  }

  return { rawItems, offers, warnings };
}
```

- [ ] **Step 4: 跑测试**

```bash
npm run -w apps/api test -- "parser/index"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/promo/parser/index.ts \
        apps/api/src/services/promo/parser/index.test.ts
git commit -m "feat(promo): 解析编排 — fill-down + 池子标签 + 星期掩码 + 对账（parser/index.ts）"
```

---

### Task 6: 定价引擎（pricer/stacking.ts）— 叠加矩阵 + 最优组合

**Files:**
- Create: `apps/api/src/services/promo/pricer/stacking.ts`
- Create: `apps/api/src/services/promo/pricer/stacking.test.ts`

**Interfaces:**
- Consumes: `PromoOffer`（无 id/batchId，输入用结构子集）
- Produces:
  ```ts
  export interface PricerOffer { activityType; mechanic; mechanicParams; originalPrice; poolLabel; isStackable; }
  export function computeBest(skuOffers: PricerOffer[], poolPeerOriginalPrices: Record<string, number[]>): {
    baseIdx: number;
    addonIdx: number | null;
    bundleTotal: number;
    qty: number;
    unitPrice: number;
    savingPercent: number;
  } | null;
  ```

- [ ] **Step 1: 写测试**

```ts
// apps/api/src/services/promo/pricer/stacking.test.ts
import { describe, it, expect } from 'vitest';
import { computeBest, type PricerOffer } from './stacking.js';

const baseMember: PricerOffer = {
  activityType: 'member_price',
  mechanic: 'bundle_price',
  mechanicParams: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: 2, total_price: 9.9 },
  originalPrice: 6.5,
  poolLabel: 'member_price/促销组23',
  isStackable: false,
};

describe('computeBest', () => {
  it('单 base (member_price B1)', () => {
    const r = computeBest([baseMember], {})!;
    expect(r.bundleTotal).toBe(9.9);
    expect(r.qty).toBe(2);
    expect(r.unitPrice).toBeCloseTo(4.95);
    expect(r.savingPercent).toBeCloseTo((6.5 - 4.95) / 6.5);
  });

  it('B base + C add-on：套餐总价 ×0.5', () => {
    const addon: PricerOffer = {
      activityType: 'tuesday_member',
      mechanic: 'percent_discount',
      mechanicParams: { kind: 'percent_discount', pay_ratio: 0.5 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: true,
    };
    const r = computeBest([baseMember, addon], {})!;
    expect(r.addonIdx).toBe(1);
    expect(r.bundleTotal).toBeCloseTo(9.9 * 0.5);
  });

  it('B base + D add-on：套餐总价不变，由调用方在池子层算满减', () => {
    const addon: PricerOffer = {
      activityType: 'brand_coupon',
      mechanic: 'pool_threshold',
      mechanicParams: { kind: 'pool_threshold', threshold: 25, discount: 5 },
      originalPrice: 6.5,
      poolLabel: 'brand_coupon/百威系列',
      isStackable: true,
    };
    const r = computeBest([baseMember, addon], {})!;
    expect(r.addonIdx).toBe(1);
    // 单池满减不在单 sku 算，本测试只验证 add-on 被选中
  });

  it('两个 base 候选: 会员价 (B1 总价 9.9 / 2 件) vs 啤酒日 (B4 买3送1)', () => {
    const beer: PricerOffer = {
      activityType: 'weekend_beer',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: 3, n: 1 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: false,
    };
    const r = computeBest([baseMember, beer], {})!;
    // 会员价单价摊销 = 4.95；啤酒日单价摊销 = (3*6.5)/4 = 4.875
    expect(r.baseIdx).toBe(1);  // 啤酒日略胜
    expect(r.unitPrice).toBeCloseTo(4.875);
  });

  it('flat_price base 无 add-on', () => {
    const flat: PricerOffer = {
      activityType: 'regular_coupon',
      mechanic: 'flat_price',
      mechanicParams: { kind: 'flat_price', target_price: 6.9 },
      originalPrice: 10,
      poolLabel: null,
      isStackable: false,
    };
    const r = computeBest([flat], {})!;
    expect(r.bundleTotal).toBe(6.9);
    expect(r.qty).toBe(1);
    expect(r.unitPrice).toBe(6.9);
  });

  it('B2 nth_ratio 本品: 单价 6.5 → 总价 = 6.5 + 6.5*0.5 = 9.75', () => {
    const o: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'nth_ratio', qty_required: 2, nth: 2, ratio: 0.5 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: false,
    };
    const r = computeBest([o], {})!;
    expect(r.bundleTotal).toBeCloseTo(9.75);
  });

  it('B3 add_extra: 单价 5 + 加 1 → 总价 6', () => {
    const o: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'add_extra', qty_required: 2, add_amount: 1 },
      originalPrice: 5,
      poolLabel: null,
      isStackable: false,
    };
    const r = computeBest([o], {})!;
    expect(r.bundleTotal).toBe(6);
  });

  it('B4 buy_m_get_n: 买3送1, 总价 = 3×6.5 = 19.5, qty=4', () => {
    const o: PricerOffer = {
      activityType: 'weekend_beer',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: 3, n: 1 },
      originalPrice: 6.5,
      poolLabel: null,
      isStackable: false,
    };
    const r = computeBest([o], {})!;
    expect(r.bundleTotal).toBe(19.5);
    expect(r.qty).toBe(4);
  });

  it('空 → null', () => {
    expect(computeBest([], {})).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试验失败**

```bash
npm run -w apps/api test -- "pricer/stacking"
```

Expected: FAIL

- [ ] **Step 3: 实现 stacking.ts**

```ts
// apps/api/src/services/promo/pricer/stacking.ts
import type { PromoActivityType, PromoMechanic, PromoMechanicParams } from '@myj/shared';

export interface PricerOffer {
  activityType: PromoActivityType;
  mechanic: PromoMechanic;
  mechanicParams: PromoMechanicParams;
  originalPrice: number;
  poolLabel: string | null;
  isStackable: boolean;
}

const BASE_TYPES = new Set<PromoActivityType>(['member_price', 'weekend_beer']);

function bundleTotal(p: PromoMechanicParams, original: number): { total: number; qty: number } {
  switch (p.kind) {
    case 'flat_price':       return { total: p.target_price, qty: 1 };
    case 'percent_discount': return { total: original * p.pay_ratio, qty: 1 };
    case 'pool_threshold':   return { total: original, qty: 1 };
    case 'bundle_price':
      switch (p.subtype) {
        case 'fixed_total':  return { total: p.total_price, qty: p.qty_required };
        case 'nth_ratio':    return { total: (p.qty_required - 1) * original + original * p.ratio, qty: p.qty_required };
        case 'add_extra':    return { total: original + p.add_amount, qty: p.qty_required };
        case 'buy_m_get_n':  return { total: p.m * original, qty: p.m + p.n };
      }
  }
}

export function computeBest(
  offers: PricerOffer[],
  _poolPeers: Record<string, number[]>,
): {
  baseIdx: number;
  addonIdx: number | null;
  bundleTotal: number;
  qty: number;
  unitPrice: number;
  savingPercent: number;
} | null {
  if (offers.length === 0) return null;
  const bases: number[] = [];
  const addons: number[] = [];
  for (let i = 0; i < offers.length; i++) {
    if (BASE_TYPES.has(offers[i]!.activityType)) bases.push(i);
    else if (offers[i]!.isStackable) addons.push(i);
    else bases.push(i);  // 非 base 且不可叠 → 也作为 base 候选（独立活动）
  }

  let best: {
    baseIdx: number; addonIdx: number | null;
    bundleTotal: number; qty: number; unitPrice: number; savingPercent: number;
  } | null = null;

  for (const bi of bases) {
    const b = offers[bi]!;
    const baseRes = bundleTotal(b.mechanicParams, b.originalPrice);
    const candidates: Array<{ addonIdx: number | null; total: number }> = [{ addonIdx: null, total: baseRes.total }];
    for (const ai of addons) {
      const a = offers[ai]!;
      let total = baseRes.total;
      if (a.mechanic === 'percent_discount' && a.mechanicParams.kind === 'percent_discount') {
        total = baseRes.total * a.mechanicParams.pay_ratio;
      }
      // pool_threshold 不在单 sku 计算，调用方在池子层算
      candidates.push({ addonIdx: ai, total });
    }
    for (const c of candidates) {
      const unit = c.total / baseRes.qty;
      const saving = (b.originalPrice - unit) / b.originalPrice;
      if (!best || unit < best.unitPrice) {
        best = {
          baseIdx: bi,
          addonIdx: c.addonIdx,
          bundleTotal: c.total,
          qty: baseRes.qty,
          unitPrice: unit,
          savingPercent: saving,
        };
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: 跑测试**

```bash
npm run -w apps/api test -- "pricer/stacking"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/promo/pricer/stacking.ts \
        apps/api/src/services/promo/pricer/stacking.test.ts
git commit -m "feat(promo): 叠加 + 最优组合定价（pricer/stacking.ts）"
```

---

### Task 7: 默认文案（pricer/copy.ts）

**Files:**
- Create: `apps/api/src/services/promo/pricer/copy.ts`
- Create: `apps/api/src/services/promo/pricer/copy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function buildDefaultCopy(base: PricerOffer, addon: PricerOffer | null): string;
  ```

- [ ] **Step 1: 写测试**

```ts
// apps/api/src/services/promo/pricer/copy.test.ts
import { describe, it, expect } from 'vitest';
import { buildDefaultCopy } from './copy.js';
import type { PricerOffer } from './stacking.js';

describe('buildDefaultCopy', () => {
  it('会员价 B1 + 品牌满减券', () => {
    const base: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'fixed_total', qty_required: 2, total_price: 9.9 },
      originalPrice: 6.5, poolLabel: null, isStackable: false,
    };
    const addon: PricerOffer = {
      activityType: 'brand_coupon',
      mechanic: 'pool_threshold',
      mechanicParams: { kind: 'pool_threshold', threshold: 25, discount: 5 },
      originalPrice: 6.5, poolLabel: 'brand_coupon/百威系列', isStackable: true,
    };
    expect(buildDefaultCopy(base, addon)).toBe('会员价 2 件 9.9 元 到店领券 品牌满减券 满 25 减 5');
  });

  it('啤酒日 B4 单独', () => {
    const base: PricerOffer = {
      activityType: 'weekend_beer',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'buy_m_get_n', m: 3, n: 1 },
      originalPrice: 6.5, poolLabel: null, isStackable: false,
    };
    expect(buildDefaultCopy(base, null)).toBe('周末啤酒日 买 3 送 1');
  });

  it('会员价 B2 + 50% 折扣券', () => {
    const base: PricerOffer = {
      activityType: 'member_price',
      mechanic: 'bundle_price',
      mechanicParams: { kind: 'bundle_price', subtype: 'nth_ratio', qty_required: 2, nth: 2, ratio: 0.5 },
      originalPrice: 6.5, poolLabel: null, isStackable: false,
    };
    const addon: PricerOffer = {
      activityType: 'tuesday_member',
      mechanic: 'percent_discount',
      mechanicParams: { kind: 'percent_discount', pay_ratio: 0.5 },
      originalPrice: 6.5, poolLabel: null, isStackable: true,
    };
    expect(buildDefaultCopy(base, addon)).toBe('会员价 第 2 件半价 到店领券 周二会员日 50% 折');
  });

  it('flat_price A 单独', () => {
    const base: PricerOffer = {
      activityType: 'regular_coupon',
      mechanic: 'flat_price',
      mechanicParams: { kind: 'flat_price', target_price: 9.9 },
      originalPrice: 14.9, poolLabel: null, isStackable: false,
    };
    expect(buildDefaultCopy(base, null)).toBe('常规优惠券 特价 9.9 元/件');
  });
});
```

- [ ] **Step 2: 跑测试验失败**

```bash
npm run -w apps/api test -- "pricer/copy"
```

Expected: FAIL

- [ ] **Step 3: 实现 copy.ts**

```ts
// apps/api/src/services/promo/pricer/copy.ts
import type { PromoActivityType, PromoMechanicParams } from '@myj/shared';
import type { PricerOffer } from './stacking.js';

const TYPE_LABEL: Record<PromoActivityType, string> = {
  member_price: '会员价',
  weekend_beer: '周末啤酒日',
  brand_coupon: '品牌满减券',
  tuesday_member: '周二会员日',
  regular_coupon: '常规优惠券',
};

function fmtBase(t: PromoActivityType, p: PromoMechanicParams): string {
  const L = TYPE_LABEL[t];
  switch (p.kind) {
    case 'flat_price':       return `${L} 特价 ${p.target_price} 元/件`;
    case 'bundle_price':
      switch (p.subtype) {
        case 'fixed_total':  return `${L} ${p.qty_required} 件 ${p.total_price} 元`;
        case 'nth_ratio':    return `${L} 第 ${p.nth} 件半价`;
        case 'add_extra':    return `${L} 加 ${p.add_amount} 元多 1 件`;
        case 'buy_m_get_n':  return `${L} 买 ${p.m} 送 ${p.n}`;
      }
    case 'percent_discount': return `${L} ${Math.round(p.pay_ratio * 100)}% 折`;
    case 'pool_threshold':   return `${L} 满 ${p.threshold} 减 ${p.discount}`;
  }
}

function fmtAddon(t: PromoActivityType, p: PromoMechanicParams): string {
  const L = TYPE_LABEL[t];
  if (p.kind === 'percent_discount') return `${L} ${Math.round(p.pay_ratio * 100)}% 折`;
  if (p.kind === 'pool_threshold')   return `${L} 满 ${p.threshold} 减 ${p.discount}`;
  return `${L}`;  // 不应到这里——非可叠 add-on
}

export function buildDefaultCopy(base: PricerOffer, addon: PricerOffer | null): string {
  const baseStr = fmtBase(base.activityType, base.mechanicParams);
  if (!addon) return baseStr;
  return `${baseStr} 到店领券 ${fmtAddon(addon.activityType, addon.mechanicParams)}`;
}
```

- [ ] **Step 4: 跑测试**

```bash
npm run -w apps/api test -- "pricer/copy"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/promo/pricer/copy.ts \
        apps/api/src/services/promo/pricer/copy.test.ts
git commit -m "feat(promo): 默认促销文案模板（pricer/copy.ts）"
```

---

### Task 8: Service 重写（promotions.service.ts）

**Files:**
- Modify: `apps/api/src/services/promotions.service.ts`（整体替换）

**Interfaces:**
- Consumes: `parseWorkbook` (Task 5), `computeBest` (Task 6), `buildDefaultCopy` (Task 7), pg pool（`./db/index.js`）
- Produces:
  ```ts
  export async function uploadPromotion(input: { fileBuffer: Buffer; fileName: string; sourceFileUrl?: string; notes?: string }, userId: string): Promise<UploadResult>;
  export async function listBatches(limit?: number): Promise<PromoBatch[]>;
  export async function listActivePromotions(): Promise<ActivePromotionsResponse>;
  export async function recommendForUser(userId: string): Promise<RecommendPromotionsResponse>;
  export async function setBatchVoided(batchId: string, voided: boolean): Promise<PromoBatch>;
  export async function deleteBatch(batchId: string): Promise<{ deleted: boolean }>;
  ```

- [ ] **Step 1: 整体重写 promotions.service.ts**

把 `apps/api/src/services/promotions.service.ts` 全部内容替换为新实现（旧 471 行删完）。核心结构：

```ts
import { query, withTransaction } from '../db/index.js';
import type {
  PromoBatch, PromoBestResult, PromoMechanicParams,
  ActivePromotionsResponse, RecommendPromotionsResponse, UploadResult,
} from '@myj/shared';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { parseWorkbook } from './promo/parser/index.js';
import { computeBest, type PricerOffer } from './promo/pricer/stacking.js';
import { buildDefaultCopy } from './promo/pricer/copy.js';

export async function uploadPromotion(
  input: { fileBuffer: Buffer; fileName: string; sourceFileUrl?: string; notes?: string },
  userId: string,
): Promise<UploadResult> {
  const parsed = parseWorkbook(input.fileBuffer);
  if (parsed.rawItems.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Excel 中无有效行');
  }

  const rowTotal: Record<string, number> = {};
  const parsedTotal: Record<string, number> = {};
  for (const r of parsed.rawItems) rowTotal[r.activityType] = (rowTotal[r.activityType] ?? 0) + 1;
  for (const o of parsed.offers) parsedTotal[o.activityType] = (parsedTotal[o.activityType] ?? 0) + 1;

  const windowStart = parsed.rawItems.reduce((d, r) => r.validFrom < d ? r.validFrom : d, parsed.rawItems[0]!.validFrom);
  const windowEnd   = parsed.rawItems.reduce((d, r) => r.validTo   > d ? r.validTo   : d, parsed.rawItems[0]!.validTo);

  return withTransaction(async (client) => {
    const bRes = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO hq_promo_batches
         (file_name, source_file_url, uploaded_by, activity_window_start, activity_window_end,
          parse_warnings, row_total, parsed_total, parsed_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb, now(), $9)
       RETURNING id, created_at`,
      [
        input.fileName, input.sourceFileUrl ?? null, userId,
        windowStart, windowEnd,
        JSON.stringify(parsed.warnings),
        JSON.stringify(rowTotal),
        JSON.stringify(parsedTotal),
        input.notes ?? null,
      ],
    );
    const batchId = bRes.rows[0]!.id;

    // 写 raw_items → 拿到 id 映射
    const rawIdBySheetRowNo = new Map<number, string>();
    for (const r of parsed.rawItems) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO hq_promo_raw_items
           (batch_id, activity_type, sheet_row_no, sku_code, sku_name_original, unit,
            original_price, raw_method_text, qty_required, promo_total_price,
            promo_group_code, category_code, category_name, valid_from, valid_to,
            fill_down_anchor_row)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          batchId, r.activityType, r.sheetRowNo, r.skuCode, r.skuNameOriginal, r.unit,
          r.originalPrice, r.rawMethodText, r.qtyRequired, r.promoTotalPrice,
          r.promoGroupCode, r.categoryCode, r.categoryName, r.validFrom, r.validTo,
          r.fillDownAnchorRow,
        ],
      );
      rawIdBySheetRowNo.set(r.sheetRowNo, res.rows[0]!.id);
    }

    // 写 offers
    for (const o of parsed.offers) {
      const rawId = rawIdBySheetRowNo.get(o.rawItemSheetRowNo)!;
      await client.query(
        `INSERT INTO hq_promo_offers
           (raw_item_id, batch_id, activity_type, sku_code, mechanic, mechanic_params,
            pool_label, original_price, valid_weekday_mask, valid_from, valid_to,
            is_stackable, parse_note)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
        [
          rawId, batchId, o.activityType, o.skuCode, o.mechanic, JSON.stringify(o.mechanicParams),
          o.poolLabel, o.originalPrice, o.validWeekdayMask, o.validFrom, o.validTo,
          o.isStackable, o.parseNote,
        ],
      );
    }

    const batch = await loadBatch(client, batchId);
    return { batch, warnings: parsed.warnings };
  });
}

interface BatchRow {
  id: string; file_name: string; source_file_url: string | null; uploaded_by: string | null;
  is_voided: boolean; activity_window_start: string | null; activity_window_end: string | null;
  parse_warnings: unknown; row_total: unknown; parsed_total: unknown; parsed_at: string | null;
  notes: string | null; created_at: string;
}
function mapBatch(r: BatchRow): PromoBatch {
  return {
    id: r.id, fileName: r.file_name, sourceFileUrl: r.source_file_url, uploadedBy: r.uploaded_by,
    isVoided: r.is_voided, activityWindowStart: r.activity_window_start, activityWindowEnd: r.activity_window_end,
    parseWarnings: (r.parse_warnings as PromoBatch['parseWarnings']) ?? [],
    rowTotal: (r.row_total as PromoBatch['rowTotal']) ?? ({} as PromoBatch['rowTotal']),
    parsedTotal: (r.parsed_total as PromoBatch['parsedTotal']) ?? ({} as PromoBatch['parsedTotal']),
    parsedAt: r.parsed_at, notes: r.notes, createdAt: r.created_at,
  };
}

async function loadBatch(client: { query: typeof query } | { query: (...a: unknown[]) => Promise<unknown> }, batchId: string): Promise<PromoBatch> {
  const r = await (client as { query: typeof query }).query<BatchRow>(
    `SELECT id, file_name, source_file_url, uploaded_by, is_voided,
            activity_window_start, activity_window_end, parse_warnings,
            row_total, parsed_total, parsed_at, notes, created_at
       FROM hq_promo_batches WHERE id = $1`,
    [batchId],
  );
  return mapBatch(r.rows[0]!);
}

export async function listBatches(limit = 50): Promise<PromoBatch[]> {
  const res = await query<BatchRow>(
    `SELECT id, file_name, source_file_url, uploaded_by, is_voided,
            activity_window_start, activity_window_end, parse_warnings,
            row_total, parsed_total, parsed_at, notes, created_at
       FROM hq_promo_batches ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 200)],
  );
  return res.rows.map(mapBatch);
}

interface OfferRow {
  id: string; batch_id: string; activity_type: string; sku_code: string;
  mechanic: string; mechanic_params: PromoMechanicParams; pool_label: string | null;
  original_price: string; is_stackable: boolean;
}
interface ProductCtxRow { sku_code: string; product_name: string; unit: string | null; category_name: string | null; }

async function buildResults(): Promise<{ batches: PromoBatch[]; results: PromoBestResult[] }> {
  const batches = await listBatches();
  const offersRes = await query<OfferRow>(
    `SELECT id, batch_id, activity_type, sku_code, mechanic, mechanic_params,
            pool_label, original_price, is_stackable
       FROM v_active_offers`,
  );
  if (offersRes.rows.length === 0) return { batches, results: [] };

  const skuCodes = Array.from(new Set(offersRes.rows.map((r) => r.sku_code)));
  const ctxRes = await query<ProductCtxRow>(
    `SELECT p.sku_code, p.product_name, p.unit, c.category_name
       FROM hq_products p
  LEFT JOIN hq_categories c ON c.id = p.category_id
      WHERE p.sku_code = ANY($1)`,
    [skuCodes],
  );
  const ctx = new Map(ctxRes.rows.map((r) => [r.sku_code, r]));

  const offersBySku = new Map<string, OfferRow[]>();
  for (const o of offersRes.rows) {
    if (!offersBySku.has(o.sku_code)) offersBySku.set(o.sku_code, []);
    offersBySku.get(o.sku_code)!.push(o);
  }

  const results: PromoBestResult[] = [];
  for (const [sku, rows] of offersBySku) {
    const pricerOffers: PricerOffer[] = rows.map((r) => ({
      activityType: r.activity_type as PricerOffer['activityType'],
      mechanic: r.mechanic as PricerOffer['mechanic'],
      mechanicParams: r.mechanic_params,
      originalPrice: parseFloat(r.original_price),
      poolLabel: r.pool_label,
      isStackable: r.is_stackable,
    }));
    const best = computeBest(pricerOffers, {});
    if (!best) continue;
    const baseOffer = pricerOffers[best.baseIdx]!;
    const addonOffer = best.addonIdx != null ? pricerOffers[best.addonIdx]! : null;
    const c = ctx.get(sku);
    results.push({
      skuCode: sku,
      productName: c?.product_name ?? sku,
      unit: c?.unit ?? null,
      categoryName: c?.category_name ?? null,
      originalPrice: baseOffer.originalPrice,
      baseOfferId: rows[best.baseIdx]!.id,
      addonOfferId: best.addonIdx != null ? rows[best.addonIdx]!.id : null,
      bestUnitPrice: best.unitPrice,
      bestBundleTotal: best.bundleTotal,
      bestQty: best.qty,
      bestSavingPercent: best.savingPercent,
      defaultCopy: buildDefaultCopy(baseOffer, addonOffer),
      poolLabel: baseOffer.poolLabel,
      poolSize: null,  // 池子大小本期不算（UI 可后续按 pool_label 自行 group by）
    });
  }
  results.sort((a, b) => b.bestSavingPercent - a.bestSavingPercent);
  return { batches, results };
}

export async function listActivePromotions(): Promise<ActivePromotionsResponse> {
  return buildResults();
}

export async function recommendForUser(userId: string): Promise<RecommendPromotionsResponse> {
  const { batches, results } = await buildResults();
  if (results.length === 0) return { batches, results };
  const usedRes = await query<{ category_name: string; cnt: number }>(
    `SELECT c.category_name, COUNT(*)::int AS cnt
       FROM store_poster_tasks t
       JOIN store_poster_task_products tp ON tp.task_id = t.id
       JOIN hq_products p ON p.id = tp.product_id
       LEFT JOIN hq_categories c ON c.id = p.category_id
      WHERE t.user_id = $1 AND c.category_name IS NOT NULL
        AND t.created_at >= now() - INTERVAL '30 days'
   GROUP BY c.category_name`,
    [userId],
  );
  const rank = new Map(usedRes.rows.map((r) => [r.category_name, r.cnt]));
  const sorted = [...results].sort((a, b) => {
    const ra = rank.get(a.categoryName ?? '') ?? 0;
    const rb = rank.get(b.categoryName ?? '') ?? 0;
    if (ra !== rb) return rb - ra;
    return b.bestSavingPercent - a.bestSavingPercent;
  });
  return { batches, results: sorted };
}

export async function setBatchVoided(batchId: string, voided: boolean): Promise<PromoBatch> {
  const res = await query<BatchRow>(
    `UPDATE hq_promo_batches SET is_voided = $1, updated_at = now()
      WHERE id = $2
   RETURNING id, file_name, source_file_url, uploaded_by, is_voided,
             activity_window_start, activity_window_end, parse_warnings,
             row_total, parsed_total, parsed_at, notes, created_at`,
    [voided, batchId],
  );
  if (res.rows.length === 0) throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
  return mapBatch(res.rows[0]!);
}

export async function deleteBatch(batchId: string): Promise<{ deleted: boolean }> {
  const res = await query(`DELETE FROM hq_promo_batches WHERE id = $1`, [batchId]);
  return { deleted: (res.rowCount ?? 0) > 0 };
}
```

- [ ] **Step 2: typecheck**

```bash
npm run -w apps/api typecheck
```

Expected: `promotions.routes.ts` 和 `promotions.integration.test.ts` 还报错（引用旧函数签名）；其它 PASS。后续 Task 修。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/promotions.service.ts
git commit -m "feat(promo): service 整体重写 — 多 batch + 计算层 + 文案拼装"
```

---

### Task 9: Route 改 multipart 上传

**Files:**
- Modify: `apps/api/src/routes/promotions.routes.ts`（整体替换）

**Interfaces:**
- Consumes: service exports（Task 8）

- [ ] **Step 1: 替换 routes 文件**

```ts
// apps/api/src/routes/promotions.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import {
  uploadPromotion, listBatches, listActivePromotions, recommendForUser,
  setBatchVoided, deleteBatch,
} from '../services/promotions.service.js';

export const promotionsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
}

promotionsRouter.post(
  '/promotions/batches:upload',
  requireAuth,
  requireRole('super_admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, ErrorCodes.BAD_REQUEST, '缺少 file 字段');
    const result = await uploadPromotion(
      {
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        sourceFileUrl: typeof req.body.sourceFileUrl === 'string' ? req.body.sourceFileUrl : undefined,
        notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      },
      req.user!.id,
    );
    res.status(201).json(result);
  }),
);

promotionsRouter.get(
  '/promotions/batches',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || undefined;
    res.json({ batches: await listBatches(limit) });
  }),
);

promotionsRouter.get(
  '/promotions/active',
  requireAuth,
  asyncHandler(async (_req, res) => res.json(await listActivePromotions())),
);

promotionsRouter.get(
  '/promotions/recommend',
  requireAuth,
  asyncHandler(async (req, res) => res.json(await recommendForUser(req.user!.id))),
);

promotionsRouter.post(
  '/promotions/batches/:batchId/void',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    res.json({ batch: await setBatchVoided(req.params.batchId!, true) });
  }),
);

promotionsRouter.post(
  '/promotions/batches/:batchId/unvoid',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    res.json({ batch: await setBatchVoided(req.params.batchId!, false) });
  }),
);

promotionsRouter.delete(
  '/promotions/batches/:batchId',
  requireAuth, requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const r = await deleteBatch(req.params.batchId!);
    if (!r.deleted) throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    res.json(r);
  }),
);
```

- [ ] **Step 2: typecheck**

```bash
npm run -w apps/api typecheck
```

Expected: 只剩 `promotions.integration.test.ts` 报错。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/promotions.routes.ts
git commit -m "feat(promo): routes 改 multipart 上传 + void/unvoid 替换 activate"
```

---

### Task 10: Integration test（用真实 Excel 文件）

**Files:**
- Modify: `apps/api/src/routes/promotions.integration.test.ts`（整体替换）

**Interfaces:**
- Consumes: route + service exports
- Test fixture：`6月下营销活动（会员价+叠券）.xlsx`（仓库根目录已有）

- [ ] **Step 1: 写测试**

```ts
// apps/api/src/routes/promotions.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../app.js';
import { query } from '../db/index.js';
import { issueAccessToken } from '../services/auth.token.service.js';

const FIXTURE = path.resolve(process.cwd(), '../../6月下营销活动（会员价+叠券）.xlsx');

describe('POST /promotions/batches:upload', () => {
  let cookie: string;
  beforeAll(async () => {
    await query(`DELETE FROM hq_promo_batches`);  // 老数据丢弃
    const userId = '11111111-1111-4111-8111-111111111111';  // dev seed 超管
    const token = await issueAccessToken({ id: userId, role: 'super_admin' });
    cookie = `myj_token=${token}`;
  });
  afterAll(async () => { await query(`DELETE FROM hq_promo_batches`); });

  it('上传真实 Excel: 5 sheet 全解析 + 批次 + 档案 + offer 入库', async () => {
    const buf = fs.readFileSync(FIXTURE);
    const res = await request(app)
      .post('/api/v1/promotions/batches:upload')
      .set('Cookie', cookie)
      .attach('file', buf, '6月下营销活动.xlsx')
      .expect(201);

    expect(res.body.batch).toBeDefined();
    expect(res.body.batch.rowTotal.member_price).toBeGreaterThan(1000);
    expect(res.body.batch.rowTotal.weekend_beer).toBeGreaterThan(50);
    expect(res.body.batch.rowTotal.brand_coupon).toBeGreaterThan(300);
    expect(res.body.batch.rowTotal.tuesday_member).toBeGreaterThan(20);
    expect(res.body.batch.rowTotal.regular_coupon).toBeGreaterThan(30);

    const rawCount = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM hq_promo_raw_items`);
    expect(rawCount.rows[0]!.c).toBeGreaterThan(1100);

    const offerCount = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM hq_promo_offers`);
    expect(offerCount.rows[0]!.c).toBeGreaterThan(1000);

    // 抽查：百威系列池里应有 ≥10 个 sku
    const pool = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM hq_promo_offers WHERE pool_label LIKE 'brand_coupon/百威系列%'`,
    );
    expect(pool.rows[0]!.c).toBeGreaterThanOrEqual(10);
  }, 30_000);

  it('GET /promotions/active 返回 results', async () => {
    const res = await request(app)
      .get('/api/v1/promotions/active')
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(res.body.batches)).toBe(true);
    // 注意：v_active_offers 受 current_date 过滤 — 若今天不在活动窗,results 可能空
    expect(Array.isArray(res.body.results)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
npm run -w apps/api test -- promotions.integration
```

Expected: PASS（实际数：会员价 1030, 啤酒日 73, 满减券 364, 周二 27, 常规 35 — 都在 expect 阈值之上）

> 若 `current_date` 不在 2026-06-01 ~ 2026-06-30 窗内,第二个 it 的 `results` 可能为空——这是预期,不要为此改测试断言。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/promotions.integration.test.ts
git commit -m "test(promo): 真实 Excel 上传集成测试 — 5 sheet 全解析对账"
```

---

### Task 11: 前端 api-client + shim 适配

**Files:**
- Modify: `apps/web/src/lib/api-client.ts:353-360`（promotionsApi 段）
- Modify: `apps/web/src/lib/promotions.functions.ts`（rowToCategoryItem 适配新 `PromoBestResult` shape）

**Interfaces:**
- Consumes: `PromoBestResult` (Task 2)
- Produces: `promotionsApi.upload(file: File): Promise<UploadResult>`；shim 仍输出 `PersonalizedPromotionsResult`

- [ ] **Step 1: 改 api-client.ts**

找 `export const promotionsApi = {` 整段替换：

```ts
import type {
  ActivePromotionsResponse, RecommendPromotionsResponse, UploadResult,
} from '@myj/shared';

export const promotionsApi = {
  active: () => request<ActivePromotionsResponse>('/promotions/active'),
  recommend: () => request<RecommendPromotionsResponse>('/promotions/recommend'),
  upload: async (file: File): Promise<UploadResult> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/v1/promotions/batches:upload', {
      method: 'POST', credentials: 'include', body: fd,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return res.json();
  },
  batches: () => request<{ batches: import('@myj/shared').PromoBatch[] }>('/promotions/batches'),
  void: (id: string) => request<{ batch: import('@myj/shared').PromoBatch }>(`/promotions/batches/${id}/void`, { method: 'POST' }),
};
```

- [ ] **Step 2: 改 promotions.functions.ts 适配新 shape**

把 `rowToCategoryItem` 改为吃 `PromoBestResult` 而不是旧 `ProductPromotion`；`getPersonalizedPromotions` 内部读 `body.results` 而不是 `body.products`。

```ts
// 顶部 import 改：
import type {
  ActivePromotionsResponse, PromoBestResult,
  RecommendPromotionsResponse,
} from '@myj/shared';

// rowToCategoryItem 改：
function rowToCategoryItem(p: PromoBestResult): CategoryItem {
  return {
    sku: p.skuCode,
    product_name: p.productName,
    unit: p.unit ?? null,
    original_price: p.originalPrice,
    category: p.categoryName ?? null,
    best_label: p.defaultCopy,
    best_qty: p.bestQty,
    best_total: p.bestBundleTotal,
    best_effective_price: p.bestUnitPrice,
    best_saving_percent: p.bestSavingPercent,
    display_text: p.defaultCopy,
    best_valid_from: null,  // 新 shape 不带；poster 用 batch 窗
    best_valid_to: null,
    best_valid_dates: null,
    all_options: null,
  };
}

// getPersonalizedPromotions 内部：
let results: PromoBestResult[] = [];
let upload: { id: string; filename: string; created_at: string } | null = null;

const recoRes = await fetch(`${BASE}/promotions/recommend`, { credentials: 'include' });
if (recoRes.ok) {
  const body = (await recoRes.json()) as RecommendPromotionsResponse;
  results = body.results ?? [];
  const first = body.batches?.[0];
  if (first) upload = { id: first.id, filename: first.fileName, created_at: first.createdAt };
}
if (results.length === 0) {
  const actRes = await fetch(`${BASE}/promotions/active`, { credentials: 'include' });
  if (actRes.ok) {
    const body = (await actRes.json()) as ActivePromotionsResponse;
    results = body.results ?? [];
    const first = body.batches?.[0];
    if (first) upload = { id: first.id, filename: first.fileName, created_at: first.createdAt };
  }
}

const byCategory = new Map<string, CategoryItem[]>();
const pushTo = (g: string, item: CategoryItem) => {
  if (!byCategory.has(g)) byCategory.set(g, []);
  byCategory.get(g)!.push(item);
};
for (const p of results) {
  const item = rowToCategoryItem(p);
  pushTo(mapCategoryToGroup(item.category ?? ''), item);
}
const categories = Array.from(byCategory.entries()).map(([name, items]) => ({ name, items }));
return { upload, categories };
```

> 把旧的 `groups` 循环、`skuToProduct` 反查、`is_group` 块全删——新 shape 不再单独输出"凑单组卡"，池子用单 sku 卡逐个展示。

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

Expected: PASS（如果还有报错,通常是 `ProductPromotion / PromotionGroupRow / ProductPromotionDealOption` 残留引用——删干净）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/promotions.functions.ts
git commit -m "feat(web): 促销 shim 改读新 results shape — 文案直接取 defaultCopy"
```

---

### Task 12: Admin 上传页

**Files:**
- Create: `apps/web/src/routes/admin.promotions.tsx`
- Modify: `apps/web/src/routes/admin.index.tsx`（加入口）

**Interfaces:**
- Consumes: `promotionsApi.upload / batches / void`

- [ ] **Step 1: 写上传页**

```tsx
// apps/web/src/routes/admin.promotions.tsx
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IOSDevice } from '@/components/IOSDevice';
import { promotionsApi } from '@/lib/api-client';

export const Route = createFileRoute('/admin/promotions')({ component: PromoUploadPage });

function PromoUploadPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const batchesQ = useQuery({ queryKey: ['promo','batches'], queryFn: () => promotionsApi.batches() });
  const uploadM = useMutation({
    mutationFn: (f: File) => promotionsApi.upload(f),
    onSuccess: () => { setFile(null); qc.invalidateQueries({ queryKey: ['promo','batches'] }); },
  });

  return (
    <IOSDevice>
      <div className="h-full bg-background flex flex-col">
        <header className="flex items-center gap-3 px-[22px] pt-3 pb-2">
          <Link to="/admin" className="w-[38px] h-[38px] rounded-xl bg-surface border border-hairline flex items-center justify-center">
            <ArrowLeft size={18} className="text-ink" />
          </Link>
          <div className="text-[16px] font-semibold text-ink">促销上传</div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
          <div className="bg-surface rounded-2xl p-4 border border-hairline">
            <input
              type="file" accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[13px]"
            />
            <button
              disabled={!file || uploadM.isPending}
              onClick={() => file && uploadM.mutate(file)}
              className="mt-3 px-4 py-2 rounded-xl bg-primary text-white text-[13px] disabled:opacity-40"
            >
              {uploadM.isPending ? '解析中…' : '上传 + 解析'}
            </button>
            {uploadM.isError && <div className="mt-2 text-[12px] text-red-500">{(uploadM.error as Error).message}</div>}
            {uploadM.data && (
              <div className="mt-3 text-[12px] text-ink-2 space-y-1">
                <div>批次: {uploadM.data.batch.fileName}</div>
                <div>各 sheet 行数: {JSON.stringify(uploadM.data.batch.rowTotal)}</div>
                <div>各 sheet 入优惠数: {JSON.stringify(uploadM.data.batch.parsedTotal)}</div>
                {uploadM.data.warnings.length > 0 && (
                  <div className="text-amber-600">告警 {uploadM.data.warnings.length} 条</div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5">
            <div className="text-[13px] font-semibold text-ink mb-2">历史批次</div>
            <div className="space-y-2">
              {(batchesQ.data?.batches ?? []).map((b) => (
                <div key={b.id} className="bg-surface rounded-xl p-3 border border-hairline text-[12px]">
                  <div className="font-medium text-ink truncate">{b.fileName}</div>
                  <div className="text-ink-2 mt-1">
                    {b.activityWindowStart} ~ {b.activityWindowEnd} · {b.isVoided ? '已作废' : '生效中'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </IOSDevice>
  );
}
```

- [ ] **Step 2: 改 admin.index.tsx 加入口**

把"M5 即将开放"那个占位 div 替换成一个链接卡片：

```tsx
<div className="flex-1 px-5 pt-3">
  <Link to="/admin/promotions" className="block bg-surface rounded-2xl p-4 border border-hairline">
    <div className="text-[14px] font-semibold text-ink">促销上传</div>
    <div className="text-[12px] text-ink-2 mt-1">上传月度活动 Excel，解析存档案 + 优惠层</div>
  </Link>
</div>
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/admin.promotions.tsx apps/web/src/routes/admin.index.tsx
git commit -m "feat(web): admin 促销上传页 — 文件选择 + 解析告警 + 历史列表"
```

---

### Task 13: 本地烟测 + 真实文件验收

> 这一步是验收闸门。前面 Task 都纯后端/类型层,可自测 PASS 即过。这一步要在本地起前端 + 后端,实际点上传按钮,看 UI 行为。

- [ ] **Step 1: 起容器**

```bash
docker compose up -d
docker exec myj-api npm run migrate  # 确保 V029 已跑
npm run -w apps/web dev  # 前端
```

- [ ] **Step 2: 浏览器走一遍**

1. 登录超管账号 → 进 `/admin/promotions`
2. 选 `6月下营销活动（会员价+叠券）.xlsx` → 点上传 + 解析
3. 看返回的 `rowTotal` / `parsedTotal` 是否与预期相符（会员价 1030 / 啤酒日 73 / 满减券 364 / 周二 27 / 常规 35）
4. 看告警 数 是否合理（< 50 条算正常）
5. 回 store 端 → 进海报选品页,看促销卡片是否带出新 `defaultCopy`（如"会员价 2 件 9.9 元 到店领券 品牌满减券 满 25 减 5"）

- [ ] **Step 3: 报告本地状态**

如果以上 1-5 均通过：

```
✅ 上传 OK, parsedTotal: {member_price: 1030, weekend_beer: 73, ...}
✅ 海报页面 defaultCopy 显示正常
```

请运营/产品确认即可。如果 4 (告警) 或 5 (文案) 不符合预期：

- 告警太多 → 检查 `mechanic.ts` 的正则未覆盖的话术,补 case + 测试 + 再跑 Task 3 测试 PASS,然后回到本 Task Step 2
- 文案不对 → 检查 `pricer/copy.ts` 模板,改后跑 Task 7 测试

- [ ] **Step 4: 提 PR**

```bash
git checkout -b feat/promo-data-redesign-2026-06-17
git push -u origin feat/promo-data-redesign-2026-06-17
gh pr create --title "feat(promo): 数据重构 — 5 sheet 上传 + 4 类机制 + 多批次共存" --body "$(cat <<'EOF'
## Summary
- V029: 重建 hq_promo_batches + 新增 raw_items / offers + v_active_offers 视图,老数据丢弃
- 4 类机制 (flat_price / bundle_price / percent_discount / pool_threshold) 覆盖实测 14 种话术
- 后端解析 5 sheet 含 fill-down + 星期掩码 + buy_m_get_n 对账
- 定价器: base + 至多一个 add-on, 选最低单价摊销
- 默认文案 templates: 用户给的"会员价 2 瓶 n 元 到店领券 品牌满减券满 25 减 5"格式
- Frontend shim 适配新 results shape, 老 groups 块删除
- Admin 上传页: 文件选择 + 解析告警 + 历史批次列表

## Spec
docs/superpowers/specs/2026-06-17-promo-data-redesign-design.md

## Test plan
- [x] 单测: mechanic.test / xlsx.test / parser/index.test / pricer/stacking.test / pricer/copy.test
- [x] 集成: promotions.integration.test 用真实 Excel 跑通
- [x] 本地: admin 上传页 + 海报页文案 烟测
EOF
)"
```

---

## Self-Review

### 1. Spec coverage
- ✅ 多 batch 共存 — V029 删 UNIQUE active,加 is_voided（Task 1）
- ✅ 5 sheet 解析 — readWorkbook（Task 4）+ parseWorkbook（Task 5）
- ✅ 4 类机制 — mechanic.ts 测试覆盖 27+ 用例（Task 3）
- ✅ B 子类型 fixed_total / nth_ratio / add_extra / buy_m_get_n — mechanic.ts + stacking.ts（Task 6）
- ✅ fill-down 处理 — parseWorkbook brand_coupon 分支（Task 5）
- ✅ 星期掩码 — weekdayMask 函数（Task 5）
- ✅ buy_m_get_n 对账 — 解析时检查 m × original_price vs promo_total_price（Task 5）
- ✅ 池子标签 — poolLabel 函数（Task 5）
- ✅ 叠加矩阵 base + ≤1 add-on — computeBest（Task 6）
- ✅ 默认文案拼装 — buildDefaultCopy（Task 7）
- ✅ v_active_offers 视图 — Task 1 SQL
- ✅ Multipart upload — Task 9 + multer
- ✅ 前端 shim 适配 — Task 11
- ✅ Admin 上传页 — Task 12
- ✅ 老数据丢弃 — Task 1 DROP CASCADE + Task 10 集成测前 DELETE
- ✅ V029 编号 — Task 1
- ⚠️ "1 raw 出多 offer" 兼容性：保留外键 1:N 能力,但当前实现只产 1:1 — 符合本期 Excel 实测,未来扩展不需要 schema 改

### 2. Placeholder scan
无 TBD / TODO / "TODO later"；所有代码块完整可粘贴。

### 3. Type consistency
- `PricerOffer` 在 Task 6 定义,Task 7 importing 一致
- `PromoBestResult.baseOfferId` Task 2 定义,Task 8 use,Task 11 shim 不直接读 baseOfferId 而是 defaultCopy — 一致
- `RawSheetRow.validFrom` 是 Date(Task 4) → Task 5 透传 → Task 8 写 pg 走 ISO 字符串隐式转换 OK
- ENUM 值字符串在 SQL / TS / 解析器全用同一组语义名 — 一致

---

## 待办出现新问题时

- 如果上传时 pg 报 `current transaction is aborted, commands ignored`（25P02）：检查 raw → offer 写入循环,加 SAVEPOINT 包裹每条 INSERT。本计划未默认加,因 raw_items 字段都已 not-null 校验,理论上不该抛。
- 如果话术正则误匹配（如"加 1 元多 1 包"被 fixed_total 抢先吃了）：调整 PATTERNS 顺序,把更具体的优先级提高,补 mechanic.test 新 case 锁定。
- 如果 admin 页 IOSDevice 框比例错乱：确认外层是 `<IOSDevice>` 包裹（[[feedback-iosdevice-wrap]]）。
