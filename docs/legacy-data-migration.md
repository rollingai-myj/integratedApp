# 从老库迁移业务数据

老 `myjadviser` 库（原 skuSelection + poster 共用）中的全部业务数据迁移到新统一库的一次性脚本。

迁移脚本路径：`apps/api/scripts/migrate-from-legacy-db.ts`

## 谁会用到这份文档

- **业务负责人**：看完后能验证"数据全搬过来了"
- **新加入项目的开发**：要在本地跑一遍迁移就看下面的"如何运行"
- **运维**：上线前最后一次跑生产迁移时参考

## 迁移范围

### 迁移的业务数据（22 类）

| 类别 | 老表 → 新表 | 行数 |
|---|---|---|
| 应用配置 | `app_settings` → `app_settings` | 1 |
| 商品分类树 | `dim_category` → `dim_category` | 43 |
| 商品主数据 | `dim_product` → `dim_product` | 258 |
| 基准 SKU 名单 | `benchmark_sku_allowlist` → 同名 | 68 |
| 竞品渠道 | `dim_competitor_channel` → 同名 | 9 |
| 竞品商品 | `dim_competitor_product` → 同名 | 36 |
| 竞品价格周快照 | `fact_competitor_price_weekly` → 同名 | 39 / 42 (3 行孤立) |
| 门店 | `imported_stores` → `stores` | 23 |
| 用户 | `auth_users` (11) + `store_accounts` (16) → `users` | 27 |
| 门店 SKU 周快照 | `fact_store_sku_weekly` → 同名 | 1671 / 1864 (193 行孤立) |
| 调价流水 | `ops_store_price_change` → 同名 | 56 |
| 上下架流水 | `ops_store_assortment_change` → 同名 | 203 |
| 选品场景定义 | `plan_position_mapping` → 同名 | 28 |
| 门店货架配置 | `store_shelf_config` → 同名 | 14 |
| 货架运行态 | `shelf_runtime_state` → 同名 | 12 |
| 调研问卷题目 | `shelf_survey_questions` (14 行 × N 题) → 展开为 70 行 | 70 |
| 选品 SKU 级促销 | `promo_groups` → 同名 | 896 |
| SKU 勘误 | `sku_corrections` → 同名 | 36 |
| 门店周边洞察 | `store_environment_insights` → 同名 | 6 / 7 (1 行孤立) |
| 促销批次 | `promotion_uploads` → 同名 | 7 |
| 单品促销 | `product_promotions` → 同名 | 7581 |
| 可混搭组 | `promotion_groups` → 同名 | 242 |
| **总计** | | **11,481 行业务数据** |

### 跳过的数据

| 老表 | 原因 |
|---|---|
| `usage_logs`, `login_events`, `auth_sessions` | 日志 / 会话，无需保留 |
| `shelf_photos`, `shelf_photo_history` | 图片缓存（图片本身在 OSS） |
| `profiles` | 与 `auth_users` 重复 |
| `posters`, `poster_jobs` | 老库本就为空 |
| `device_registrations` | 老库为空 |
| `shelf_survey_answers` | 答案是松散 JSONB，新 schema 要求强结构，让店长在新系统重新填即可（仅 11 行） |
| `new_product_skus`, `sku_tags`, `benchmark_sku_blocklist` | 新 schema 没对应表，业务上也不再需要 |
| `schema_migrations` | 老迁移工具的版本表，与新迁移工具无关 |

## 数据"孤立"是什么意思

有 197 行被跳过：

- **fact_store_sku_weekly 193 行**：销售快照里的 store_id 在 `imported_stores` 已不存在（老库本身就孤立）
- **fact_competitor_price_weekly 3 行**：3 个 (channel, product) 组合在 dim 表中找不到匹配
- **store_environment_insights 1 行**：referenced store 不存在

这些都是**老库本身就脏的数据**，跳过是正确的。

## 迁移的关键转换

下面几处不是简单的"字段对字段"复制：

### 1. 用户合并

老库有两套用户：
- `auth_users`（11 行）：海报项目的测试账号 `meiyijia01@myj.app` ~ `meiyijia11@myj.app` + 1 个 `superadmin@myj.app`
- `store_accounts`（16 行）：选品项目的店长账号 + 1 个 `admin`

