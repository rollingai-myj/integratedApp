# 竞品采集模块 · 模块所有者文档

> 这份文档给即将开发"竞品信息采集"的同事看。读完你能知道:当前 schema 长什么样、要往哪几张表写、必须遵守什么约束、什么时候、以什么形态把代码并到本仓。

> ⚠️ **重要变更通知**:**旧的"全局渠道维度模型"(`dim_competitor_channel` / `dim_competitor_product` / `fact_competitor_price_weekly`)已经下线**。现在用的是"每家门店挂自己的竞对店"的模型(下文)。如果你看到旧的 ADR / 老 commit 里提到 `dim_*` / `fact_*` 表名,那是历史快照,**当前 schema 里不存在那些表**。

---

## 模块定位

**职责**:把竞对便利店 / 卖场的商品信息和价格采集回来,挂在某家美宜佳门店名下,供选品 / 价盘模块消费做对标。

**数据模型**(跟"全局维度表"不同 — 是**门店私有**的):

```
stores  (美宜佳的门店)
  ↓ (store_id FK)
store_competitors           ← 这家店关注的竞对(罗森 XX 店 / 7-11 YY 店 ...)
  ↓ (competitor_id FK)
store_competitor_products   ← 这个竞对店在卖的商品,可选 mapped_product_id → hq_products
  ↓ (competitor_product_id FK)
store_competitor_price_snapshots   ← 该商品的价格快照(时间序列,按 snapshot_date)
```

关键设计选择:

- **没有"全局渠道"概念**。同一物理竞对(如"罗森南山书城店")被 A、B 两家美宜佳同时盯 → 在 `store_competitors` 里记两条,**不去重**。这是有意的:每家美宜佳关心的竞对范围、距离、定价策略都不一样。
- **mapping 是可选的**。`store_competitor_products.mapped_product_id` 指向 `hq_products.id`,空就是"还没匹配上自家任何 SKU"。
- **价格是快照,不是当前值**。`store_competitor_price_snapshots` 按 `snapshot_date` 时间序列,每次采集插一行;同 `(competitor_product_id, snapshot_date)` 用 UNIQUE 约束防重。

定义位置:[V007__store_insight.sql](../../apps/api/src/db/migrations/V007__store_insight.sql)(`store_competitors` / `store_competitor_products` / `store_competitor_price_snapshots`)。

依赖的两张主数据表(你只读,不写):

- [`hq_products`](../../apps/api/src/db/migrations/V004__hq_master_data.sql) — 美宜佳自家的 SKU,`mapped_product_id` 指向它
- `stores` — 美宜佳门店,`store_id` 指向它

---

## 怎么开始(在主仓内开发)

### 1. 把本仓 clone 下来 + 跑通 dev 环境

完全按 [README.md](../../README.md) 的"本地一把启动"步骤:

```bash
git clone https://github.com/rollingai-myj/integratedApp.git
cd integratedApp
npm install
cp .env.example .env
docker compose --profile dev up -d
docker exec myj-api npx tsx src/db/migrate.ts up
```

跑完之后三张竞品相关表都建好了(V007 起就有),默认是空的。

### 2. 验证表建好了 + 自己塞一条测试数据

```bash
# 确认三张表都在
docker exec myj-postgres psql -U myj -d myj_dev -c "\dt store_competitor*"

# 找一家测试门店
docker exec myj-postgres psql -U myj -d myj_dev -tAc "SELECT id, store_code, store_name FROM stores LIMIT 1;"

# 给这家店挂一个竞对(假设上一步拿到的 store_id = 'xxx-uuid')
docker exec myj-postgres psql -U myj -d myj_dev -c "
  INSERT INTO store_competitors (store_id, competitor_name, kind, city, address, distance_m)
  VALUES ('<store_id>', '罗森南山书城店', 'offline', '深圳市', '南山区南山大道 ...', 350)
  RETURNING id, competitor_name;
"
```

`competitor_kind` enum:`'offline'`(线下店)/ `'online'`(线上店)— V001 已定义。

### 3. 把你的代码放在哪里

推荐目录:`apps/collector/`,自己开一个 npm workspace。结构参考 `apps/api/`:

```
apps/collector/
├── package.json            → name: "@myj/collector"
├── tsconfig.json
└── src/
    ├── index.ts            → 入口(CLI / 定时任务 / Worker)
    ├── config/env.ts
    ├── lib/db.ts           → 复用 apps/api/src/db/index.ts 的 pool 模式
    └── adapters/
        ├── lawson.ts       → 一个采集源一个 adapter
        ├── seven-eleven.ts
        └── ...
```

`apps/collector/` 共享根 `package.json` 的 workspaces 定义;进项目根 `npm install` 即可装上所有依赖。

### 4. 第一次贡献的开发流程

按 [CONTRIBUTING.md](../../CONTRIBUTING.md) 的 GitHub Flow:

- 从 `main` 切分支:`git checkout -b feat/collector-bootstrap`
- 开发 + 本地跑通
- `git push -u origin feat/collector-bootstrap`
- `gh pr create` 开 PR
- 走分支保护(0 approval,自己 merge)

---

## 集成约定(**硬约束**,不可改)

