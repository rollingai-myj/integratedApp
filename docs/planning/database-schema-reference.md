# 美宜佳门店助手 · 数据库 Schema 参考

> 这份文档是**工程实现层面**的真实 schema 参考：每张表、每个字段、每个索引、每个外键。
>
> 业务实体的「为什么这样设计、决策依据是什么」请看姊妹文档 [`unified-database-spec.md`](./unified-database-spec.md)。
>
> 字段说明完全反映 `apps/api/src/db/migrations/` 下的 V001–V020 迁移脚本。schema 变更必须先改迁移脚本，再回来更新本文档。

---

## 文档约定

- **可空**栏：`×` = NOT NULL，`✓` = 允许 NULL
- **默认**栏：DB 层默认值；为空表示无默认
- **类型**栏：PostgreSQL 类型，自定义 ENUM 写完整名（详见末尾「ENUM 类型清单」）
- **索引**栏注释：
  - `UQ` = unique；`UQ partial` = 部分唯一索引（带 WHERE 条件）
  - `GIN` = GIN 索引（多用于 trgm / jsonb）
  - `partial` = 部分索引
- **删除行为**：`CASCADE` = 级联删；`SET NULL` = 置空；`RESTRICT` = 拒绝删
- 字段说明里写的"决策 Dn"对应 `unified-database-spec.md` 第四部分的 13 个决策记录

---

## 目录