合并后：
- 27 个 `users` 行
- 2 个 super_admin（`admin` 和 `superadmin@myj.app`）
- 25 个 store_owner
- 15 个 user_stores 绑定（每个店长 → 自己的店；超管不绑定 → 可见全部门店，依据 D1 决策）

老密码哈希（bcrypt for store_accounts、SHA-256 for auth_users）原样保留在 `legacy_password_hash` 字段，M1 实现账密兜底登录时使用。

### 2. 竞品商品反查渠道

老 `dim_competitor_product` 没有渠道字段。从老 `fact_competitor_price_weekly` 反查（每个竞品取其最近出现的渠道），如果某竞品从未出现在 fact 表，分配到第一个渠道作为兜底。

### 3. 货架 ID 类型转换

老库 `shelf_runtime_state.shelf_id = "A05"`（文本编号）。新库 `shelf_runtime_state.shelf_id` 是 UUID 外键到 `store_shelf_config.id`。脚本通过 `(store_id, shelf_code)` 反查到 UUID 再插入。

### 4. 调研问卷展开

老库 `shelf_survey_questions.questions` 是 JSONB 数组（一行存 N 道题）。新库要求"一题一行"。脚本展开为每题 `question_no = index + 1`。

### 5. 货架宽度解析

老库 `store_shelf_config.shelf_width = "90cm"`（文本带单位）。新库 `width_cm` 是数字。脚本用正则抽取数字部分。

### 6. 周边洞察字段重整

老库有多个具体字段（`poi_count`、`report_markdown`、`crowd_source_analysis` 等）。新库（按决策 D10）有"关键字段 + 弹性 JSONB"两层结构。脚本：`poi_count` → `competitor_count`，其它都进 `insight_data` JSONB。

### 7. 操作员字段（ops_*）

老库 `operator_user_id` 字段是文本（如 `"admin"`、`"运营小二"`）而非 UUID。脚本尝试反查 `users.legacy_account`：
- 若找到 → 用对应 UUID 填 `operator_user_id`
- 找不到 → `operator_user_id` 置 NULL，原值放进 `note` 字段保留审计信息

同理 `batch_id`（老库是 `"CSV-IMPORT-..."` 这种字符串）也置 NULL 并保留到 `operator_display`。

## 如何运行

### 前置

- 老库容器（`myjadviser-db-1` 或解压后的卷 `myjadviser_pgdata`）能访问
- 新库（`myj-postgres` 容器）已起且已跑过 V001-V015 迁移

### 跑迁移

```bash
# 在仓库根目录
OLD_DATABASE_URL=postgresql://postgres:postgres@localhost:5435/myjadviser \
  npm run -w apps/api migrate:legacy
```

如果老库容器在另一端口，调整 URL 即可。

### 输出示例

```
[migrate-legacy] app_settings                        read=    1 new=    1 dup=    0 err=  0  (32ms)
[migrate-legacy] dim_category                        read=   43 new=   43 dup=    0 err=  0  (31ms)
...
[migrate-legacy] 迁移完成。汇总：
[migrate-legacy]   阶段数: 22
[migrate-legacy]   共读取 11523 行
[migrate-legacy]   共新增 10874 行
[migrate-legacy]   跳过 649 行（已存在或源缺数据）
[migrate-legacy]   报错 0 行
```

每行：`read=` 老库读到的、`new=` 新库新插的、`dup=` 已存在或源缺数据跳过的、`err=` 报错的。

### 幂等性

脚本**可重复运行**——所有 INSERT 都有"已存在则跳过"的逻辑。重复跑只会刷新某些幂等字段，不会重复插数据。

某些表用 `ON CONFLICT (id) DO NOTHING`（保留老 UUID 的）；某些用 `SELECT ... WHERE ... LIMIT 1` 然后判断（无法保留老 ID 或没有合适唯一约束的）。

## 上线前的检查清单

在生产环境跑这个脚本前：

- [ ] 确认 OLD_DATABASE_URL 指向**只读副本**而非生产主库（避免误操作老库）
- [ ] 确认新库已跑过 V001-V015（`npm run -w apps/api migrate:status`）
- [ ] 在测试环境跑一遍，对照本文表格逐项核对计数
- [ ] 跑完后将 `apps/api/.env.production` 里**移除** OLD_DATABASE_URL（避免生产里残留迁移凭证）
- [ ] 老库容器或卷可以暂时保留 30 天作为兜底，再删除
