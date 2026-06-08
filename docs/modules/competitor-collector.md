# 竞品采集模块 · 模块所有者文档

> 这份文档给即将开发"竞品信息采集"的同事看。读完你能知道：你要写哪些表、必须遵守什么约束、什么时候、以什么形态把代码并到本仓。

---

## 模块定位

**职责**：采集外部渠道（罗森、7-11、天猫超市、京东超市等）的竞品商品信息和价格，写入统一数据库，供选品 / 价盘 / 海报模块消费。

**输入**：你自己的采集源（爬虫、第三方 API、CSV 导入、人工录入）

**输出**：写入下面两张维度表

```
dim_competitor_channel     ← 你登记新渠道
       ↓ (channel_id FK)
dim_competitor_product     ← 你登记竞品商品并映射到我们的 SKU
```

> `fact_competitor_price_weekly`（价格快照表）不归你写，由后续的价盘 / 调度任务统一维护。你只负责把"有哪些渠道、哪些竞品商品、它们对应我们哪个 SKU"这部分维度数据做准做全。

定义位置：
- 主表：[V005__competitor.sql](../../apps/api/src/db/migrations/V005__competitor.sql)
- 增量字段：[V020__competitor_extras.sql](../../apps/api/src/db/migrations/V020__competitor_extras.sql) — 给 `dim_competitor_product` 加 `series` 列

依赖的两张主数据表（你只读，不写）：
- `dim_product`（[V004](../../apps/api/src/db/migrations/V004__dim_master_data.sql)）—— 我们自己的 SKU，竞品商品的 `mapped_product_id` 指向它
- `dim_category`（同上）—— 商品分类树

---

## 怎么开始（在主仓内开发）

### 1. 把本仓 clone 下来

```bash
git clone https://github.com/rollingai-myj/integratedApp.git
cd integratedApp
```

### 2. 跑起 M0 环境

完全按 [README.md](../../README.md) 的"Quickstart"步骤来：

```bash
npm install
docker compose up -d                  # 起本地 Postgres（5432）
cp apps/api/.env.example apps/api/.env
npm run -w apps/api migrate           # 跑 V001-V020，建好 35 张表
```

跑完之后 `dim_competitor_channel` / `dim_competitor_product` / `fact_competitor_price_weekly` 三张表就都建好了，但**默认是空的**——V015 种子里没有渠道数据，老库的 9 条真实渠道（罗森、7-11、天猫超市等）只在 prod 数据库里，需要跑 [`apps/api/scripts/migrate-from-legacy-db.ts`](../../apps/api/scripts/migrate-from-legacy-db.ts) 才能迁过来，而你本地一般连不到 prod。

### 3. 验证表建好了 + 自己塞一条渠道

先确认三张表都在：

```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "\dt dim_competitor_*"
docker exec myj-postgres psql -U myj -d myj_dev -c "\dt fact_competitor_*"
```

塞一条你打算开发的渠道（以天猫超市为例），后续 adapter 就用这个 `channel_id`：

```bash
docker exec myj-postgres psql -U myj -d myj_dev -c "
  INSERT INTO dim_competitor_channel (channel_code, channel_name, kind, price_uniform)
  VALUES ('TMALL_SUPER', '天猫超市', 'online', TRUE)
  ON CONFLICT (channel_code) DO NOTHING
  RETURNING id, channel_code, channel_name;
"
```

> 想要主仓那 9 条真实渠道的清单（名称 + 编码 + kind）做参考？开 issue 找仓库 owner 要，会贴一份 INSERT 给你。

### 4. 把你的代码放在哪里

推荐目录：`apps/collector/`，自己开一个 npm workspace。结构参考 `apps/api/`：

```
apps/collector/
├── package.json          → name: "@myj/collector"
├── tsconfig.json
└── src/
    ├── index.ts          → 入口（CLI / 定时任务 / Worker）
    ├── config/env.ts
    ├── lib/db.ts         → 可复用 apps/api/src/db/index.ts 的 pool 模式
    └── adapters/
        ├── lawson.ts     → 一个渠道一个 adapter
        ├── tmall-super.ts
        └── ...
```

`apps/collector/` 共享根 `package.json` 的 workspaces 定义；进项目根 `npm install` 即可装上所有依赖。

### 5. 第一次贡献的开发流程

按 [CONTRIBUTING.md](../../CONTRIBUTING.md) 的 GitHub Flow：
- 从 `main` 切分支：`git checkout -b feat/collector-bootstrap`
- 开发 + 本地跑通
- `git push -u origin feat/collector-bootstrap`
- `gh pr create` 开 PR
- 走分支保护（0 approval，自己 merge）

---

## 集成约定（**硬约束**，不可改）

下面这些约束打破后会让选品 / 价盘 / 海报模块对你的数据消费失败。如果业务上确实需要打破，请提 issue 一起讨论改方案。

### A. `dim_competitor_product.mapped_sku_code` / `mapped_product_id` 必须指 `dim_product`