- [全局基础设施（V001、V002）](#全局基础设施)
- [组 1：身份与组织（V003）](#组-1身份与组织)
  - [users · 用户](#11-users-用户)
  - [user_feishu_identities · 飞书身份绑定](#12-user_feishu_identities-飞书身份绑定)
  - [auth_sessions · 登录会话](#13-auth_sessions-登录会话)
  - [user_roles · 用户角色](#14-user_roles-用户角色)
  - [stores · 门店](#15-stores-门店)
  - [user_stores · 用户-门店关联](#16-user_stores-用户-门店关联)
  - [device_bindings · 设备绑定](#17-device_bindings-设备绑定)
  - [store_environment_insights · 门店周边洞察](#18-store_environment_insights-门店周边洞察)
- [组 2：商品与销售主数据（V004、V006、V007）](#组-2商品与销售主数据)
  - [dim_category · 商品分类](#21-dim_category-商品分类)
  - [dim_product · 商品库](#22-dim_product-商品库)
  - [fact_store_sku_weekly · 门店在售 SKU 销售快照](#23-fact_store_sku_weekly-门店在售-sku-销售快照)
  - [ops_store_price_change · 调价流水](#24-ops_store_price_change-调价流水)
  - [ops_store_assortment_change · 上下架流水](#25-ops_store_assortment_change-上下架流水)
  - [benchmark_sku_allowlist · 基准 SKU 名单](#26-benchmark_sku_allowlist-基准-sku-名单)
- [组 3：竞品数据（V005、V020）](#组-3竞品数据)
  - [dim_competitor_channel · 竞品渠道](#31-dim_competitor_channel-竞品渠道)
  - [dim_competitor_product · 竞品商品](#32-dim_competitor_product-竞品商品)
  - [fact_competitor_price_weekly · 竞品价格快照](#33-fact_competitor_price_weekly-竞品价格快照)
- [组 4：货盘选品业务（V008、V009）](#组-4货盘选品业务)
  - [plan_position_mapping · 场景定义](#41-plan_position_mapping-场景定义)
  - [store_shelf_config · 门店货架配置](#42-store_shelf_config-门店货架配置)
  - [shelf_runtime_state · 货架当前状态](#43-shelf_runtime_state-货架当前状态)
  - [shelf_photos · 货架最近 3 张照片](#44-shelf_photos-货架最近-3-张照片)
  - [shelf_photo_history · 货架照片历史](#45-shelf_photo_history-货架照片历史)
  - [shelf_survey_questions · 调研问卷题目](#46-shelf_survey_questions-调研问卷题目)
  - [shelf_survey_answers · 调研问卷答案](#47-shelf_survey_answers-调研问卷答案)
  - [scene_adjustment · 场景调改记录](#48-scene_adjustment-场景调改记录)
  - [scene_remake · 场景调改计数](#49-scene_remake-场景调改计数)
  - [virtual_shelf_history · 虚拟货架生成历史](#410-virtual_shelf_history-虚拟货架生成历史)
  - [sku_corrections · SKU 勘误](#411-sku_corrections-sku-勘误)
  - [promo_groups · 选品 SKU 级促销文案](#412-promo_groups-选品-sku-级促销文案)
- [组 5：海报业务（V010、V011）](#组-5海报业务)
  - [promotion_uploads · 促销批次](#51-promotion_uploads-促销批次)
  - [product_promotions · 批次内单品促销](#52-product_promotions-批次内单品促销)
  - [promotion_groups · 可混搭促销组](#53-promotion_groups-可混搭促销组)
  - [poster_jobs · 海报队列任务](#54-poster_jobs-海报队列任务)
  - [posters · 海报记录](#55-posters-海报记录)
- [组 6：审计与会话（V012）](#组-6审计与会话)
  - [audit_events · 审计事件](#61-audit_events-审计事件)
  - [usage_sessions · 使用会话](#62-usage_sessions-使用会话)
- [组 7：系统配置（V013）](#组-7系统配置)
  - [app_settings · 全局配置](#71-app_settings-全局配置)
- [视图（V012、V014）](#视图)
- [ENUM 类型清单（V002）](#enum-类型清单)
- [扩展（V001）](#扩展)
- [种子数据（V015）](#种子数据)

---

## 全局基础设施

### V001 — 扩展
| 扩展 | 用途 |
|---|---|
| `pgcrypto` | `gen_random_uuid()` 作主键默认值；`crypt()` 给 V015 的占位超管做 bcrypt |
| `pg_trgm` | trigram 索引，支持商品名 / 门店名 `ILIKE '%关键词%'` 模糊匹配 |
| `unaccent` | 去除变音符号，搭配全文检索（视图层后续可用） |

### V002 — ENUM 类型
见末尾 [ENUM 类型清单](#enum-类型清单)，本节先建好 22 个枚举类型，被后续表大量引用。

---

## 组 1：身份与组织

### 1.1 `users` · 用户
**位于**：V003 · **作用**：一个人（店长 / 超管 / 分析师 / 客户经理）的基础信息。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | 主键 |
| `display_name` | TEXT | × | | 显示名 |
| `email` | TEXT | ✓ | | 邮箱 |
| `avatar_url` | TEXT | ✓ | | 头像 |
| `phone` | TEXT | ✓ | | 手机号 |
| `legacy_account` | TEXT | ✓ | | 老选品的"粤XXXXX"或老海报的邮箱（决策 D2：飞书全量前的兜底账号） |
| `legacy_password_hash` | TEXT | ✓ | | bcrypt 哈希。飞书全量上线后逐步清空 |
| `status` | `user_status` | × | `'active'` | active / disabled |
| `last_login_at` | TIMESTAMPTZ | ✓ | | 最近登录时间 |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |
| `deleted_at` | TIMESTAMPTZ | ✓ | | 软删时间 |

**索引**：
- `uq_users_email_active` UQ partial: `lower(email) WHERE email IS NOT NULL AND deleted_at IS NULL` — 同邮箱不能注册两次
- `uq_users_legacy_account` UQ partial: `legacy_account WHERE legacy_account IS NOT NULL AND deleted_at IS NULL`
- `idx_users_status` partial: `status WHERE deleted_at IS NULL`
- `idx_users_display_name_trgm` GIN: 显示名模糊搜索

**关键约定**：
- 邮箱、老账号都允许 NULL，但**非空时唯一**（用部分索引实现）
- 软删（`deleted_at IS NOT NULL`）不参与唯一性，方便复用历史邮箱

---

### 1.2 `user_feishu_identities` · 飞书身份绑定
**位于**：V003 · **作用**：一个用户至多绑定一份飞书身份（决策 D2）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `open_id` | TEXT | × | | 应用范围内的飞书用户 ID |
| `union_id` | TEXT | ✓ | | 同租户跨应用稳定 ID |
| `tenant_key` | TEXT | ✓ | | 飞书租户 |
| `feishu_email` | TEXT | ✓ | | 飞书账号邮箱（≠ users.email） |
| `feishu_mobile` | TEXT | ✓ | | |
| `feishu_name` | TEXT | ✓ | | 飞书账号显示名 |
| `feishu_avatar_url` | TEXT | ✓ | | |
| `access_token` | TEXT | ✓ | | 调飞书 API 用 |
| `refresh_token` | TEXT | ✓ | | |
| `token_expires_at` | TIMESTAMPTZ | ✓ | | |
| `bound_at` | TIMESTAMPTZ | × | `now()` | |
| `last_synced_at` | TIMESTAMPTZ | ✓ | | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_feishu_user_id` UQ: `user_id` — 一个用户最多一条飞书绑定
- `uq_feishu_open_id` UQ: `open_id`
- `uq_feishu_union_id` UQ partial: `union_id WHERE union_id IS NOT NULL`

---

### 1.3 `auth_sessions` · 登录会话
**位于**：V003 · **作用**：用户每次登录颁发一份会话凭证（飞书 / 账密都走这里）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `token_hash` | TEXT | × | | 不存明文 token，只存哈希 |
| `auth_method` | `auth_method` | × | | feishu_qr / feishu_h5 / legacy_password |
| `client_type` | `feishu_client_type` | × | `'browser'` | feishu_h5 / feishu_pc / browser |
| `active_store_id` | UUID | ✓ | | FK → stores(id) **SET NULL**（决策 D1：当前激活门店，可在多店切换） |
| `user_agent` | TEXT | ✓ | | |
| `ip` | INET | ✓ | | |
| `issued_at` | TIMESTAMPTZ | × | `now()` | |
| `last_seen_at` | TIMESTAMPTZ | × | `now()` | |
| `expires_at` | TIMESTAMPTZ | × | | |
| `revoked_at` | TIMESTAMPTZ | ✓ | | 主动登出 / 强制下线 |

**索引**：
- `uq_auth_sessions_token_hash` UQ: `token_hash`
- `idx_auth_sessions_user`: `(user_id, revoked_at)`
- `idx_auth_sessions_expires` partial: `expires_at WHERE revoked_at IS NULL`

**关键约定**：
- `active_store_id` 的外键在 V003 声明字段时为 NULL，stores 表建好后用 `ALTER TABLE` 补 FK
- 业务接口的 storeId 一律从这里取（spec § 0 / D13）

---

### 1.4 `user_roles` · 用户角色
**位于**：V003 · **作用**：多对多。一个用户可有多种角色（决策 D1：super_admin 在应用层判跨店权限）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `role` | `app_role` | × | | super_admin / store_owner / analyst / account_manager |
| `granted_at` | TIMESTAMPTZ | × | `now()` | |
| `granted_by` | UUID | ✓ | | FK → users(id) **SET NULL** |

**主键**：`(user_id, role)`
**索引**：
- `idx_user_roles_role`: `role`

---

### 1.5 `stores` · 门店
**位于**：V003 · **作用**：一家美宜佳的物理门店。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_code` | VARCHAR(32) | × | | 业务编号，如 `粤37893` |
| `store_name` | TEXT | × | | |
| `ownership` | `store_ownership` | × | `'franchise'` | direct / franchise |
| `province` | TEXT | ✓ | | |
| `city` | TEXT | ✓ | | |
| `district` | TEXT | ✓ | | |
| `address` | TEXT | ✓ | | |
| `latitude` | NUMERIC(9,6) | ✓ | | |
| `longitude` | NUMERIC(9,6) | ✓ | | |
| `opened_at` | DATE | ✓ | | 开业日期 |
| `status` | `user_status` | × | `'active'` | 复用 active / disabled |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |
| `deleted_at` | TIMESTAMPTZ | ✓ | | |

**索引**：
- `uq_stores_store_code` UQ partial: `store_code WHERE deleted_at IS NULL`
- `idx_stores_city`: `city`
- `idx_stores_status` partial: `status WHERE deleted_at IS NULL`
- `idx_stores_name_trgm` GIN: 门店名模糊搜索

---

### 1.6 `user_stores` · 用户-门店关联
**位于**：V003 · **作用**：谁能管哪家店。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `role` | `user_store_role` | × | `'manager'` | manager / viewer |
| `is_primary` | BOOLEAN | × | `FALSE` | 默认进入的门店（决策 D1） |
| `assigned_at` | TIMESTAMPTZ | × | `now()` | |
| `assigned_by` | UUID | ✓ | | FK → users(id) **SET NULL** |

**主键**：`(user_id, store_id)`
**索引**：
- `idx_user_stores_store`: `store_id`
- `uq_user_stores_primary` UQ partial: `user_id WHERE is_primary = TRUE` — 每个用户最多一个默认门店

**关键约定**：
- super_admin 不需要在此表里也能访问所有门店（应用层判定）
- 普通 store_owner 只能看到此表关联的门店

---

### 1.7 `device_bindings` · 设备绑定
**位于**：V003 · **作用**：某台浏览器、某个用户、绑定到某家门店（海报项目特有的"设备记住选了哪家店"）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `device_code` | TEXT | × | | 浏览器 fingerprint |
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `user_agent` | TEXT | ✓ | | |
| `bound_at` | TIMESTAMPTZ | × | `now()` | |
| `last_seen_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_device_bindings_device_user` UQ: `(device_code, user_id)`
- `idx_device_bindings_store`: `store_id`
- `idx_device_bindings_last_seen`: `last_seen_at`

---

### 1.8 `store_environment_insights` · 门店周边洞察
**位于**：V003 · **作用**：决策 D10 —— 关键字段 + JSONB，AI 工作流生成的"周边消费人群、竞品密度"等。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `city` | TEXT | ✓ | | 冗余城市，便于按城市汇总 |
| `main_demographic` | TEXT | ✓ | | 主力人群（"白领"、"学生"等） |
| `consumption_level` | TEXT | ✓ | | 消费水平（"中高端"） |
| `competitor_count` | INT | ✓ | | 周边竞品数（数值方便排序） |
| `population_density` | TEXT | ✓ | | 人口密度档 |
| `insight_data` | JSONB | × | `'{}'::jsonb` | AI 工作流的完整原始输出 |
| `generated_at` | TIMESTAMPTZ | × | `now()` | |
| `generated_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `source` | TEXT | ✓ | | `'ai_workflow'` / `'manual'` |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_store_insights_store` UQ: `store_id` — 一店一条"当前洞察"
- `idx_store_insights_city`: `city`

---

## 组 2：商品与销售主数据

### 2.1 `dim_category` · 商品分类
**位于**：V004 · **作用**：自引用的三级品类树（大类 → 中类 → 小类）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `parent_id` | UUID | ✓ | | FK → dim_category(id) **CASCADE**（自引用） |
| `category_code` | VARCHAR(64) | × | | 业务编码（如 `01`、`0101`、`010101`） |
| `category_name` | TEXT | × | | 显示名（饮料 / 碳酸饮料 / 可乐） |
| `level` | SMALLINT | × | | CHECK level BETWEEN 1 AND 3 |
| `display_order` | INT | × | `0` | |
| `is_active` | BOOLEAN | × | `TRUE` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_dim_category_code` UQ: `category_code`
- `idx_dim_category_parent`: `parent_id`
- `idx_dim_category_level`: `level`
- `idx_dim_category_name_trgm` GIN: 分类名模糊

---

### 2.2 `dim_product` · 商品库
**位于**：V004 · **作用**：全公司共享的 SKU 库（决策 D8：加 `official_image_url` 给海报模块用）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `sku_code` | VARCHAR(64) | × | | SKU 编码（业务主键） |
| `product_name` | TEXT | × | | |
| `brand` | TEXT | ✓ | | |
| `spec` | TEXT | ✓ | | 规格（如 `330ml`） |
| `unit` | TEXT | ✓ | | 单位（瓶 / 罐 / 包） |
| `shelf_life_days` | INT | ✓ | | 保质期天数 |
| `length_mm` | NUMERIC(10,2) | ✓ | | |
| `width_mm` | NUMERIC(10,2) | ✓ | | |
| `height_mm` | NUMERIC(10,2) | ✓ | | |
| `category_id` | UUID | ✓ | | FK → dim_category(id) **SET NULL**（应指向 level=3 小类） |
| `category_path` | TEXT | ✓ | | 冗余的三级分类路径，如 `饮料/碳酸饮料/可乐` |
| `is_new_product` | BOOLEAN | × | `FALSE` | |
| `is_private_label` | BOOLEAN | × | `FALSE` | |
| `wholesale_price` | NUMERIC(12,2) | ✓ | | 批发价 |
| `suggested_retail_price` | NUMERIC(12,2) | ✓ | | 建议零售价 |
| `introduced_at` | DATE | ✓ | | 引入日期 |
| `official_image_url` | TEXT | ✓ | | **决策 D8**：官方包装图 |
| `status` | `product_status` | × | `'active'` | active / delisted |
| `attributes` | JSONB | × | `'{}'::jsonb` | 灵活字段（口味、产地等） |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |
| `deleted_at` | TIMESTAMPTZ | ✓ | | |

**索引**：
- `uq_dim_product_sku` UQ partial: `sku_code WHERE deleted_at IS NULL`
- `idx_dim_product_category`: `category_id`
- `idx_dim_product_brand`: `brand`
- `idx_dim_product_status` partial: `status WHERE deleted_at IS NULL`
- `idx_dim_product_name_trgm` GIN: 商品名模糊
- `idx_dim_product_category_path`: `category_path`

---

### 2.3 `fact_store_sku_weekly` · 门店在售 SKU 销售快照
**位于**：V006 · **作用**：决策 D3 —— 每次调价插一条新快照，"当前价" = 同 store+sku 最新 snapshot 的 retail_price。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `product_id` | UUID | × | | FK → dim_product(id) **RESTRICT** |
| `sku_code` | VARCHAR(64) | × | | 冗余，不 join 即可统计 |
| `snapshot_date` | DATE | × | | 周一对齐 / 调价当日 |
| `retail_price` | NUMERIC(12,2) | ✓ | | 当时零售价 |
| `original_price` | NUMERIC(12,2) | ✓ | | 划线原价 |
| `wholesale_price` | NUMERIC(12,2) | ✓ | | 当时批发价 |
| `sales_qty_30d` | INT | ✓ | | 近 30 天销量 |
| `sales_amount_30d` | NUMERIC(14,2) | ✓ | | 近 30 天销售额 |
| `sales_qty_90d` | INT | ✓ | | |
| `sales_amount_90d` | NUMERIC(14,2) | ✓ | | |
| `gross_margin_30d` | NUMERIC(6,4) | ✓ | | 近 30 天毛利率（0~1） |
| `stock_qty` | INT | ✓ | | |
| `last_delivery_at` | DATE | ✓ | | 最近配货日 |
| `source` | TEXT | × | `'erp_sync'` | `'erp_sync'` / `'price_change'` / `'manual'` |
| `price_change_id` | UUID | ✓ | | FK → ops_store_price_change(id) **SET NULL**（V007 补） |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_fact_store_sku_weekly` UQ: `(store_id, product_id, snapshot_date, source)` — 同日因调价可多条不同 source
- `idx_fact_store_sku_store_sku_date`: `(store_id, sku_code, snapshot_date DESC)`
- `idx_fact_store_sku_product`: `(product_id, snapshot_date DESC)`
- `idx_fact_store_sku_price_change` partial: `price_change_id WHERE price_change_id IS NOT NULL`

---

### 2.4 `ops_store_price_change` · 调价流水
**位于**：V007 · **作用**：决策 D3 —— 每次调价产生一行，应用层同时往 `fact_store_sku_weekly` 插一条 `source='price_change'` 的新快照。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `product_id` | UUID | × | | FK → dim_product(id) **RESTRICT** |
| `sku_code` | VARCHAR(64) | × | | |
| `old_price` | NUMERIC(12,2) | ✓ | | |
| `new_price` | NUMERIC(12,2) | × | | |
| `source` | `price_change_source` | × | `'manual'` | manual / ai_suggest / rule_engine |
| `ai_advice` | JSONB | × | `'{}'::jsonb` | AI 当时的建议（涨/降/保持、置信度、理由） |
| `ai_model` | TEXT | ✓ | | **决策 D11**：关键 AI 调用留痕 |
| `effective_date` | DATE | × | `CURRENT_DATE` | |
| `operator_user_id` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `operator_display` | TEXT | ✓ | | 冗余操作人名 |
| `note` | TEXT | ✓ | | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_ops_price_store_sku_date`: `(store_id, sku_code, effective_date DESC)`
- `idx_ops_price_product`: `(product_id, created_at DESC)`
- `idx_ops_price_source`: `(source, created_at DESC)`

---

### 2.5 `ops_store_assortment_change` · 上下架流水
**位于**：V007 · **作用**：决策 D4 —— 每个 SKU 一行；一次"一键应用调改" = 1 条 `scene_adjustment` 摘要 + N 条本表。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `product_id` | UUID | × | | FK → dim_product(id) **RESTRICT** |
| `sku_code` | VARCHAR(64) | × | | |
| `action` | `assortment_action` | × | | add / remove / replace |
| `reason_code` | `assortment_reason` | × | `'other'` | ai_recommend_core / low_sales / shelf_space_limit 等 |
| `reason_text` | TEXT | ✓ | | AI 原因描述或店长备注 |
| `scene_code` | SMALLINT | ✓ | | plan_position_mapping.position_code |
| `shelf_id` | UUID | ✓ | | FK → store_shelf_config(id) **SET NULL**（V008 后补 FK） |
| `batch_id` | UUID | ✓ | | scene_adjustment.id（**业务约定，不建 FK**） |
| `ai_diagnosis` | JSONB | × | `'{}'::jsonb` | AI 当时的诊断 |
| `effective_date` | DATE | × | `CURRENT_DATE` | |
| `operator_user_id` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `operator_display` | TEXT | ✓ | | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_ops_assort_store_sku_date`: `(store_id, sku_code, effective_date DESC)`
- `idx_ops_assort_batch` partial: `batch_id WHERE batch_id IS NOT NULL`
- `idx_ops_assort_store_scene`: `(store_id, scene_code, effective_date DESC)`
- `idx_ops_assort_action`: `(action, created_at DESC)`
- `idx_ops_assort_product`: `(product_id, created_at DESC)`

**关键约定**：`batch_id` 故意不建 FK，让业务流水表和摘要表松耦合（删摘要不影响明细查询）。

---

### 2.6 `benchmark_sku_allowlist` · 基准 SKU 名单
**位于**：V006 · **作用**：公司认定的必备 SKU，AI 推荐时优先保留。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `sku_code` | VARCHAR(64) | × | | |
| `product_id` | UUID | ✓ | | FK → dim_product(id) **SET NULL** |
| `segment` | `benchmark_segment` | × | `'core'` | core / innovation |
| `category_path` | TEXT | ✓ | | 用于按品类筛选 |
| `reason` | TEXT | ✓ | | 入选原因 |
| `effective_from` | DATE | × | `CURRENT_DATE` | |
| `effective_to` | DATE | ✓ | | NULL = 长期生效 |
| `is_active` | BOOLEAN | × | `TRUE` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `created_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_benchmark_sku_active` UQ partial: `sku_code WHERE is_active = TRUE`
- `idx_benchmark_segment`: `segment`
- `idx_benchmark_category_path`: `category_path`

---

## 组 3：竞品数据

### 3.1 `dim_competitor_channel` · 竞品渠道
**位于**：V005 · **作用**：罗森、7-11、天猫超市、京东超市等。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `channel_code` | VARCHAR(64) | × | | 业务编码（`LAWSON` / `711` / `TMALL`） |
| `channel_name` | TEXT | × | | 显示名 |
| `kind` | `competitor_kind` | × | | online / offline |
| `province` | TEXT | ✓ | | 仅线下渠道 |
| `city` | TEXT | ✓ | | |
| `address` | TEXT | ✓ | | |
| `price_uniform` | BOOLEAN | × | `FALSE` | 是否全国统一价 |
| `is_active` | BOOLEAN | × | `TRUE` | |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_competitor_channel_code` UQ: `channel_code`
- `idx_competitor_channel_kind`: `kind`
- `idx_competitor_channel_city`: `city`

---

### 3.2 `dim_competitor_product` · 竞品商品
**位于**：V005（+ V020 加 `series`） · **作用**：竞品平台上的某条商品，映射到我们自己的 SKU。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `channel_id` | UUID | × | | FK → dim_competitor_channel(id) **CASCADE** |
| `external_sku` | VARCHAR(128) | ✓ | | 竞品平台上的商品 ID |
| `product_name` | TEXT | × | | |
| `brand` | TEXT | ✓ | | |
| `spec` | TEXT | ✓ | | |
| `mapped_sku_code` | VARCHAR(64) | ✓ | | 引用 dim_product.sku_code |
| `mapped_product_id` | UUID | ✓ | | FK → dim_product(id) **SET NULL** |
| `product_url` | TEXT | ✓ | | 竞品商品页 URL（线上） |
| `image_url` | TEXT | ✓ | | |
| `is_active` | BOOLEAN | × | `TRUE` | |
| `series` | TEXT | ✓ | | **V020 新增**：商品所属系列（"经典系列" / "夏日限定" / 无系列时 NULL） |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_competitor_product_ext` UQ partial: `(channel_id, external_sku) WHERE external_sku IS NOT NULL`
- `idx_competitor_product_channel`: `channel_id`
- `idx_competitor_product_mapped_sku` partial: `mapped_sku_code WHERE mapped_sku_code IS NOT NULL`
- `idx_competitor_product_mapped_id` partial: `mapped_product_id WHERE mapped_product_id IS NOT NULL`
- `idx_competitor_product_name_trgm` GIN
- `idx_competitor_product_series` partial: `series WHERE series IS NOT NULL`（V020）

---

### 3.3 `fact_competitor_price_weekly` · 竞品价格快照
**位于**：V005 · **作用**：渠道 × 竞品 × 快照日期 的价格记录。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `competitor_product_id` | UUID | × | | FK → dim_competitor_product(id) **CASCADE** |
| `channel_id` | UUID | × | | FK → dim_competitor_channel(id) **CASCADE** |
| `snapshot_date` | DATE | × | | 周一对齐 |
| `retail_price` | NUMERIC(12,2) | × | | |
| `promo_price` | NUMERIC(12,2) | ✓ | | |
| `promo_text` | TEXT | ✓ | | "第二件半价" / "满 30 减 5" |
| `source` | TEXT | ✓ | | `'manual'` / `'crawler'` / `'api'` |
| `collected_at` | TIMESTAMPTZ | × | `now()` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_competitor_price_weekly` UQ: `(competitor_product_id, snapshot_date)` — 同竞品同日一条
- `idx_competitor_price_channel`: `(channel_id, snapshot_date)`
- `idx_competitor_price_date`: `snapshot_date`

---

## 组 4：货盘选品业务

### 4.1 `plan_position_mapping` · 场景定义
**位于**：V008 · **作用**：全公司统一的"场景"概念（一个场景包含若干品类）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `position_code` | SMALLINT | × | | 场景编号 0、1、2... |
| `position_name` | TEXT | × | | 糖巧 / 面包架 / 冷藏柜 |
| `category_id` | UUID | ✓ | | FK → dim_category(id) **SET NULL** |
| `category_code` | VARCHAR(64) | ✓ | | 冗余 |
| `category_name` | TEXT | × | | 糖果 / 巧克力 / 面包 |
| `display_order` | INT | × | `0` | |
| `is_active` | BOOLEAN | × | `TRUE` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_plan_position_mapping` UQ: `(position_code, category_name)` — 一个场景对一个品类只能一行
- `idx_plan_position_code`: `position_code`
- `idx_plan_position_cat`: `category_code`

**关键约定**：一个场景对多个品类时建多行（一对多用复合行表达）。

---

### 4.2 `store_shelf_config` · 门店货架配置
**位于**：V008 · **作用**：某门店有哪些货架、宽度多少、放什么品类。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `shelf_code` | VARCHAR(64) | × | | 业务编号（门店内唯一） |
| `position_code` | SMALLINT | × | | 所属场景 |
| `group_name` | TEXT | ✓ | | 货架组名 |
| `width_cm` | NUMERIC(8,2) | ✓ | | 宽度 |
| `layer_count` | SMALLINT | ✓ | | 层数 |
| `supported_categories` | TEXT[] | ✓ | | 支持的品类名列表 |
| `display_order` | INT | × | `0` | |
| `notes` | TEXT | ✓ | | |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |
| `deleted_at` | TIMESTAMPTZ | ✓ | | |

**索引**：
- `uq_store_shelf_code` UQ partial: `(store_id, shelf_code) WHERE deleted_at IS NULL`
- `idx_store_shelf_store_position`: `(store_id, position_code)`

---

### 4.3 `shelf_runtime_state` · 货架当前状态
**位于**：V008 · **作用**：一架一条，记录"现在的样子" + 最近一次 AI 检测 / 虚拟货架结果。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `shelf_id` | UUID | × | | FK → store_shelf_config(id) **CASCADE** |
| `status` | `shelf_runtime_status` | × | `'empty'` | empty / photo_uploaded / detected / reviewing / confirmed |
| `current_skus` | JSONB | × | `'[]'::jsonb` | 当前货架上的 SKU 列表 |
| `last_detect_result` | JSONB | × | `'{}'::jsonb` | 最近 AI 检测结果 |
| `last_detected_at` | TIMESTAMPTZ | ✓ | | |
| `virtual_status` | `virtual_shelf_status` | × | `'idle'` | idle / pending / running / succeeded / failed |
| `virtual_last_image_url` | TEXT | ✓ | | |
| `virtual_last_output` | JSONB | × | `'{}'::jsonb` | |
| `virtual_last_run_at` | TIMESTAMPTZ | ✓ | | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_by` | UUID | ✓ | | FK → users(id) **SET NULL** |

**索引**：
- `uq_shelf_runtime_shelf` UQ: `shelf_id`
- `idx_shelf_runtime_store`: `store_id`

---

### 4.4 `shelf_photos` · 货架最近 3 张照片
**位于**：V008 · **作用**：与 `shelf_runtime_state` 一对多但最多 3。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `shelf_id` | UUID | × | | FK → store_shelf_config(id) **CASCADE** |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `slot_index` | SMALLINT | × | | CHECK BETWEEN 1 AND 3 |
| `image_url` | TEXT | × | | |
| `uploaded_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `uploaded_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_shelf_photos_slot` UQ: `(shelf_id, slot_index)`
- `idx_shelf_photos_store`: `store_id`

---

### 4.5 `shelf_photo_history` · 货架照片历史
**位于**：V008 · **作用**：每次拍照留一份（最多 3 张）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `shelf_id` | UUID | × | | FK → store_shelf_config(id) **CASCADE** |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `image_urls` | TEXT[] | × | | 该次上传的全部照片 |
| `detect_summary` | JSONB | × | `'{}'::jsonb` | 当次检测摘要 |
| `uploaded_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `uploaded_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_shelf_photo_hist_shelf_time`: `(shelf_id, uploaded_at DESC)`
- `idx_shelf_photo_hist_store_time`: `(store_id, uploaded_at DESC)`

---

### 4.6 `shelf_survey_questions` · 调研问卷题目
**位于**：V008 · **作用**：AI 生成 + 人工补充的调研题。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `shelf_id` | UUID | × | | FK → store_shelf_config(id) **CASCADE** |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `question_no` | SMALLINT | × | | 题号 |
| `question_text` | TEXT | × | | |
| `question_kind` | TEXT | ✓ | | single / multi / text |
| `options` | JSONB | × | `'[]'::jsonb` | 选项 |
| `source` | TEXT | × | `'ai'` | ai / manual |
| `generated_at` | TIMESTAMPTZ | × | `now()` | |
| `created_by` | UUID | ✓ | | FK → users(id) **SET NULL** |

**索引**：
- `uq_shelf_survey_q_no` UQ: `(shelf_id, question_no)`
- `idx_shelf_survey_q_store`: `store_id`

---

### 4.7 `shelf_survey_answers` · 调研问卷答案
**位于**：V008

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `shelf_id` | UUID | × | | FK → store_shelf_config(id) **CASCADE** |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `question_id` | UUID | × | | FK → shelf_survey_questions(id) **CASCADE** |
| `answer_value` | JSONB | × | `'{}'::jsonb` | 选项 id / 文本 / 多选数组 |
| `answered_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `answered_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_shelf_survey_ans_q`: `question_id`
- `idx_shelf_survey_ans_shelf`: `(shelf_id, answered_at DESC)`

---

### 4.8 `scene_adjustment` · 场景调改记录
**位于**：V008 · **作用**：决策 D4 —— 批次摘要 + items JSONB。一次"一键应用调改"先 INSERT 本表拿到 id，再用此 id 作 `ops_store_assortment_change.batch_id`。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `position_code` | SMALLINT | × | | 场景 |
| `summary_text` | TEXT | ✓ | | "上架 5 个、下架 3 个" |
| `added_count` | INT | × | `0` | |
| `removed_count` | INT | × | `0` | |
| `replaced_count` | INT | × | `0` | |
| `items` | JSONB | × | `'[]'::jsonb` | 完整 items 列表 |
| `ai_session_id` | TEXT | ✓ | | 触发本次调改的 AI 工作流 id |
| `triggered_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `triggered_display` | TEXT | ✓ | | |
| `triggered_at` | TIMESTAMPTZ | × | `now()` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_scene_adj_store_pos_time`: `(store_id, position_code, triggered_at DESC)`
- `idx_scene_adj_triggered_by`: `(triggered_by, triggered_at DESC)`
- `idx_scene_adj_items_gin` GIN: `items`

---

### 4.9 `scene_remake` · 场景调改计数
**位于**：V008 · **作用**：门店 × 场景，每次调改 +1。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `position_code` | SMALLINT | × | | |
| `remake_count` | INT | × | `0` | |
| `last_remake_at` | TIMESTAMPTZ | ✓ | | |
| `last_adjustment_id` | UUID | ✓ | | FK → scene_adjustment(id) **SET NULL** |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**主键**：`(store_id, position_code)`

---

### 4.10 `virtual_shelf_history` · 虚拟货架生成历史
**位于**：V008 · **作用**：每次 AI 生图都留一份。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `shelf_id` | UUID | ✓ | | FK → store_shelf_config(id) **SET NULL** |
| `position_code` | SMALLINT | ✓ | | |
| `image_url` | TEXT | × | | |
| `raw_output` | JSONB | × | `'{}'::jsonb` | AI 完整输出 |
| `ai_model` | TEXT | ✓ | | 决策 D11 |
| `ai_session_id` | TEXT | ✓ | | |
| `generated_at` | TIMESTAMPTZ | × | `now()` | |
| `generated_by` | UUID | ✓ | | FK → users(id) **SET NULL** |

**索引**：
- `idx_virtual_shelf_store_pos_time`: `(store_id, position_code, generated_at DESC)`
- `idx_virtual_shelf_shelf` partial: `(shelf_id, generated_at DESC) WHERE shelf_id IS NOT NULL`

---

### 4.11 `sku_corrections` · SKU 勘误
**位于**：V008 · **作用**：店长反馈 AI 检测的漏识别 / 误识别。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `store_id` | UUID | × | | FK → stores(id) **CASCADE** |
| `shelf_id` | UUID | ✓ | | FK → store_shelf_config(id) **SET NULL** |
| `product_id` | UUID | ✓ | | FK → dim_product(id) **SET NULL** |
| `sku_code` | VARCHAR(64) | × | | |
| `correction_kind` | `sku_correction_kind` | × | | missed / false_positive |
| `reason_code` | `sku_correction_reason` | × | `'other'` | obstruction / low_resolution / new_sku / similar_packaging / other |
| `reason_text` | TEXT | ✓ | | |
| `evidence_image_url` | TEXT | ✓ | | |
| `submitted_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `submitted_at` | TIMESTAMPTZ | × | `now()` | |
| `resolved_at` | TIMESTAMPTZ | ✓ | | |
| `resolved_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `resolution_note` | TEXT | ✓ | | |

**索引**：
- `idx_sku_corrections_store_time`: `(store_id, submitted_at DESC)`
- `idx_sku_corrections_sku`: `(sku_code, submitted_at DESC)`
- `idx_sku_corrections_kind`: `correction_kind`
- `idx_sku_corrections_pending` partial: `submitted_at DESC WHERE resolved_at IS NULL`

---

### 4.12 `promo_groups` · 选品 SKU 级促销文案
**位于**：V009 · **作用**：决策 D6 —— 选品侧的"贴在货架商品旁的促销小标签"，与海报模块的促销批次（V010）并存。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `group_code` | VARCHAR(64) | × | | 促销组编号 |
| `group_name` | TEXT | ✓ | | |
| `sku_code` | VARCHAR(64) | × | | |
| `product_id` | UUID | ✓ | | FK → dim_product(id) **SET NULL** |
| `promo_text` | TEXT | × | | "第二件半价" 等 |
| `category_id` | UUID | ✓ | | FK → dim_category(id) **SET NULL** |
| `category_path` | TEXT | ✓ | | 冗余 |
| `scope` | `promotion_scope` | × | `'all_stores'` | all_stores / city / store_list |
| `scope_cities` | TEXT[] | ✓ | | 仅 scope='city' 用 |
| `scope_store_ids` | UUID[] | ✓ | | 仅 scope='store_list' 用 |
| `effective_from` | DATE | ✓ | | |
| `effective_to` | DATE | ✓ | | |
| `is_active` | BOOLEAN | × | `TRUE` | |
| `display_order` | INT | × | `0` | |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `created_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_promo_groups_group_sku` UQ partial: `(group_code, sku_code) WHERE is_active = TRUE`
- `idx_promo_groups_sku`: `sku_code`
- `idx_promo_groups_active` partial: `is_active WHERE is_active = TRUE`
- `idx_promo_groups_category_path`: `category_path`
- `idx_promo_groups_effective` partial: `(effective_from, effective_to) WHERE is_active = TRUE`

---

## 组 5：海报业务

### 5.1 `promotion_uploads` · 促销批次
**位于**：V010 · **作用**：超管每次上传 Excel 一条；**全局至多一条 active**（部分唯一索引保证）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `file_name` | TEXT | × | | 上传文件名 |
| `source_file_url` | TEXT | ✓ | | OSS 上的原始 Excel |
| `uploaded_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `row_total` | INT | × | `0` | Excel 总行数 |
| `product_count` | INT | × | `0` | 入库的 product_promotions 行数 |
| `group_count` | INT | × | `0` | 解析出的 mix_group 数 |
| `parse_warnings` | JSONB | × | `'[]'::jsonb` | 解析警告 |
| `is_active` | BOOLEAN | × | `FALSE` | |
| `activated_at` | TIMESTAMPTZ | ✓ | | |
| `deactivated_at` | TIMESTAMPTZ | ✓ | | |
| `notes` | TEXT | ✓ | | |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_promotion_uploads_active` partial: `is_active WHERE is_active = TRUE`
- `idx_promotion_uploads_created`: `created_at DESC`
- `uq_promotion_uploads_one_active` UQ partial: `(TRUE) WHERE is_active = TRUE` — **全局只能有一条 active**

---

### 5.2 `product_promotions` · 批次内单品促销
**位于**：V010

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `upload_id` | UUID | × | | FK → promotion_uploads(id) **CASCADE** |
| `row_index` | INT | × | | Excel 原始行号 |
| `sku_code` | VARCHAR(64) | × | | 不强制 FK（Excel 可能含未入库的 SKU） |
| `product_name` | TEXT | × | | |
| `unit` | TEXT | ✓ | | |
| `category_name` | TEXT | ✓ | | |
| `original_price` | NUMERIC(12,2) | ✓ | | |
| `product_id` | UUID | ✓ | | FK → dim_product(id) **SET NULL**（延迟匹配） |
| `best_label` | TEXT | ✓ | | "买二送一" / "会员价" |
| `best_required_qty` | INT | ✓ | | |
| `best_total_price` | NUMERIC(12,2) | ✓ | | |
| `best_effective_unit_price` | NUMERIC(12,2) | ✓ | | 折算单价 |
| `best_saving_percent` | NUMERIC(6,2) | ✓ | | 节省百分比 0~100 |
| `all_options` | JSONB | × | `'[]'::jsonb` | 全部可选方案 |
| `valid_from` | DATE | ✓ | | |
| `valid_to` | DATE | ✓ | | |
| `valid_dates` | DATE[] | ✓ | | 指定日期（周末等） |
| `mix_group_code` | TEXT | ✓ | | 可混搭组 |
| `display_text` | TEXT | ✓ | | 海报标准文案 |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_product_promotions_row` UQ: `(upload_id, row_index)`
- `idx_product_promotions_sku`: `sku_code`
- `idx_product_promotions_up`: `upload_id`
- `idx_product_promotions_cat`: `category_name`
- `idx_product_promotions_mix` partial: `mix_group_code WHERE mix_group_code IS NOT NULL`
- `idx_product_promotions_valid`: `(valid_from, valid_to)`
- `idx_product_promotions_save`: `best_saving_percent DESC`

---

### 5.3 `promotion_groups` · 可混搭促销组
**位于**：V010 · **作用**：同 `mix_group_code` 的 SKU 聚合，用于"多商品混排"海报。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `upload_id` | UUID | × | | FK → promotion_uploads(id) **CASCADE** |
| `mix_group_code` | TEXT | × | | |
| `display_name` | TEXT | ✓ | | "可口可乐 330ml 系列" |
| `category_name` | TEXT | ✓ | | |
| `sku_codes` | TEXT[] | × | `'{}'` | 组内全部 SKU |
| `product_count` | INT | × | `0` | |
| `best_label` | TEXT | ✓ | | |
| `best_total_price` | NUMERIC(12,2) | ✓ | | |
| `best_saving_percent` | NUMERIC(6,2) | ✓ | | |
| `representative_image_url` | TEXT | ✓ | | 组内代表图 |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `uq_promotion_groups_code` UQ: `(upload_id, mix_group_code)`
- `idx_promotion_groups_up`: `upload_id`

---

### 5.4 `poster_jobs` · 海报队列任务
**位于**：V011 · **作用**：批量入队（PO-D1）/ 异步生成。单张同步生成（PO-C1）**不**进队列。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `batch_id` | UUID | × | | 同次入队共享 |
| `parent_job_id` | UUID | ✓ | | FK → poster_jobs(id) **SET NULL**（PO-D6 重做指向旧任务） |
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `store_id` | UUID | ✓ | | FK → stores(id) **SET NULL** |
| `source_photo_url` | TEXT | ✓ | | 拍摄照片 |
| `product_image_url` | TEXT | ✓ | | mode=official_bg_only 用 |
| `template` | `poster_template` | × | | vibrant / premium / minimal / custom |
| `mode` | `poster_mode` | × | | photo_compose / official_bg_only / multi_product |
| `custom_style_description` | TEXT | ✓ | | |
| `copy_text` | TEXT | × | | 海报文案 |
| `sku_code` | VARCHAR(64) | ✓ | | |
| `category_name` | TEXT | ✓ | | |
| `inputs` | JSONB | × | `'{}'::jsonb` | PO-D1 完整原始 body |
| `status` | `poster_job_status` | × | `'queued'` | queued / claimed / processing / succeeded / failed / canceled |
| `claim_token` | TEXT | ✓ | | PO-D2 原子认领时写入 |
| `claimed_at` | TIMESTAMPTZ | ✓ | | |
| `started_at` | TIMESTAMPTZ | ✓ | | |
| `finished_at` | TIMESTAMPTZ | ✓ | | |
| `retry_count` | INT | × | `0` | |
| `reset_count` | INT | × | `0` | PO-D5 卡死重置次数 |
| `poster_image_url` | TEXT | ✓ | | 成功后的海报地址 |
| `ai_model` | TEXT | ✓ | | 实际用的 OpenRouter 模型名 |
| `ai_prompt` | TEXT | ✓ | | 拼接的 prompt（决策 D11） |
| `ai_response` | JSONB | ✓ | | AI 原始返回 |
| `generation_ms` | INT | ✓ | | 耗时 |
| `error_code` | TEXT | ✓ | | |
| `error_message` | TEXT | ✓ | | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_poster_jobs_queue` partial: `created_at WHERE status = 'queued'`
- `idx_poster_jobs_user_recent`: `(user_id, created_at DESC)`
- `idx_poster_jobs_batch`: `batch_id`
- `idx_poster_jobs_active_by_user` partial: `(user_id, status, updated_at DESC) WHERE status IN ('queued','claimed','processing')`
- `idx_poster_jobs_stuck` partial: `(status, started_at) WHERE status = 'processing'` — 用于 PO-D5 卡死检测
- `idx_poster_jobs_store` partial: `(store_id, created_at DESC) WHERE store_id IS NOT NULL`

---

### 5.5 `posters` · 海报记录
**位于**：V011 · **作用**：生成成功的最终产物。同步生成时 `job_id` 为 NULL；队列模式生成成功时指向 `poster_jobs`。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `job_id` | UUID | ✓ | | FK → poster_jobs(id) **SET NULL**（决策 D5） |
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `store_id` | UUID | ✓ | | FK → stores(id) **SET NULL** |
| `source_photo_url` | TEXT | ✓ | | |
| `product_image_url` | TEXT | ✓ | | |
| `template` | `poster_template` | × | | |
| `mode` | `poster_mode` | × | | |
| `custom_style_description` | TEXT | ✓ | | |
| `copy_text` | TEXT | × | | |
| `sku_code` | VARCHAR(64) | ✓ | | |
| `category_name` | TEXT | ✓ | | PO-E4 个性化推荐统计用 |
| `poster_image_url` | TEXT | × | | OSS 地址 |
| `thumbnail_url` | TEXT | ✓ | | |
| `ai_model` | TEXT | ✓ | | 决策 D11 |
| `ai_prompt` | TEXT | ✓ | | |
| `generation_ms` | INT | ✓ | | |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_posters_user_time`: `(user_id, created_at DESC)`
- `idx_posters_store_time` partial: `(store_id, created_at DESC) WHERE store_id IS NOT NULL`
- `idx_posters_job` partial: `job_id WHERE job_id IS NOT NULL`
- `idx_posters_user_category`: `(user_id, category_name, created_at DESC)` — 按品类做 PO-E4 推荐
- `idx_posters_sku` partial: `(sku_code, created_at DESC) WHERE sku_code IS NOT NULL`

---

## 组 6：审计与会话

### 6.1 `audit_events` · 审计事件
**位于**：V012 · **作用**：决策 D7 + D11 —— 所有关键操作 + AI 调用都额外写一条。`target_type` / `target_id` 是松散引用（不建 FK，避免业务表删时丢审计）。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `event_kind` | `audit_event_kind` | × | | 见末尾 ENUM 清单 |
| `actor_user_id` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `actor_role` | `app_role` | ✓ | | 执行时所拥有的角色（快照） |
| `actor_display_name` | TEXT | ✓ | | 显示名快照（用户改名不影响历史） |
| `target_store_id` | UUID | ✓ | | FK → stores(id) **SET NULL** |
| `target_store_label` | TEXT | ✓ | | 门店名快照 |
| `target_type` | TEXT | ✓ | | `'poster'` / `'price_change'` / `'shelf'` / `'user'` ... |
| `target_id` | TEXT | ✓ | | 字符串，便于跨表 |
| `summary` | TEXT | ✓ | | 一句话概述 |
| `payload` | JSONB | × | `'{}'::jsonb` | 详情 |
| `is_ai_call` | BOOLEAN | × | `FALSE` | 决策 D11 |
| `ai_workflow` | TEXT | ✓ | | `'selection'` / `'price_diagnose'` / `'poster_generate'` |
| `ai_model` | TEXT | ✓ | | |
| `ai_input_tokens` | INT | ✓ | | |
| `ai_output_tokens` | INT | ✓ | | |
| `ai_latency_ms` | INT | ✓ | | |
| `ai_status` | TEXT | ✓ | | `'success'` / `'fail'` / `'timeout'` |
| `ai_error` | TEXT | ✓ | | |
| `request_id` | TEXT | ✓ | | |
| `ip` | INET | ✓ | | |
| `user_agent` | TEXT | ✓ | | |
| `client_type` | `feishu_client_type` | ✓ | | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_audit_events_time`: `created_at DESC`
- `idx_audit_events_kind_time`: `(event_kind, created_at DESC)`
- `idx_audit_events_user_time` partial: `(actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL`
- `idx_audit_events_store_time` partial: `(target_store_id, created_at DESC) WHERE target_store_id IS NOT NULL`
- `idx_audit_events_target` partial: `(target_type, target_id, created_at DESC) WHERE target_type IS NOT NULL AND target_id IS NOT NULL`
- `idx_audit_events_ai_workflow` partial: `(ai_workflow, created_at DESC) WHERE is_ai_call = TRUE`
- `idx_audit_events_ai_failed` partial: `created_at DESC WHERE is_ai_call = TRUE AND ai_status = 'fail'`

---

### 6.2 `usage_sessions` · 使用会话
**位于**：V012 · **作用**：PO-G1~G3 心跳保活。前端每 30s 一次 PO-G2 更新 `last_heartbeat_at`，超 90s 算 timeout。

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | UUID | × | `gen_random_uuid()` | |
| `user_id` | UUID | × | | FK → users(id) **CASCADE** |
| `store_id` | UUID | ✓ | | FK → stores(id) **SET NULL** |
| `client_type` | `feishu_client_type` | ✓ | | |
| `user_agent` | TEXT | ✓ | | |
| `ip` | INET | ✓ | | |
| `device_id` | TEXT | ✓ | | 与 device_bindings 对齐 |
| `status` | `usage_session_status` | × | `'active'` | active / ended / timeout |
| `started_at` | TIMESTAMPTZ | × | `now()` | |
| `last_heartbeat_at` | TIMESTAMPTZ | × | `now()` | |
| `ended_at` | TIMESTAMPTZ | ✓ | | |
| `ended_reason` | TEXT | ✓ | | `'logout'` / `'timeout'` / `'forced'` |
| `duration_seconds` | INT GENERATED | × | (计算列) | `ended_at IS NULL ? last_heartbeat_at - started_at : ended_at - started_at` |
| `attributes` | JSONB | × | `'{}'::jsonb` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_usage_sessions_active` partial: `(user_id, last_heartbeat_at DESC) WHERE status = 'active'`
- `idx_usage_sessions_started`: `started_at DESC`
- `idx_usage_sessions_store_recent` partial: `(store_id, started_at DESC) WHERE store_id IS NOT NULL`

**关键约定**：决策 D12 —— `ended_at < now() - 90d` 的会话由 M5 实现的清理策略归档或删除。

---

## 组 7：系统配置

### 7.1 `app_settings` · 全局配置
**位于**：V013

| 字段 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `key` | TEXT | × | | **主键**。全局唯一 |
| `value` | TEXT | × | | 按 `value_type` 解释 |
| `value_type` | `app_setting_value_type` | × | `'string'` | string / int / float / bool / json |
| `description` | TEXT | ✓ | | 后台展示用 |
| `category` | TEXT | ✓ | | `'ai'` / `'limits'` / `'feature_flag'` / `'general'` |
| `is_secret` | BOOLEAN | × | `FALSE` | 敏感配置后台只显示脱敏值 |
| `updated_by` | UUID | ✓ | | FK → users(id) **SET NULL** |
| `updated_at` | TIMESTAMPTZ | × | `now()` | |
| `created_at` | TIMESTAMPTZ | × | `now()` | |

**索引**：
- `idx_app_settings_category` partial: `category WHERE category IS NOT NULL`

**关键约定**：改配置必须走后台接口，由应用层同步写 `audit_events`。

**V015 种子默认配置**：
| key | value | value_type | category | 说明 |
|---|---|---|---|---|
| `image_model` | `google/gemini-3.1-flash-image-preview` | string | ai | 海报 AI 模型 |
| `ai_workflow_timeout_seconds` | `60` | int | ai | |
| `daily_poster_limit_per_store` | `999999` | int | limits | 决策 D5 默认无上限 |
| `poster_batch_max_size` | `10` | int | limits | PO-D1 单次批量入队上限 |
| `promotion_upload_max_rows` | `20000` | int | limits | |
| `feishu_session_ttl_seconds` | `7200` | int | general | 会话有效期 |
| `usage_heartbeat_timeout_seconds` | `90` | int | general | |
| `feature_legacy_password_login` | `true` | bool | feature_flag | 决策 D2：M1 开启，全量后关 |
| `feature_admin_load_test` | `true` | bool | feature_flag | PO-F12 AI 压测入口 |

---

## 视图

### `v_store_product_curve`（V014）
门店 × SKU 的价格曲线，按 `snapshot_date` 排序。同日多条按 source 优先级取一条（`price_change` > `manual` > `erp_sync`）。供价盘 PR-A2「查询所有 SKU 的价格曲线」使用。

**列**：`store_id, product_id, sku_code, snapshot_date, retail_price, original_price, wholesale_price, sales_qty_30d, sales_amount_30d, gross_margin_30d, source, price_change_id`

### `v_active_competitor_price`（V014）
每个竞品商品取最近一条 `fact_competitor_price_weekly`，拼上渠道和我们的映射 SKU。仅活跃竞品、活跃渠道。供价盘 PR-A3 / 选品 SK-C3 / 主数据竞品查询使用。

**列**：`competitor_product_id, mapped_product_id, mapped_sku_code, competitor_product_name, competitor_brand, competitor_spec, competitor_product_url, competitor_image_url, channel_id, channel_code, channel_name, channel_kind, channel_city, snapshot_date, retail_price, promo_price, promo_text, collected_at`

### `v_promotion_active`（V014）
当前激活批次（`promotion_uploads.is_active=TRUE`）的全部促销商品，拼上 `dim_product.official_image_url`（决策 D8）。供海报 PO-E3「查询当前生效的全部促销」使用。

**列**：`promotion_id, upload_id, row_index, sku_code, product_name, unit, category_name, original_price, best_label, best_required_qty, best_total_price, best_effective_unit_price, best_saving_percent, all_options, valid_from, valid_to, valid_dates, mix_group_code, display_text, product_id, official_image_url, category_path`

### `v_super_admins`（V014）
当前活跃的超管列表。应用层判跨店权限时查这个视图。

**列**：`id, display_name, email, legacy_account, status, last_login_at`

### `v_login_events`（V012）
登录事件视图，兼容老海报项目的 `listLoginEvents` 接口。底层是 `audit_events WHERE event_kind = 'user_login'`。

**列**：`id, user_id, user_display_name, store_id, store_label, ip, user_agent, client_type, summary, created_at`

---

## ENUM 类型清单

V002 定义的 22 个枚举类型：

| 类型 | 取值 | 用在哪 |
|---|---|---|
| `app_role` | `super_admin`、`store_owner`、`analyst`、`account_manager` | `user_roles.role`、`audit_events.actor_role` |
| `user_status` | `active`、`disabled` | `users.status`、`stores.status` |
| `auth_method` | `feishu_qr`、`feishu_h5`、`legacy_password` | `auth_sessions.auth_method` |
| `feishu_client_type` | `feishu_h5`、`feishu_pc`、`browser` | `auth_sessions.client_type`、`audit_events.client_type`、`usage_sessions.client_type` |
| `store_ownership` | `direct`、`franchise` | `stores.ownership` |
| `user_store_role` | `manager`、`viewer` | `user_stores.role` |
| `product_status` | `active`、`delisted` | `dim_product.status` |
| `competitor_kind` | `online`、`offline` | `dim_competitor_channel.kind` |
| `benchmark_segment` | `core`、`innovation` | `benchmark_sku_allowlist.segment` |
| `assortment_action` | `add`、`remove`、`replace` | `ops_store_assortment_change.action` |
| `assortment_reason` | `ai_recommend_core`、`ai_recommend_innovation`、`low_sales`、`competitor_replace`、`shelf_space_limit`、`manual_keep`、`manual_remove`、`other` | `ops_store_assortment_change.reason_code` |
| `price_change_source` | `manual`、`ai_suggest`、`rule_engine` | `ops_store_price_change.source` |
| `shelf_runtime_status` | `empty`、`photo_uploaded`、`detected`、`reviewing`、`confirmed` | `shelf_runtime_state.status` |
| `virtual_shelf_status` | `idle`、`pending`、`running`、`succeeded`、`failed` | `shelf_runtime_state.virtual_status` |
| `sku_correction_kind` | `missed`、`false_positive` | `sku_corrections.correction_kind` |
| `sku_correction_reason` | `obstruction`、`low_resolution`、`new_sku`、`similar_packaging`、`other` | `sku_corrections.reason_code` |
| `promotion_scope` | `all_stores`、`city`、`store_list` | `promo_groups.scope` |
| `poster_mode` | `photo_compose`、`official_bg_only`、`multi_product` | `poster_jobs.mode`、`posters.mode` |
| `poster_job_status` | `queued`、`claimed`、`processing`、`succeeded`、`failed`、`canceled` | `poster_jobs.status` |
| `poster_template` | `vibrant`、`premium`、`minimal`、`custom` | `poster_jobs.template`、`posters.template` |
| `usage_session_status` | `active`、`ended`、`timeout` | `usage_sessions.status` |
| `app_setting_value_type` | `string`、`int`、`float`、`bool`、`json` | `app_settings.value_type` |

### `audit_event_kind`（单独列出，类型较多）

按业务域分组的所有事件类型：

**身份与会话**
`user_login`、`user_logout`、`user_session_refresh`、`feishu_oauth_success`、`feishu_oauth_fail`

**账号管理**
`user_create`、`user_update`、`user_disable`、`user_delete`、`user_password_reset`、`user_role_change`、`user_store_bind`、`user_store_unbind`

**门店主数据**
`store_create`、`store_update`、`store_insight_update`

**商品 / 销售 / 竞品**
`sku_import`、`competitor_price_import`

**选品业务**
`shelf_config_change`、`shelf_photo_upload`、`shelf_detect`、`shelf_survey_submit`、`shelf_assortment_apply`、`shelf_virtual_generate`（**AI 关键调用**）、`sku_correction_submit`

**价盘业务**
`price_change`（业务表 + 审计两层）、`price_ai_diagnose`（**AI 关键调用**）

**海报业务**
`poster_generate_sync`、`poster_batch_submit`、`poster_job_complete`、`poster_job_fail`、`promotion_batch_upload`、`promotion_batch_activate`、`promotion_batch_delete`

**超管 / 系统**
`super_admin_action`、`app_setting_change`、`ai_model_switch`、`ai_stress_test`

---

## 扩展

V001 启用的 PostgreSQL 扩展见 [全局基础设施](#全局基础设施)。

---

## 种子数据

V015 在所有迁移完成后插入：

1. **app_settings** 9 条默认配置（见 [`app_settings` 节](#71-app_settings-全局配置)）
2. **占位超管账号**：`legacy_account='admin'` / `legacy_password='changeme'`（bcrypt 哈希）+ `user_roles` 写一条 `super_admin` —— **M1 接通后必须立刻改密**
3. **plan_position_mapping** 12 行示例场景（糖巧、面包架、冷藏柜、冰柜、零食货架）

---

## 维护规则

1. **改 schema 必须先改迁移**：在 `apps/api/src/db/migrations/` 加新的 `V0XX__*.sql`，不要直接改老文件（老文件已跑过，再改不会生效）
2. **改完跑迁移**：`pnpm --filter @myj/api migrate:run`（应用启动时也会自动跑未应用的迁移）
3. **回来更新本文档**：新增 / 修改 / 删除字段都要在本文档对应表的字段列表里同步
4. **变更说明放迁移文件头注释**：本文档不重复写「为什么」，那部分写到迁移脚本顶部和 [`unified-database-spec.md`](./unified-database-spec.md) 的决策记录里