下面这些约束打破后会让选品 / 价盘模块对你的数据消费失败。如果业务上确实需要打破,请提 issue 一起讨论改方案。

### A. `store_competitor_products.mapped_product_id` 尽量填上

价盘模块的"竞品对标"功能按 `mapped_product_id` JOIN `hq_products`。如果你写的竞品商品 `mapped_product_id` 为空,价盘看不到对标价(只能看到"有这个竞品商品存在",但对不上自家哪个 SKU)。

**推荐写法**:

```typescript
// 插竞品商品前先尝试匹配自家 SKU
const ourSku = await db.oneOrNone(
  `SELECT id, sku_code FROM hq_products
    WHERE deleted_at IS NULL
      AND (sku_code = $1 OR barcode = $2)
    LIMIT 1`,
  [hypothesizedSkuCode, externalBarcode],
);

await db.query(
  `INSERT INTO store_competitor_products
     (competitor_id, external_sku, product_name, brand, spec, mapped_product_id)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [competitorId, externalSku, productName, brand, spec, ourSku?.id ?? null],
);
```

匹配不上时插入 `mapped_product_id = NULL`,后续可走"未映射队列"由人工 / AI 补 mapping。

### B. 价格快照按 `(competitor_product_id, snapshot_date)` 唯一

V007 已有约束。同一商品同一天重复采集 → 用 `INSERT ... ON CONFLICT (competitor_product_id, snapshot_date) DO UPDATE` 覆盖,而不是插重复行:

```typescript
await db.query(
  `INSERT INTO store_competitor_price_snapshots
     (competitor_product_id, snapshot_date, retail_price, promo_price, promo_text, source, photo_url)
   VALUES ($1, CURRENT_DATE, $2, $3, $4, 'photo', $5)
   ON CONFLICT (competitor_product_id, snapshot_date) DO UPDATE
     SET retail_price = EXCLUDED.retail_price,
         promo_price  = EXCLUDED.promo_price,
         promo_text   = EXCLUDED.promo_text,
         photo_url    = EXCLUDED.photo_url,
         collected_at = now()`,
  [competitorProductId, retailPrice, promoPrice, promoText, photoUrl],
);
```

`source` 枚举:`'photo'`(拍照采集)/ `'ocr'`(OCR 识别后兜底)/ `'manual'`(店长手填)。

### C. 不要改 V007

你要的字段如果不够,**不要改 V007**,加新的 migration。本仓约定 V032+ 范围继续给业务模块自己的 schema 增量:

```
apps/api/src/db/migrations/
├── V007__store_insight.sql           ← 不动
├── V031__snapshot_rename_amt_add_psd_hb.sql   ← V031 已经给 store_competitor_products 加了 tags
└── V039__你要的下一个增量.sql        ← 你需要更多字段就这样加
```

V031 已经给 `store_competitor_products` 加了 `tags TEXT`(店主自由标签,如 "便利店主力品"、"季节性")。

### D. `store_competitors.kind` + `distance_m` 填法

- `kind`:`'offline'` 实体店 / `'online'` 电商店(美团 / 多点 / 京东超市等用 online)
- `distance_m`:线下店填到美宜佳门店的距离(米);线上店填空

`competitor_name` 用对外可识别的店名(如"罗森南山书城店"),便于店长一眼看出来是哪家。

### E. 软删除用 `is_active = false`,不要物理 DELETE

`store_competitors.is_active` / `store_competitor_products.is_active` 都有 partial index `WHERE is_active`,查询永远过滤 active。

历史价格快照不带 is_active,直接保留 — 它们是时间序列证据,删了就是丢数据。

---

## 路线图建议

| 阶段 | 我建议做的事 | 完成的标志 |
|---|---|---|
| **P0 · 跑通最小路径** | 给一家测试门店挂一个手填竞对,采一个 SKU 的当前价,塞 `store_competitor_price_snapshots`,验证价盘 SkuDetailDialog 能看到对标价 | 调"竞品对标"接口能拿到这条数据 |
| **P1 · 批量 + 时序** | 实现按门店配置(哪几家店关注哪几个竞对)的定时采集,每天一次价格快照;`ON CONFLICT` 防重 | 价盘曲线可以画"竞对价 vs 自家价"的时间序列对比 |
| **P2 · 接审计** | 采集成功 / 失败写一条 [sys_audit_events](../../apps/api/src/db/migrations/V003__system_horizontal.sql)(`event_kind = 'competitor_price_import'`) | 超管在审计页能看到每次采集 |
| **P3 · SKU 自动 mapping** | 采集到 `mapped_product_id IS NULL` 时,进入"待映射队列",AI / 人工补 mapping | 已采集的竞品商品 mapped 率 > 90% |
| **P4 · 上线** | 跑通生产环境的定时任务、监控告警、产品验收 | M5 上线打磨阶段把这块纳进 CI/CD |

---

## 联系 / 问问题

- 主仓代码 / schema 不清楚:在 https://github.com/rollingai-myj/integratedApp/issues 开 issue
- 想加新表 / 新字段:开 issue 讨论,约定好之后我或主仓维护人提 V039+ migration
- 集成约定上有疑问 / 想协商打破:同上,issue 里说明业务理由

欢迎入伙。
