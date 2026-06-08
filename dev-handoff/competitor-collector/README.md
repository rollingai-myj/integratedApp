# 竞品采集模块 · 本地开发脚手架

> 给负责"竞品信息采集"模块的同事用——让你能在自己的电脑上跑起一个迷你的数据库环境，专心开发采集端的写入逻辑，不需要先把整个统一仓库读懂。

---

## 这个包里有什么

```
dev-handoff/competitor-collector/
├── README.md             ← 你正在看的文档
├── docker-compose.yml    ← 一键起一个本地 PostgreSQL（5436 端口）
├── sql/
│   ├── bootstrap.sql     ← 一键建表（4 张表 + 2 个枚举 + 3 个扩展）
│   └── seed-minimal.sql  ← 塞几条样例数据，让你立刻能 SELECT 看到东西
└── migrations/           ← 主仓库的 4 个相关 migration 原文件（供参考 / 增量演进用）
    ├── V001__extensions.sql
    ├── V002__enum_types.sql
    ├── V004__dim_master_data.sql
    └── V005__competitor.sql
```

跑下来你会拿到：
- 本地 `myj_competitor_dev` 数据库
- 4 张和竞品有关的表（见下方"你会操作的表"）
- 5-10 行示例数据，覆盖完整 FK 链路

---

## 你会操作的表

```
dim_competitor_channel     竞品渠道（罗森、7-11、天猫超市这种）
       ↓ (channel_id FK)
dim_competitor_product     竞品商品（罗森店里的某瓶可乐）
       ↓ (competitor_product_id FK)
fact_competitor_price_weekly  竞品价格快照（按周记录）

dim_product                我们自己的 SKU（你需要把竞品商品映射回我们的 SKU）
       ↑ (mapped_product_id FK)
```

字段细节看 `sql/bootstrap.sql`，每张表都有注释。

---

## 5 分钟跑起来

### 前置

- Docker Desktop（macOS / Windows / Linux 都行）
- `psql` 命令行（macOS：`brew install postgresql`；其他系统装 PostgreSQL client）

### 步骤

```bash
# 1) 进入这个目录
cd dev-handoff/competitor-collector

# 2) 启动 Postgres
docker compose up -d

# 3) 等几秒它就绪
docker compose ps
# 应该看到 myj-competitor-pg 状态是 healthy

# 4) 建表 + 装样例数据
psql -h localhost -p 5436 -U postgres -d myj_competitor_dev -f sql/bootstrap.sql
psql -h localhost -p 5436 -U postgres -d myj_competitor_dev -f sql/seed-minimal.sql
# 默认密码：postgres

# 5) 验证
psql -h localhost -p 5436 -U postgres -d myj_competitor_dev -c "
  SELECT ch.channel_name, cp.product_name, p.retail_price
  FROM dim_competitor_channel ch
  JOIN dim_competitor_product cp ON cp.channel_id = ch.id
  JOIN fact_competitor_price_weekly p ON p.competitor_product_id = cp.id;
"
```

成功的话你会看到类似：

```
   channel_name    |   product_name    | retail_price
-------------------+-------------------+--------------
 罗森 · 广州天河    | 可口可乐 330ml    |     4.50
 天猫超市          | 百事可乐 330ml    |     3.99
```

### 数据库连接信息

| | |
|---|---|
| 主机 | `localhost` |
| 端口 | `5436` |
| 数据库 | `myj_competitor_dev` |
| 用户 | `postgres` |
| 密码 | `postgres` |
| 连接串 | `postgresql://postgres:postgres@localhost:5436/myj_competitor_dev` |

---

## 你的代码要写什么

竞品采集模块的核心职责是**把采集到的竞品数据写进数据库**。基本流程：

1. **注册新渠道**（一次性）：往 `dim_competitor_channel` 插入新渠道
2. **注册新竞品商品**：往 `dim_competitor_product` 插入，**重要**：要把 `mapped_sku_code` / `mapped_product_id` 指回我们的 `dim_product`，否则价盘模块没法做对标
3. **写入价格快照**：每周一次（或按你的采集频率），往 `fact_competitor_price_weekly` 写一条

简单写入示例（伪代码）：