价盘模块的"竞品对标"功能按 SKU join 我们的 `dim_product`。如果你写的竞品商品里 `mapped_*` 是空或者乱填，价盘看不到对标价。

**推荐写法**：

```typescript
// 插竞品商品前先确认 mapping
const ourSku = await db.oneOrNone(
  `SELECT id, sku_code FROM dim_product WHERE sku_code = $1`,
  [hypothesizedSkuCode]
);
if (!ourSku) {
  // 找不到对应 SKU 时不要插 NULL，要么先入 dim_product（如果是新品），
  // 要么把这条竞品商品标 unmapped 并入审核队列，让人工补 mapping
}
```

### B. 同一 (`channel_id`, `external_sku`) 唯一

V005 已有 partial unique index `uq_competitor_product_ext`。重复采集同一商品要用 `INSERT ... ON CONFLICT (channel_id, external_sku) WHERE external_sku IS NOT NULL DO UPDATE`（partial index 必须显式带 WHERE 子句）。

### C. 同一 (`competitor_product_id`, `snapshot_date`) 唯一

V005 已有 `uq_competitor_price_weekly`。同一竞品同一日只能有一行。如果你按日采集，`snapshot_date` 推荐对齐到**周一**（与我们自己的销售快照对齐方便后续 join 比较）。

```typescript
const monday = mondayOf(collectedAt);  // 自己写个 helper
```

### D. `source` 字段建议值：`'crawler'` / `'api'` / `'manual'` / `'csv_import'`

不是强约束，但便于后续做"数据来源归因"统计。如果你引入新 source，加进枚举值或保持字符串都行。

### E. 不要改 V005

你要的字段如果不够（要加 `category_path` 给竞品商品、给 channel 加 `region_code` 之类），**不要改 V005**，加新的 migration。本仓约定 V020+ 范围留给业务模块自己的 schema 增量。比如：

```
apps/api/src/db/migrations/
├── V005__competitor.sql           ← 不动
├── V015__seed.sql                 ← 不动
├── V020__competitor_extras.sql    ← 已加：给 dim_competitor_product 加了 series 列
└── V021__你要的下一个增量.sql       ← 你需要更多字段就这样加
```

### F. `dim_competitor_product.series` 字段填法

V020 加了一个可空的 `series TEXT` 列，用来记录商品所属系列名（例：罗森 "おにぎりプレミアム"、农夫山泉 "茶π"）。

填写约定：
- **有系列概念的渠道**（罗森、7-11、便利蜂等品牌商）：尽量把系列名填上，便于后续按系列做对比、归类。
- **没有系列概念的渠道**（综合电商：天猫超市、京东超市）：留空即可。
- 系列名按竞品平台显示的中文/原文照搬，不要做翻译/规整（后续如要规范化，单独写归一化 job）。

```typescript
// adapter 解析时
const series = page.querySelector('.series-tag')?.textContent?.trim() || null;
await db.query(
  `INSERT INTO dim_competitor_product (channel_id, external_sku, product_name, series, ...)
   VALUES ($1, $2, $3, $4, ...)
   ON CONFLICT (channel_id, external_sku) WHERE external_sku IS NOT NULL DO UPDATE
     SET product_name = EXCLUDED.product_name,
         series       = EXCLUDED.series,
         updated_at   = now()`,
  [channelId, externalSku, productName, series, /* ... */],
);
```

---

## 路线图建议

| 阶段 | 我建议做的事 | 完成的标志 |
|---|---|---|
| **P0 · 跑通最小路径** | 选一个最容易拿数据的渠道（如天猫超市），写一个 adapter，能把一个 SKU 的当前价采下来塞进 fact_competitor_price_weekly | 数据库里多了一行 fact 数据 |
| **P1 · 多 SKU 多渠道** | 配置化（哪些渠道、哪些 SKU 要采）、定时任务（每周一次）、错误重试 | 一次跑完产出 N 行新 fact，无重复 |
| **P2 · 接审计** | 采集成功 / 失败写一条 [audit_events](../../apps/api/src/db/migrations/V012__audit.sql)（`event_kind = 'competitor_price_import'`） | 超管在审计页能看到每次采集 |
| **P3 · SKU 映射工具** | 当采集到的商品名找不到对应我们的 SKU 时，进入"待映射队列"，人工/AI 完成映射 | 不再有 unmapped 竞品商品 |
| **P4 · 上线** | 跑通生产环境的定时任务、监控告警、产品验收 | M5 上线打磨阶段把这块纳进 CI/CD |

---

## 联系 / 问问题

- 主仓代码 / schema 不清楚：在 https://github.com/rollingai-myj/integratedApp/issues 开 issue
- 想加新表 / 新字段：开 issue 讨论，约定好之后我或主仓维护人提 V020+ migration
- 集成约定上有疑问 / 想协商打破：同上，issue 里说明业务理由

欢迎入伙。