```typescript
// 1. 拿到或创建渠道
const channel = await db.oneOrNone(
  `SELECT id FROM dim_competitor_channel WHERE channel_code = $1`,
  ['LAWSON_GZ']
);

// 2. 找到映射到的我们的 SKU
const ourProduct = await db.oneOrNone(
  `SELECT id FROM dim_product WHERE sku_code = $1`,
  ['COKE-330ML']
);

// 3. upsert 竞品商品
const compProduct = await db.one(`
  INSERT INTO dim_competitor_product
    (channel_id, external_sku, product_name, brand, spec, mapped_sku_code, mapped_product_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (channel_id, external_sku) DO UPDATE
    SET product_name = EXCLUDED.product_name,
        updated_at = now()
  RETURNING id
`, [channel.id, 'LAWSON-COKE-330', '可口可乐 330ml', '可口可乐', '330ml', 'COKE-330ML', ourProduct.id]);

// 4. 写价格快照（每竞品 + 每周一一行）
await db.none(`
  INSERT INTO fact_competitor_price_weekly
    (competitor_product_id, channel_id, snapshot_date, retail_price, source)
  VALUES ($1, $2, $3, $4, 'crawler')
  ON CONFLICT (competitor_product_id, snapshot_date) DO UPDATE
    SET retail_price = EXCLUDED.retail_price, collected_at = now()
`, [compProduct.id, channel.id, mondayOfThisWeek(), 4.50]);
```

---

## 集成约定（重要）

等你这边开发好了，准备并入主仓库时，下面这些**约定不能改**，否则会破坏选品 / 价盘模块对竞品数据的消费：

| 约束 | 必须遵守 | 为什么 |
|---|---|---|
| `mapped_sku_code` / `mapped_product_id` 必须指向 `dim_product` | ✅ 强约束 | 价盘的"竞品对标"功能按 SKU join |
| 同一 (`channel_id`, `external_sku`) 唯一 | ✅ 已有 UNIQUE 索引 | 防重复采集 |
| 同一 (`competitor_product_id`, `snapshot_date`) 唯一 | ✅ 已有 UNIQUE 索引 | 一周一行 |
| `snapshot_date` 推荐对齐到周一 | 🟡 软约定 | 销售快照也是周一对齐，便于 join 比较 |
| `channel_code` 大写 + 下划线（如 `LAWSON_GZ`） | 🟡 软约定 | 现有 9 个老渠道都是这个风格 |
| `source` 字段建议值：`'crawler'` / `'api'` / `'manual'` | 🟡 软约定 | 方便后续按数据来源做归因 |

如果你确实需要新字段 / 新表，**不要改 V005**——给主仓库提个 issue，我们一起在 V020+ 范围内加新的 migration。

---

## 进阶：用主仓库的 migration 工具而非裸 SQL

如果你想用更"正经"的迁移流程（每次 schema 改动写一个 V020+, 21+, ... 的 sql 文件，工具自动追踪已应用），可以这样做：

```bash
# 在 dev-handoff/competitor-collector 下
mkdir -p apps/api
ln -s ../../../apps/api/scripts apps/api/scripts                # 复用主项目的迁移工具（可选）

# 把 migrations 目录指向你自己的（避免 4 张主表 + 你的新表混在一起）
```

不过老实说，竞品采集模块还在初期，**用 `psql -f` + 这个 README 已经够了**。等你的功能成型再考虑迁移工具。

---

## 何时该并入主仓库

我们目前是这样想的：

- **现阶段**：你用这个独立环境快速迭代采集逻辑，不用学整个 monorepo
- **当你的采集端能正常写入这 3 张表 + 有一两个测试运行良好** → 是时候并入
- **并入方式**：把你的 `apps/collector/`（或你叫别的名字）目录提交到主仓库，schema 改动作为 migration（V020+, V021+ ...）合并

并入时主仓库会提供：
- 统一的 logger / 配置加载
- 已经走通的 docker compose（你不再需要 5436 端口的独立 db）
- 部署 CI（一起上线）
- 审计接入（采集失败 → 审计事件 → 超管能看到）

---

## 常见问题

**Q: 我能改 `dim_product` 加一个"竞品对标级别"字段吗？**
A: 不要在你本地这份 schema 里改，因为这是主仓库共享的。提个 issue 讨论，加了之后我们写到主仓库的 V020+，你同步过来。

**Q: 我跑 bootstrap.sql 报错说扩展装不上？**
A: `pg_trgm` 和 `unaccent` 在 `postgres:16-alpine` 镜像里自带，应该不会失败。如果你换了别的 Postgres 镜像可能要 `CREATE EXTENSION` 权限。

**Q: 我能直接用主仓库的 Postgres 而不是这个独立的吗？**
A: 可以。主仓库本地 db 是 5432 端口、数据库名 `myj_dev`，schema 完全一样。但那里面有老库迁过来的真实业务数据（11,481 行），可能会被你测试的 INSERT 污染。建议你 own 一个独立环境，主仓库的 db 留给主项目自己跑。

**Q: 老库 myjadviser 里的 9 个旧渠道是什么？**
A: 主仓库迁移文档 [docs/legacy-data-migration.md](../../docs/legacy-data-migration.md) 有写。如果你想看到那些数据，可以从主仓库 dump 出 `dim_competitor_channel` 表导进来作为更真实的测试数据。

---

## 出问题找谁

- 主仓库代码 / schema 问题：在 `rollingai-myj/integratedApp` 提 issue
- 这个 handoff 包本身的问题：在主仓库 issue 加标签 `dev-handoff:competitor`
