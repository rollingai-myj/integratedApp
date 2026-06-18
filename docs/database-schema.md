# 数据库结构文档

> 给新加入项目的开发：每张表 / 每个字段是什么、什么时候被读、什么时候被写。优先用业务语言（不照搬 SQL 注释）。
>
> 数据源：
> - 迁移文件：[apps/api/src/db/migrations/](../apps/api/src/db/migrations/) — V001 到 **V030**（最新：[V030__promo_drop_weekday_mask_filter.sql](../apps/api/src/db/migrations/V030__promo_drop_weekday_mask_filter.sql)）
> - 视图：[V010__views.sql](../apps/api/src/db/migrations/V010__views.sql)（V029 把促销视图 `v_promotion_active` 删掉，换成新视图 `v_active_offers`）
> - SQL 函数：[V012__category_functions.sql](../apps/api/src/db/migrations/V012__category_functions.sql) + [V023 `fn_category_ancestor_name`](../apps/api/src/db/migrations/V023__category_ancestor_name_fn.sql)
> - V013 后的 prune：[V013__prune_unused_columns.sql](../apps/api/src/db/migrations/V013__prune_unused_columns.sql)
> - 字段 → 接口形态：见 [data-flow.md](./data-flow.md)
> - 字段 → HTTP 契约：见 [api-contracts.md](./api-contracts.md)
> - 字段 → 前端状态：见 [state-management.md](./state-management.md)
>
> **schema 演进记录（V014+）**：V014 删 `store_ownership` / 砍 `stores.district`；V015 缩瘦 `store_insights` + 加 POI 缓存列；V016 加 `stores.store_area_sqm` / `poi_category`；V017 加 `hq_products.barcode` / `is_returnable` / `allocation_unit`；V018 物理尺寸 mm → cm；V019 锁 `hq_products.category_id` 必须 L3 + 触发器；V020 `hq_promo_mix_groups` 表 → VIEW（V029 起整体作废）；V021 删 `hq_promo_sku_texts`；V022 烘焙 unit + L3 修正；V023 加 `fn_category_ancestor_name`；V024 `hq_benchmark_skus` → `hq_whitelist`（中间态）；V025 白名单合并为 `hq_products.is_whitelisted` 列 + 拆表；V026 加 `tags` / `market_min_price` / `market_min_price_source`；**V027** `store_sku_snapshots` 删 `original_price` / `wholesale_price`（只保留实际售价 `retail_price`）+ 价盘曲线改 snapshot 单源 + `store_price_changes` 读写路径废弃（表保留）+ 前端"调价"语义改为"模拟调价"；**V028** `store_scene_state` 加 4 个字段，让"诊断 / 选品"两个 AI 工作流也走后端常驻、关 tab 不丢；**V029 促销数据整体重构** —— 老促销表 / 视图全删，重建为「批次 + 档案行 + 标准化优惠」三层（含 5 个 sheet 的活动类别、4 类优惠机制），上传语义改为"新文件入库即把所有旧批次自动作废，同一时刻只有一份生效"；**V030** 把"今天是否在生效星期内"这一步从数据库视图里摘掉，交给前端按"今明"开关自己决定。

---

## 目录

- [0. ENUM 类型字典](#0--enum-类型字典)
- [1. 身份 / 会话 / 权限](#1--身份--会话--权限-v002)
- [2. 系统横切 / 全局设置](#2--系统横切--全局设置-v003--v011)
- [3. 总部主数据](#3--总部主数据-v004--v012)
- [4. 促销](#4--促销-v005)
- [5. 门店现状](#5--门店现状-v006)
- [6. 门店洞察 / 竞品 / 问卷](#6--门店洞察--竞品--问卷-v007)
- [7. 门店动作](#7--门店动作-v008)
- [8. 海报](#8--海报-v009)
- [9. 视图](#9--视图-v010)
- [10. SQL 函数](#10--sql-函数-v012)
- [11. 跨表才讲得清的业务规则](#11--跨表才讲得清的业务规则)
- [12. 业务动作 → 表写入路径速查表](#12--业务动作--表写入路径速查表)
- [13. "我想知道 X 该查哪"速查表](#13-我想知道-x-该查哪速查表)

---

## 业务域索引

| 业务域 | 涉及表 | 主要 service |
|---|---|---|
| 身份 / 权限 | users, user_sessions, user_roles, user_stores, user_feishu_identities, stores | auth, portal, admin-accounts, feishu-identity |
| 系统横切 | sys_audit_events, sys_usage_sessions, sys_settings | audit, admin-stats |
| 总部主数据 | hq_categories, hq_products | hq, ai-shelves (Dify whitelist via hq_products.is_whitelisted) |
| 促销 | hq_promo_batches, hq_promo_raw_items, hq_promo_offers（V029 起；旧的 batch_items / mix_groups 已删） | promotions |
| 门店现状 | store_scene_state, store_scene_shelves, store_sku_snapshots | scene, store-skus |
| 门店洞察 | store_insights, store_competitors, store_competitor_products, store_competitor_price_snapshots, store_survey_questions, store_survey_answers | competitors, surveys |
| 门店动作 | store_scene_adjustments, store_assortment_changes, store_scene_remakes, store_scene_virtual_history, store_sku_corrections, store_price_changes | scene, prices, ai-shelves |
| 海报 | store_poster_tasks, store_poster_task_products, store_poster_generations, store_poster_assets | posters |

---

## 0 · ENUM 类型字典

> 全部定义在 [V001__extensions_and_enums.sql](../apps/api/src/db/migrations/V001__extensions_and_enums.sql)。`audit_event_kind` 在 V013 删了 `price_ai_diagnose`、`price_change_source` 在 V013 删了 `ai_suggest`。

### 身份 / 权限

| 类型 | 取值 | 业务含义 |
|---|---|---|
| `user_status` | `active` / `disabled` | 用户启用状态 |
| `system_role` | `super_admin` / `store_owner` / `analyst` / `account_manager` | 系统角色；决定能访问哪些模块 |
| `auth_method` | `feishu_qr` / `feishu_h5` / `legacy_password` | 登录方式（飞书全量后废 legacy） |
| `client_type` | `feishu_h5` / `feishu_pc` / `browser` | 登录端 |
| `usage_session_status` | `active` / `ended` / `timeout` | 使用 session 状态（90s 无心跳 → timeout） |

### 系统横切

| 类型 | 取值 | 业务含义 |
|---|---|---|
| `setting_value_type` | `string` / `int` / `float` / `bool` / `json` | sys_settings 值的类型 |
| `audit_event_kind` | 见下面"审计事件全集" | 48+ 种业务动作的标签 |

**审计事件全集**（按业务域分组）：

- **认证**：`user_login`, `user_logout`, `user_session_refresh`, `feishu_oauth_success`, `feishu_oauth_fail`
- **账号**：`user_create`, `user_update`, `user_disable`, `user_delete`, `user_password_reset`, `user_role_change`, `user_store_bind`, `user_store_unbind`
- **门店**：`store_create`, `store_update`
- **导入**：`sku_import`
- **促销**：`promotion_batch_upload`, `promotion_batch_activate`, `promotion_batch_delete`
- **选品**：`scene_config_change`, `scene_photo_upload`, `scene_detect`, `scene_qa_submit`, `scene_env_update`, `scene_ai_diagnose`, `scene_ai_strategy`, `scene_assortment_apply`, `scene_virtual_generate`, `sku_correction_submit`
- **洞察**：`survey_submit`, `insight_generate`, `store_insight_update`
- **价盘**：`price_change`
- **海报**：`poster_task_submit`, `poster_generation_complete`, `poster_generation_fail`, `poster_adopt`, `poster_download`, `poster_asset_upload`, `poster_asset_delete`
- **竞品**：`competitor_update`, `competitor_product_update`, `competitor_price_collect`
- **系统**：`super_admin_action`, `app_setting_change`, `ai_model_switch`, `ai_stress_test`

### 总部主数据

| 类型 | 取值 | 业务含义 |
|---|---|---|
| `product_status` | `active` / `delisted` | 商品是否在售 |
| ~~`benchmark_segment`~~ | ~~`core` / `innovation`~~ | **已删除（V024 起；V025 把白名单进一步合并为 `hq_products.is_whitelisted` 列）** |
| ~~`store_ownership`~~ | ~~`direct` / `franchise`~~ | **已删除（V014 起）** |
| `promotion_scope` | `all_stores` / `city` / `store_list` | 选品文案的作用域 |

### 促销（V029 新增）

| 类型 | 取值 | 业务含义 |
|---|---|---|
| `promo_activity_type` | `member_price` / `weekend_beer` / `brand_coupon` / `tuesday_member` / `regular_coupon` | 促销 Excel 里 5 个 sheet 的活动类别：会员价 / 周末啤酒日 / 品牌满减券 / 周二会员日 / 常规优惠券 |
| `promo_mechanic` | `flat_price` / `bundle_price` / `percent_discount` / `pool_threshold` | 一条优惠"怎么算钱"的 4 种机制：单件特价 / 几件总价 / 百分比折扣（如会员 9 折）/ 整盘满减（如品牌满 88 减 10）。覆盖实测 14 种文案话术 |

### 门店现状 + 动作

| 类型 | 取值 | 业务含义 |
|---|---|---|
| `scene_state_status` | `empty` / `photo_uploaded` / `detected` / `reviewing` / `confirmed` | 场景调改状态机 |
| `scene_virtual_status` | `idle` / `processing` / `completed` / `failed` | 虚拟陈列子流程状态 |
| `assortment_action` | `add` / `remove` | 调改动作（上架 / 下架） |
| `assortment_reason` | `ai_recommend_core` / `ai_recommend_innovation` / `low_sales` / `competitor_replace` / `shelf_space_limit` / `manual_keep` / `manual_remove` / `other` | 调改原因码 |
| `price_change_source` | `manual` / `rule_engine` | 调价来源（V013 删除了 `ai_suggest`） |
| `sku_correction_kind` | `missed` / `false_positive` / `add` / `remove` / `observe` | 纠错类别（与 scope 配对） |
| `sku_correction_scope` | `detection` / `decision` | 纠错范围（识别 / 决策） |
| `competitor_kind` | `online` / `offline` | 竞对类型 |

### 海报

| 类型 | 取值 | 业务含义 |
|---|---|---|
| `poster_mode` | `photo_compose` / `official_bg_only` / `multi_product` | 海报模式（拍照合成 / 官方底图 / 多商品拼组） |
| `poster_template` | `vibrant` / `premium` / `minimal` / `custom` | 海报模板风格 |
| `poster_generation_status` | `queued` / `claimed` / `processing` / `succeeded` / `failed` / `canceled` | 海报生成状态机 |

---

## 1 · 身份 / 会话 / 权限 (V002)

### `users`

> 能登录系统的人：店长、运营、分析师、超级管理员。[V002.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 用户唯一标识 | `auth.service.findOrCreateUser()` 飞书首登；`admin-accounts.createAccount()` 手工建号 | 所有认证 / 权限校验都通过此键 |
| display_name | TEXT NOT NULL | 用户昵称（界面展示）；飞书优先取飞书名 | `loginWithPassword()` 创建会话；`feishu-identity.refreshUserProfile()` 飞书登录后刷新；`admin-accounts.createAccount()` 创建时赋值 | `auth.ts` 拼 MeResponse；后台账号列表 |
| email | TEXT | 邮箱（可空）；飞书优先取 feishu_email | `upsertUserFromFeishu()` 首登 / 刷新；后台创建 | 后台展示；用作飞书 ↔ legacy 账号桥梁 |
| avatar_url | TEXT | 头像 URL | `refreshUserProfile()` 飞书登录刷新；后台创建 | MeResponse；前端头像 |
| phone | TEXT | 手机号（可空，无业务逻辑） | 后台创建 | 后台展示 |
| legacy_account | TEXT UNIQUE (partial, deleted_at IS NULL) | 旧账号；飞书全量后清空删列 | 后台手工建号 | `loginWithPassword()` 按此查；`findOrCreateUser()` 按邮箱反查 |
| legacy_password_hash | TEXT | 密码哈希（bcrypt） | `admin-accounts.resetPassword()` | `loginWithPassword()` 校验 |
| status | user_status NOT NULL, DEFAULT 'active' | 启用状态（disabled = 不能登录 + 会话失效） | `setAccountStatus()` | `auth.ts requireAuth()` 校验 |
| last_login_at | TIMESTAMPTZ | 最后登录时刻 | 登录成功后 UPDATE | 后台展示；识别僵尸账号 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | 排序 / 审计 |
| deleted_at | TIMESTAMPTZ | 软删（NULL = 未删） | `admin-accounts.deleteAccount()` | 所有查询 `WHERE deleted_at IS NULL` |

**约束亮点**：`legacy_account` / `email` 都用 partial UNIQUE（仅约束未删除行）— 允许软删后重用账号。

**触发动作**：登录 → 写 `users.last_login_at` + 写 user_sessions + 写 sys_audit_events('user_login')。

---

### `user_sessions`

> 用户登录会话。记录在哪家店、何时过期。[V002.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 会话唯一标识 | DB | sys_usage_sessions.auth_session_id FK |
| user_id | UUID FK(users) NOT NULL | 会话所属用户 | INSERT 时 | `middleware/auth.ts loadUserFromToken()` |
| token_hash | TEXT NOT NULL UNIQUE | 明文 token 的 SHA-256；明文不入库 | `auth.service.issueToken()` 时 | `extractToken()` → 按 hash 定位会话 |
| auth_method | auth_method NOT NULL | 登录方式 | INSERT | 后台审计 |
| client_type | client_type NOT NULL, DEFAULT 'browser' | 登录端 | INSERT | 后台审计 |
| **active_store_id** | UUID FK(stores) | **当前激活的门店**；NULL = 未选店 | `portal.switchActiveStore()`（唯一入口） | `loadUserFromToken()` 把它放进 req.user.currentStoreId；所有业务模块用 |
| user_agent / ip | TEXT / INET | 客户端标识 + IP | INSERT | 审计 / 安全 |
| issued_at | TIMESTAMPTZ NOT NULL | 颁发时刻 | DB | — |
| last_seen_at | TIMESTAMPTZ NOT NULL | 最后活跃时刻 | 每次 `/auth/me` 异步刷新 | 在线人数统计（last_seen_at >= now()-5m） |
| expires_at | TIMESTAMPTZ NOT NULL | 过期时刻 | INSERT 计算 = now() + SESSION_TTL_SECONDS | `loadUserFromToken()` 校验 expires_at > now() |
| revoked_at | TIMESTAMPTZ | 撤销时刻 | `logoutByToken()` | `loadUserFromToken()` 校验 IS NULL |

**约束亮点**：`active_store_id` 可为 NULL；切店唯一入口 `portal.switchActiveStore()`（设计决策 D11）。

**触发动作**：登录 → INSERT；切店 → UPDATE active_store_id + last_seen_at；登出 → UPDATE revoked_at；每次受保护请求 → UPDATE last_seen_at（异步、静默）。

---

### `user_roles`

> 用户 ↔ 系统角色多对多。一个用户可有多个角色。[V002.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| user_id, system_role | 复合 PK | 用户 + 角色 | `feishu-identity.syncRoles()` 按部门自动赋；`admin-accounts.setAccountRoles()` 手工赋 | `auth.ts requireAuth()` / portal.service 计算 MODULES_BY_ROLE |
| granted_at | TIMESTAMPTZ | 赋予时刻 | DB | 审计 |
| granted_by | UUID FK(users) | 谁赋的（飞书自动赋时 NULL） | INSERT | 审计 |

**触发动作**：飞书登录 → 自动 syncRoles（super_admin / store_owner 由部门推断）；后台改角色 → DELETE 全部 + INSERT 新集合（整体替换语义）。

---

### `user_stores`

> 用户 ↔ 门店多对多。一人可管多店、一店可多人管。[V002.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| user_id, store_id | 复合 PK | 绑定关系 | `feishu-identity.syncStoreBindings()` additive；`admin-accounts.setAccountStores()` 整体替换 | `auth.loadVisibleStores()` 非超管可见门店 |
| is_primary | BOOLEAN | 主门店标记（仅首登第一条；切店实际看 user_sessions.active_store_id） | INSERT | portal 排序优先 |
| assigned_at / assigned_by | TIMESTAMPTZ / UUID | 时间 + 操作者 | INSERT | 审计 |

**设计决策 D1**：super_admin 不需要在 user_stores 有记录就能看到所有门店（`auth.loadVisibleStores()` 走特殊分支）。

---

### `user_feishu_identities`

> 用户 ↔ 飞书身份一对一绑定。[V002.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 表 PK | DB | — |
| user_id | UUID FK(users) UNIQUE | 绑定的用户（UNIQUE：一用户一飞书） | `upsertFeishuBinding()` | `findOrCreateUser()` 按 open_id 反查 |
| open_id | TEXT NOT NULL UNIQUE | 飞书应用级唯一 ID | 每次登录刷新 | 主要查找键 |
| union_id | TEXT | 飞书租户级 ID（应用改范围时变） | 每次登录刷新 | open_id 找不到时 fallback |
| tenant_key | TEXT | 飞书租户标识（预留） | INSERT | — |
| feishu_email / feishu_mobile / feishu_name / feishu_avatar_url | TEXT | 飞书系统中的对应字段（快照） | 每次登录刷新 | users.* 字段的兜底来源 |
| access_token | TEXT | 飞书 access_token | 每次登录刷新 | 后续如需调飞书 API |
| refresh_token | TEXT | refresh_token（暂未使用） | — | — |
| token_expires_at | TIMESTAMPTZ | access_token 过期时刻 | INSERT 计算 | 主动刷新对标 |
| bound_at / last_synced_at | TIMESTAMPTZ | 首绑时刻 / 最近同步 | INSERT / UPDATE | 运维诊断 |

**设计决策 D2**：findOrCreateUser 三级查找：open_id → union_id → email（用于过渡期飞书账号绑定 legacy 账号）。

---

### `stores`

> 美宜佳门店档案。[V002.sql](../apps/api/src/db/migrations/V002__identity_org.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 门店唯一标识 | DB | 所有涉店操作的 FK 目标 |
| store_code | VARCHAR(32) NOT NULL UNIQUE | 门店编号（不可重用，软删后编号不可重） | 手工 / 数据导入 | feishu-identity 按 store_code 反查匹配门店 |
| store_name | TEXT NOT NULL | 门店名 | 创建时 | 前端展示 |
| province / city / address | TEXT | 地理信息；`city` 给"周边商圈"调高德 API 必填 | 创建时 | portal 返回前端；选品周边商圈 |
| latitude / longitude | NUMERIC(9,6) | GPS 坐标；返回前端时转 number | 创建时 | portal 返回 |
| opened_at | DATE | 开业日期 | 创建时 | 运营统计 |
| is_project_store | BOOLEAN NOT NULL, DEFAULT false | 是否项目店（无权限约束，仅标记） | 创建时 / 后台改 | 前端 UI 标记 |
| **store_area_sqm** | NUMERIC(6,2) | **V016 新增** · 门店面积（㎡）；可空 | 创建时 / 后台改 | Dify 选品 inputs · 报告展示 |
| **poi_category** | TEXT | **V016 新增** · 门店商圈类型标签（HQ 主数据；区别于 `store_insights.category` 的 AI 分析输出） | 创建时 / 后台改 | Dify 选品 inputs · 报告展示 |
| status | user_status NOT NULL, DEFAULT 'active' | 启用状态（disabled = 不能进） | INSERT 默认 / 后台改 | 所有查询过滤 |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | 时间戳 + 软删 | DB | 列表排序 / 过滤 |

---

## 2 · 系统横切 / 全局设置 (V003 / V011)

### `sys_audit_events`

> 系统操作流水（append-only）。每个写操作落一条审计。[V003.sql](../apps/api/src/db/migrations/V003__sys_crosscutting.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 事件 ID | DB | 排序 |
| event_kind | audit_event_kind NOT NULL | 48+ 种操作类型 | `audit.writeAuditEvent()` 由各模块传入 | `admin-stats.listAuditEvents()` 按 kind 筛 |
| actor_user_id | UUID（**无 FK**） | 操作者 ID；无约束允许悬挂 | req.user.id 赋值 | 后台审计查询 |
| actor_role / actor_display_name | TEXT（**快照**） | 角色 / 昵称快照（防关联改时丢历史） | INSERT | 审计展示 |
| target_store_id / target_store_label | UUID / TEXT | 涉及门店 + 编号快照 | 业务模块赋值 | 按店筛选 |
| target_type / target_id | TEXT | 目标对象类型 + ID（自由文本） | 业务模块赋值 | 追踪某对象 |
| summary | TEXT | 人话摘要（'用户登录'） | 业务模块赋值 | 审计列表 |
| payload | JSONB NOT NULL, DEFAULT '{}' | 详细 JSON（新旧值对比、AI prompt 等） | 业务模块赋值 | 详情查看 / 分析 |
| is_ai_call | BOOLEAN NOT NULL, DEFAULT false | 是否涉及 AI 调用（成本核算） | AI 模块赋值 | 成本统计 |
| ai_workflow / ai_model | TEXT | AI 工作流 + 模型名 | AI 模块赋值 | 按模型 / 工作流分摊 |
| ai_input_tokens / ai_output_tokens / ai_latency_ms | INT | AI token + 延迟 | AI 模块赋值 | 成本 / 性能分析 |
| ai_status / ai_error | TEXT | AI 调用结果 / 错误 | AI 模块赋值 | 可靠性分析 |
| request_id | TEXT | 链路追踪 ID | middleware 注入 | 日志关联 |
| ip / user_agent / client_type | INET / TEXT / client_type | 客户端环境 | INSERT | 安全 / 设备分析 |
| created_at | TIMESTAMPTZ NOT NULL | 发生时刻 | DB | 时间线 |

**设计决策 D10**：append-only，无 FK 约束，所有关联字段都是快照 — 即使用户 / 门店删除，审计记录仍可读懂。

**触发动作**：登录 / 登出 / 后台改账号 / 后台改设置 / AI 调用 / 选品 / 调价 / 海报 → 每个动作都 INSERT 一行。

---

### `sys_usage_sessions`

> 使用时长切片。绑登录会话，记录用户实际操作时长。[V003.sql](../apps/api/src/db/migrations/V003__sys_crosscutting.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 切片 ID | DB | 心跳传参 |
| auth_session_id | UUID FK(user_sessions) NOT NULL | 关联的登录会话 | `portal.startUsageSession()` | 同 |
| device_id | TEXT | 设备标识（多端分析） | `startUsageSession()` body 赋 | 后台设备统计 |
| status | usage_session_status, DEFAULT 'active' | active / ended / timeout | 启动时；超时检测；用户关闭 API | 在线人数：`WHERE status='active' AND last_heartbeat_at >= now()-5m` |
| started_at | TIMESTAMPTZ NOT NULL | 开始时刻 | DB | 统计窗口 |
| last_heartbeat_at | TIMESTAMPTZ NOT NULL | 最后心跳（前端 30s 一次） | `heartbeatUsageSession()` | 超时判定（< now() - 90s） |
| ended_at / ended_reason | TIMESTAMPTZ / TEXT | 结束时刻 + 原因 | 关闭 API / 超时检测 | duration 计算 |
| duration_seconds | INT GENERATED ALWAYS STORED | 自动计算（ended_at - started_at） | DB | 时长统计 |
| attributes | JSONB | 扩展属性 | — | — |

**触发动作**：app 打开 → INSERT + 检查旧会话是否超时；30s 心跳 → UPDATE last_heartbeat_at；关闭 → UPDATE status='ended'。

---

### `sys_settings`

> 运营可调的全局配置。[V003.sql](../apps/api/src/db/migrations/V003__sys_crosscutting.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| key | TEXT PK | 配置键 | 后台 upsert | 业务代码 SELECT |
| value | TEXT NOT NULL | 配置值（字符串存，业务转类型） | 后台改 | 业务读 |
| value_type | setting_value_type NOT NULL, DEFAULT 'string' | string / int / float / bool / json | INSERT | 后台 UI 选控件 |
| description | TEXT | 人话描述 | INSERT | 后台 UI 帮助 |
| category | TEXT | 分类（ai / limits / feature_flag / general） | INSERT | 后台 UI 分组 |
| is_secret | BOOLEAN, DEFAULT false | 是否敏感（敏感信息走 .env，不入库） | INSERT | UI 隐藏 |
| updated_by | UUID FK(users) | 最后操作者 | 后台改 | 审计 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

**V011 默认值**：

| key | value | category |
|---|---|---|
| `poster_image_model` | `google/gemini-2.5-flash-image` | ai |
| `ai_workflow_timeout_seconds` | `60` | ai |
| `daily_poster_limit_per_store` | `999999` | limits |
| `poster_batch_max_size` | `10` | limits |
| `promotion_upload_max_rows` | `20000` | limits |
| `feishu_session_ttl_seconds` | `7200` | general |
| `usage_heartbeat_timeout_seconds` | `90` | general |
| `feature_legacy_password_login` | `true` | feature_flag |
| `feature_admin_load_test` | `true` | feature_flag |

---

## 3 · 总部主数据 (V004 / V012 / V017-V019 / V022-V026)

### `hq_categories`

> 4 层品类树：场景 → 大类 → 中类 → 小类。`scene` 列只在 level=0 非空。[V004.sql](../apps/api/src/db/migrations/V004__hq_master_data.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | SQL 初始化 | 所有读 |
| parent_id | UUID FK(hq_categories) | 父品类；level=0 时 NULL | 初始化 | 树遍历（`hq.getCategoryTree()`） |
| level | SMALLINT (0-3) | 0=场景 / 1=大 / 2=中 / 3=小 | 初始化 | 过滤 |
| scene | SMALLINT UNIQUE | 场景业务码（仅 level=0 非空）；**全库 scene 唯一来源** | 初始化 | `hq.listScenes` / `assertSceneExists` / 所有 scene 过滤 |
| category_code | VARCHAR(64) UNIQUE | 品类编码（供应链标识） | 初始化 | 人工查、导入关联 |
| category_name | TEXT | 显示名（"巧克力"） | 初始化 | 前端 / 报表 |
| display_order | INT | 同层内排序 | 初始化 / 维护 | 树展示 |
| is_active | BOOLEAN | 逻辑删 | 初始化 / 软删 | `getCategoryTree` 过滤 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

**关键约束**：`(level=0) ⇔ (scene IS NOT NULL)` / `(level=0) ⇔ (parent_id IS NULL)`。

**层级业务含义**：
- **level 0（场景）**：营销维度（"酒水""日用"）；scene = 1-12 全库唯一
- **level 1 / 2 / 3**：商品细分（食品 / 生鲜 / 蔬菜）；商品 `hq_products.category_id` 通常指向 L1-L3 某一层

---

### `hq_products`

> 总部商品档案，全门店共用的 SKU 档案。[V004.sql](../apps/api/src/db/migrations/V004__hq_master_data.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 商品唯一标识 | 初始化 / 后台新增 | 所有关联表 FK |
| sku_code | VARCHAR(64) UNIQUE | 供应链 SKU 编码 | 初始化 | 全栈业务标识 |
| product_name | TEXT | 商品名 | 初始化 | 前端 / 搜索 |
| brand / spec / unit / series | TEXT | 品牌 / 规格 / 单位 / 系列 | 初始化 | 前端 / 选品 |
| shelf_life_days | INT | 保质期天数 | 初始化 | 选品过滤 |
| length_cm / width_cm / height_cm | NUMERIC(10,2) | 物理尺寸（厘米，V018 起 mm → cm） | 初始化 | 货架规划 / 选品 |
| barcode | VARCHAR(32) | 条码（V017） | 初始化 / 后台改 | 条码图重定向 / 入库扫码 |
| is_returnable | BOOLEAN（可空） | 是否可退货（V017） | 初始化 / 后台改 | Dify inputs.sku_attributes.items[].isReturnable（null 兜底 false） |
| allocation_unit | INT（可空） | 配货单位（V017） | 初始化 / 后台改 | Dify inputs.sku_attributes.items[].allocation_unit |
| category_id | UUID FK(hq_categories) | 所属品类 | 初始化 | `fn_category_path` / `fn_category_scene` |
| is_new_product | BOOLEAN | 是否新品 | 初始化 / 后台改 | 选品优先级；Dify inputs.sku_attributes.items[].isNew |
| is_private_label | BOOLEAN | 是否自有品牌 | 初始化 | 采购 / 选品；Dify inputs.sku_attributes.items[].isPrivate |
| is_whitelisted | BOOLEAN NOT NULL DEFAULT false | 是否在上架待选池白名单内（V025 起，替代旧 hq_whitelist 表） | 初始化 / 后台改 | Dify inputs.sku_attributes.items[].is_whitelisted（V026 改成每 SKU 自带标记，不再有 whitelist 顶层字段） |
| market_min_price | NUMERIC(12,2) | 外部市场最低零售价（元）（V026） | 初始化 / 后台改 | Dify inputs.sku_attributes.items[].marketMinPrice |
| market_min_price_source | TEXT | 最低价来源（示例："好享来"）（V026） | 初始化 / 后台改 | Dify inputs.sku_attributes.items[].marketMinPriceSource |
| tags | TEXT[] NOT NULL DEFAULT '{}' | 商品标签数组（示例：{'引流品','S级'}）（V026） | 初始化 / 后台改 | Dify inputs.sku_attributes.items[].tags；GIN 索引按标签筛选 |
| wholesale_price | NUMERIC(12,2) | 批发价（进价） | 初始化 / 后台改 | 成本计算 |
| suggested_retail_price | NUMERIC(12,2) | 总部建议零售价 | 初始化 / 后台改 | 促销基准；门店实价见 store_sku_snapshots |
| introduced_at | DATE | 上市日期 | 初始化 | 新品判定 |
| `official_image_url` | — | **已删除（V013 起）**；图片走 OSS 命名约定 | — | — |
| status | product_status NOT NULL, DEFAULT 'active' | active / delisted | 初始化 / 后台下架 | `WHERE status='active'` |
| attributes | JSONB | 扩展属性 | 初始化 | 特殊业务 |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | 时间戳 + 软删 | DB | 过滤 |

**图片处理**（V013 后）：商品图改为 `GET /hq/products/:skuCode/official-image` 302 重定向到 OSS（命名约定 `product_pic/{skuCode}.png`）；支持动态 `?w=` 缩放参数。

---

### ~~`hq_whitelist`~~

> **已删除（V025 起）**：白名单合并为 `hq_products.is_whitelisted BOOLEAN`。V026 进一步把白名单/新品信息扁平到 Dify inputs.sku_attributes.items[] 每 SKU 自带标记，不再有 `inputs.whitelist` / `inputs.new_product_skus` 顶层字段。[V025.sql](../apps/api/src/db/migrations/V025__hq_products_is_whitelisted.sql)
> 历史脉络：V004 `hq_benchmark_skus` (core/innovation) → V024 重命名为 `hq_whitelist` (按 L3 category_id 分场景) → V025 扁平化为 `hq_products.is_whitelisted` 列 → V026 直接放到 inputs.sku_attributes 每 SKU 上。

---

## 4 · 促销 (V029 整体重构)

> **数据架构（V029 起）**：原"批次 + 单品行 + 凑单组"三表（`hq_promo_batches` 旧版 / `hq_promo_batch_items` / `hq_promo_mix_groups`）全部丢弃，重建为三层：
>
> - 「批次」`hq_promo_batches` —— 总部每上传一份新 Excel 就开一行；**上传 = 全量替换**，开新行那一刻把所有旧批次自动作废 → 同一时刻只有一份生效的促销文件。
> - 「档案行」`hq_promo_raw_items` —— Excel 5 个 sheet 里每一行原样落档，用于复盘"原表格上当时写了什么"。
> - 「标准化优惠」`hq_promo_offers` —— 把每条档案行翻译成机器能算价的形式（原价 + 机制 + 参数 + 有效期 + 在哪些星期生效）；店长侧所有"最优档 / 凑券 / 叠加"都从这层算出。
> - 「今天哪些优惠在跑」`v_active_offers` —— 视图：按 `valid_from..valid_to` 日期窗口 + 批次未作废自动过滤；"今天是不是这个优惠生效的星期"V030 起改交给前端按"今明"开关自己判（数据库不再卡）。
>
> `hq_promo_offers.pool_label` 字段承担「凑单池」概念，不再有独立表 —— 同一 batch + 同一 `activity_type` + 同一 `pool_label` 的所有 offer 就构成一个凑单组（如"怡宝饮料品牌满减券"池）。

### `hq_promo_batches`

> 总部每次上传一份新的促销 Excel，就在这张表新增一行。**全库同一时刻最多一份 `is_voided=false` 的批次** —— 这就是店长在 /posters 首页看到的"本期活动"。新批次入库的事务内会把所有旧批次的 `is_voided` 翻成 true；外加一把 `pg_advisory_xact_lock` 防并发上传留下两条"鬼批次"。[V029.sql](../apps/api/src/db/migrations/V029__promo_data_redesign.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 本批活动的稳定标识 | 总部上传 Excel 时新建一行 | 档案行 / offers 通过它关联；店长端 API 透传作为"促销版本号" |
| file_name | TEXT NOT NULL | 原始 Excel 文件名（如 `6月下营销活动（会员价+叠券）.xlsx`） | 上传时存档 | 总部"促销批次"历史列表 |
| source_file_url | TEXT | 原 Excel 在 OSS 的下载链接（可空） | 上传时存档 | 总部端"下载原文件" |
| uploaded_by | UUID FK(users) | 哪个总部账号上传的这一批 | 上传接口取当前登录用户 | 总部"上传人"列；审计追溯 |
| **is_voided** | BOOLEAN NOT NULL DEFAULT FALSE | **本批次是否已作废**。新文件入库时旧批次会被批量翻成 true，店长立即看到新版本 | 上传事务内 UPDATE 旧批次为 true；总部可手动作废 | `v_active_offers` 视图按此过滤；店长所有促销查询自动只看未作废 |
| activity_window_start | DATE | 这一批所有活动的最早开始日（取全部档案行 `valid_from` 的 min） | 上传解析时算出 | 总部列表展示"本批活动窗口" |
| activity_window_end | DATE | 这一批所有活动的最晚结束日（取全部档案行 `valid_to` 的 max） | 上传解析时算出 | 同上 |
| parse_warnings | JSONB NOT NULL DEFAULT '[]' | 解析告警数组（如"第 12 行价格非数字 → 跳过"） | 上传解析时追加 | 总部"查看告警"用于排查脏数据 |
| **row_total** | JSONB NOT NULL DEFAULT '{}' | Excel 各 sheet 原始行数计数（`{member_price: 482, brand_coupon: 213, ...}`） | 上传解析时回写 | 总部列表展示 + 和 parsed_total 对比看丢了多少 |
| **parsed_total** | JSONB NOT NULL DEFAULT '{}' | 各 sheet 最终入库的标准化 offer 数量 | 同上 | 同上 |
| parsed_at | TIMESTAMPTZ | 解析完成时刻 | 上传事务内写 | 总部列表 |
| notes | TEXT | 上传时留的备注（如"618 前置版本"） | 上传时可选填 | 总部列表 |
| created_at / updated_at | TIMESTAMPTZ | DB 时间戳 | DB | 排序 / 审计 |

**关键约束**（V029 修订）：
- **不再有 `is_active` 唯一索引** —— 用「上传 = 全量替换」+ `is_voided` 翻转 + advisory lock 替代。语义更简单：永远只有"未作废"是当前生效。
- 索引：`hq_promo_batches_window_idx (activity_window_start, activity_window_end)`。

**触发动作**：上传 → `pg_advisory_xact_lock('hq_promo_batches.upload')` → UPDATE 全部旧批次 `is_voided=true` → INSERT 新批次 → 循环 INSERT raw_items + offers → 整事务提交。

---

### `hq_promo_raw_items`

> Excel 里每一行原样的档案副本（5 个 sheet 都进同一张表，靠 `activity_type` 区分）。**上传时点冻结的快照**：商品名 / 单位 / 原价 / 总部写的活动话术等全部拷下来，事后改 `hq_products` 主数据不影响本表 —— 保证历史促销可复现 + 出问题时能回看"原表格当时是怎么写的"。[V029.sql](../apps/api/src/db/migrations/V029__promo_data_redesign.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 档案行稳定标识 | 上传解析时生成 | offer 行通过它反查源行 |
| batch_id | UUID FK(hq_promo_batches) ON DELETE CASCADE | 所属批次 → 批次作废后档案随之沉睡（仍可查） | 上传解析时写入 | 按批次过滤；批次删除时级联清空 |
| **activity_type** | `promo_activity_type` NOT NULL | 这一行来自哪个 sheet：会员价 / 周末啤酒日 / 品牌满减券 / 周二会员日 / 常规优惠券 | 上传解析时按 sheet 名识别 | 店长前端"今/明有效"+ 黄色标签的来源 |
| sheet_row_no | INTEGER NOT NULL | 在原 Excel sheet 里的真实行号 | 按 Excel 顺序写入 | 解析告警里指认是第几行；前端稳定排序 |
| sku_code | VARCHAR(32) NOT NULL | 商品 SKU 码 | 上传解析时拷贝 | 店长端找货、和门店实际库存对账；offer 通过它关联 |
| sku_name_original | TEXT NOT NULL | **商品名快照**（Excel 上写的原始名，连规格一起；如"佳龙笋海春笋(山椒味)32g"） | 上传解析时拷贝 | 店长端 SKU 卡片标题；某 SKU 没在主数据里时的兜底名 |
| unit | VARCHAR(16) | 计量单位（如"瓶"、"袋"） | 上传时拷贝 | 店长端拼"X 元 / 单位"文案 |
| original_price | NUMERIC(10,2) NOT NULL | 原价（**快照**） | 上传时拷贝 | 算"省 X%"折扣率的基准 |
| raw_method_text | TEXT | 总部在 Excel 里写的活动话术原文（如"买 5 瓶送 1 瓶"、"满 88 减 10"、"会员 9 折"） | 上传时拷贝 | 解析器从这里推断 `mechanic`；总部排查复盘 |
| qty_required | INTEGER | 解析话术得出的"需要买几件"（如"2 件 9.9"对应 2） | 上传解析时填 | 凑单组卡片展示"凑齐 N 件即满减" |
| promo_total_price | NUMERIC(10,2) | 话术里的促销价 / 总价（如"2 件 9.9"对应 9.9） | 上传解析时填 | offer 的 `mechanic_params` 算价 |
| **promo_group_code** | VARCHAR(64) | 会员价 sheet 上的"促销组"编号（同组商品凑齐才享会员价） | 上传解析时拷贝 | 翻成 offer 的 `pool_label = member_price/促销组N`，店长端聚成组卡 |
| category_code | VARCHAR(16) | 总部品类编码（**快照**） | 上传解析时拷贝 | 主数据找不到时作为分类兜底 |
| category_name | TEXT | 大类名（**快照**，如"饼干"、"饮料"） | 上传解析时拷贝 | 店长首页 13 个分类聚合（再走 `mapCategoryToGroup` 映射） |
| valid_from / valid_to | DATE NOT NULL | 本商品促销开始 / 结束日 | 上传解析时写入 | offer 的有效期窗口；店长"今日有效"判定 |
| fill_down_anchor_row | INTEGER | 品牌满减 sheet 的"向下合并单元格"指向哪一行（解析时的辅助列） | 解析时填 | 总部端复盘解析告警；前端不消费 |
| created_at | TIMESTAMPTZ NOT NULL | DB 时间戳 | DB | 兜底 SELECT 取最近一条 |

**索引**：`(batch_id, activity_type)` / `(sku_code)`。

**业务不变量**：`sku_name_original / unit / category_name / original_price` 是 Excel 上传时点的冻结快照，永不跟随主数据更新；保证历史促销可复现。

---

### `hq_promo_offers`

> **店长侧的所有价格、最优档、凑单组卡片，全部从这张表算出**。每条档案行翻译成一到多条标准化 offer：把"买 5 瓶送 1 瓶"这类话术换成机器能算价的四元组 `(mechanic, mechanic_params, valid_window, is_stackable)`。[V029.sql](../apps/api/src/db/migrations/V029__promo_data_redesign.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | offer 稳定标识 | 上传解析时生成 | API 透传 |
| raw_item_id | UUID FK(hq_promo_raw_items) ON DELETE CASCADE | 这条 offer 来自哪条档案行 | 上传解析时写入 | 总部排查时回看原 Excel 行 |
| batch_id | UUID FK(hq_promo_batches) ON DELETE CASCADE | 所属批次 → 跟随批次作废自动隐藏 | 上传解析时写入 | `v_active_offers` 视图过滤；批次删除时级联清空 |
| activity_type | `promo_activity_type` NOT NULL | 来自哪个 sheet —— 决定店长端展示什么活动标签（"会员价" / "周末啤酒日" / "品牌满减券" / "周二会员日" / "常规优惠券"） | 同档案行 | 店长前端给"绿色徽章"取文案；"组卡 + 单品卡"区分 |
| sku_code | VARCHAR(32) NOT NULL | 商品 SKU 码 | 同档案行 | 店长端按 SKU 聚合所有可用 offer，选最优 |
| **mechanic** | `promo_mechanic` NOT NULL | 这条 offer 怎么算钱：单件特价 / 几件总价 / 百分比折扣 / 整盘满减 | 解析话术时识别 | 算价器按机制走不同分支 |
| **mechanic_params** | JSONB NOT NULL | 算价所需的具体参数：`bundle_price` 存 `{ qty, totalPrice, subtype }`、`percent_discount` 存 `{ percent }`、`pool_threshold` 存 `{ threshold, discount }`、`flat_price` 存 `{ price }` | 解析话术时填 | 店长端算最终价 / 卡片文案 |
| **pool_label** | TEXT（可空） | "凑单池"标签：会员价的促销组 → `member_price/促销组212`；品牌满减券的品牌段落 → `brand_coupon/怡宝饮料品牌满减`。**同 batch + 同 activity_type + 同 pool_label 的 offers 自动聚成一个组卡** | 解析时构造 | 店长 /posters 首页把成员单品折叠成"组卡 + 凑齐价"置顶 |
| original_price | NUMERIC(10,2) NOT NULL | 原价（从档案行拷过来；算"省 X%"基准） | 上传解析 | 店长卡片划线价 |
| **valid_weekday_mask** | SMALLINT NOT NULL | 7-bit 位掩码标识本 offer 在哪几天生效（Mon=0b1000000 ... Sun=0b0000001；周末啤酒日 = 7、周二会员日 = 32、一般活动 = 127）| 解析时按 activity_type 推 | **V030 起前端独立判定**："今明" toggle 选中 = 仅命中今/明的 mask；未选 = 全部展示；黄色标签"今日有效 / 明日有效 / 仅周X"也按 mask 决定 |
| valid_from / valid_to | DATE NOT NULL | offer 生效起止日 | 同档案行 | `v_active_offers` 视图按 `current_date BETWEEN ...` 过滤 |
| **is_stackable** | BOOLEAN NOT NULL | 这条 offer 能不能和其他 offer 叠加。`percent_discount` / `pool_threshold` 默认可叠（"会员 9 折 + 品牌满 88 减 10"），`flat_price` / `bundle_price` 默认不叠 | 解析时按机制定 | 算价器决定要不要给该 SKU 探索叠券路径 |
| parse_note | TEXT | 解析过程中的注解（如"话术含'起'字，按上限算"） | 解析时可填 | 总部排查 |
| created_at | TIMESTAMPTZ NOT NULL | DB 时间戳 | DB | — |

**索引**：`(batch_id)` / `(sku_code)` / `(batch_id, activity_type, pool_label) WHERE pool_label IS NOT NULL` / `(valid_from, valid_to)`。

**典型读路径**（`promotions.service.ts → fetchPromoDataset`）：
1. `SELECT FROM v_active_offers` 拿出今天日期窗口内、未作废批次的全部 offers
2. 按 `sku_code` 聚合 → 喂给 `computeBest()` 算价器
3. 算价器跑两遍：一遍允许叠所有可叠优惠（"叠券模式"），一遍只考虑 `activity_type = 'member_price'` 的 offer（"只用会员价"模式）—— 前端 toggle 切换的就是这两条独立结果集
4. `pool_label` 相同的 SKU 在前端 shim 里聚成组卡置顶；其它落单品卡

---

> **关于已删除的旧表**：原 `hq_promo_batch_items` / `hq_promo_mix_groups` 在 V029 全部 DROP；旧的"`hq_promo_batches.is_active` 唯一索引 + activated_at / deactivated_at"那一套激活语义已废弃，换成更简单的"上传即替换 + is_voided 翻转"。如需复盘老历史，参考 V029 之前的 git 历史 + 该次迁移注释。

---

## 5 · 门店现状 (V006)

### `store_scene_state`

> 场景工作台核心表。管理调改流程、照片、AI 检测、虚拟陈列、周边环境摘要。每店每场景一行。[V006.sql](../apps/api/src/db/migrations/V006__store_state.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | DB | — |
| store_id | UUID FK(stores) | 所属门店 | `scene.upsertSceneRuntime` 首进时隐式建 | `scenes.routes` |
| scene | SMALLINT FK(hq_categories(scene)) | 场景编号 | 同上 | 同上 |
| **status** | scene_state_status NOT NULL | **状态机** empty → photo_uploaded → detected → reviewing → confirmed | 上传 → photo_uploaded；检测 → detected；apply 后 **RESET → empty**（RC-B, 2026-06-14） | scenes.routes |
| **photos** | JSONB DEFAULT '[]' | 照片数组 `[{ url: '/api/v1/storage/oss-image?key=...' }]`；**apply 后清空** | POST `/scenes/:scene/photos` 调 oss.upload wrap 成 `{url}` 后 PATCH；apply 后 RESET 为 `[]` | 前端恢复草稿；AI 工作流 |
| detection_data | JSONB DEFAULT '{}' | **AI 识别真值**；apply 后 RESET 为 `{}` | 前端检测后 PATCH | 选品方案 / 虚拟陈列工作流；逐条确认 |
| virtual_status | scene_virtual_status NOT NULL, DEFAULT 'idle' | 虚拟陈列子状态；apply 后 RESET 为 'idle' | 虚拟陈列 SSE 期间更新 | 前端轮询 |
| virtual_raw_outputs / virtual_context / last_snapshot | JSONB | Dify 原始返回 / 上下文 / 本期方案快照；apply 后 RESET 为 NULL | 虚拟陈列完成时 PATCH | 审计 / 前端展示 |
| **diagnose_status** | scene_virtual_status NOT NULL, DEFAULT 'idle' | **V028 新增** · "三段诊断"工作流跑到哪了：空闲 / 正在跑 / 已完成 / 失败；apply 后 RESET 为 'idle' | 上传照片触发后端 `ensureDiagnose()` fire-and-forget；工作流回写 | 前端轮询代替 SSE：店长关 tab / 刷新页面后再回来仍能读到结果 |
| **diagnose_raw_outputs** | JSONB | **V028 新增** · 诊断工作流的完整输出（失败时存 `{ error, ... }`）；apply 后 RESET 为 NULL | 同上 | 前端展示诊断结论；失败时把原因展给用户 |
| **strategy_status** | scene_virtual_status NOT NULL, DEFAULT 'idle' | **V028 新增** · "选品策略"工作流的状态机；含义同 diagnose_status | 进入调改流程时 `ensureStrategy()` 拉起；工作流回写 | 同上 |
| **strategy_raw_outputs** | JSONB | **V028 新增** · 选品策略工作流的完整输出 | 同上 | 前端展示推荐的上 / 下架商品清单 |
| env_crowd / env_competitor | TEXT | 周边人群 / 竞对摘要；**apply 后保留**（不清） | 用户编辑 / AI 补充 | AI 工作流上下文（兜底从 store_insights 取） |
| draft | JSONB | 调改草稿（phase / items 确认进度）；**apply 后 RESET 为 NULL** | 上传 / 检测 / 逐条确认时 PATCH | 跨设备续作恢复 |
| updated_by | UUID FK(users) | 最后更新者 | upsertSceneRuntime | 审计 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

**关键约束**：`UNIQUE (store_id, scene)` 保证每店每场景仅一行。

**触发动作**：
- POST `/scenes/:scene/photos` → photos 追加 + status='photo_uploaded'；同时后台 fire-and-forget 拉起 `ensureDiagnose()`（写 diagnose_status='processing'）
- 前端 detect 后 PATCH → detectionData + status='detected'
- 进入"开始调改" → 后台 fire-and-forget 拉起 `ensureStrategy()`（写 strategy_status='processing'）
- 逐条确认 → draft 更新
- POST `/scenes/:scene/adjustments` → **applyAdjustment 事务内** RESET photos=[] / detectionData={} / draft=NULL / status='empty' / virtual_*=NULL / diagnose_*=NULL+idle / strategy_*=NULL+idle（RC-B 修复 + V028 扩展）

---

### `store_scene_shelves`

> 场景货架组。每个场景的物理货架属性（类型 / 尺寸 / 层数 / 承载品类）。[V006.sql](../apps/api/src/db/migrations/V006__store_state.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | DB | — |
| store_id | UUID FK(stores) | 所属门店 | `store-skus.replaceSceneShelfGroups()` 全量覆盖 | `store.routes GET /store/shelves` |
| scene | SMALLINT FK | 场景 | 同上 | 同上 |
| group_index | SMALLINT | 货架组序号（0 起） | 同上 | 同上 |
| shelf_type | TEXT | 货架类型（"标准货架" / "冷柜"） | 同上 | 前端 |
| width_cm / layer_count | NUMERIC(8,2) / SMALLINT | 宽度（厘米） / 层数 | 同上 | 前端 |
| categories | TEXT[] | 承载品类名数组；不传时自动填该场景 level=1 品类 | 同上 | AI 布局参考 |
| notes | TEXT | 备注 | 同上 | 前端 / 审计 |
| attributes | JSONB | 扩展 | 同上 | — |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

**约束**：`UNIQUE (store_id, scene, group_index)`。

**触发动作**：PUT `/scenes/:scene/shelves` → **事务内** DELETE 旧 + INSERT 新（全量覆盖语义）。

---

### `store_sku_snapshots`

> 门店周级销售快照。**外部导入的唯一来源**（ERP 或超管手工）。**调价不写此表**；价盘的"价格曲线"由 snapshots + price_changes 合并而来。[V006.sql](../apps/api/src/db/migrations/V006__store_state.sql)
>
> **V027 起价格列瘦身**：本表只保留 `retail_price` —— "本期销售数据产生时门店的实际售价"。**批发价**走 `hq_products.wholesale_price`，**总部建议零售价**走 `hq_products.suggested_retail_price`（仅在选品/产品库使用，不进价盘曲线）。snapshot 时间序列同时承担"价格曲线"和"调价历史"两个角色 —— 没有独立的"调价事实"概念。

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | DB | — |
| store_id | UUID FK(stores) | 所属门店 | `store-skus.importStoreSnapshots()` | 价盘 / 选品 / 海报销量追踪 |
| product_id | UUID FK(hq_products) | 商品 | 导入时按 sku_code 反查 | 销量追踪 |
| sku_code | VARCHAR(64) | SKU 码 | INSERT | UNIQUE 约束的一部分 |
| snapshot_date | DATE | 快照日期 | INSERT | 时序排序；最新一期取 |
| **retail_price** | NUMERIC(12,2) | **实际售价**（本期销售数据对应的成交价；调价后下一期才会变） | INSERT | 价盘曲线 · 销售额校验 |
| ~~original_price~~ | ~~NUMERIC(12,2)~~ | ~~划线原价~~ **V027 删除** —— 业务上等同 `hq_products.suggested_retail_price`，回主数据读 | — | — |
| ~~wholesale_price~~ | ~~NUMERIC(12,2)~~ | ~~批发价~~ **V027 删除** —— 回 `hq_products.wholesale_price` 读 | — | — |
| sales_qty_30d / sales_amount_30d | INT / NUMERIC(14,2) | 30 日销量 / 销售额 | INSERT | **核心指标**：环比 / 排序 / 效果评估 |
| sales_qty_90d / sales_amount_90d | INT / NUMERIC(14,2) | 90 日 | INSERT | 趋势分析 |
| gross_margin_30d | NUMERIC(8,4) | 30 日毛利率 | INSERT | 选品决策 |
| stock_qty | INT | 库存 | INSERT | 补货 |
| last_delivery_at | DATE | 最后到货 | INSERT | 断货预判 |
| source | TEXT, DEFAULT 'manual' | 'erp_sync' / 'manual' | INSERT | 数据质量 |
| imported_by | UUID FK(users) | 导入者 | INSERT | 审计 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

**口径变更后的读取规则**（V027 起）：
- "本店本期实际售价" → snapshot.retail_price（**所有展示路径的唯一源**）
- "批发价 / 进价" → `hq_products.wholesale_price`（主数据 JOIN，全期同值；用于成本线/利润计算）
- "总部建议零售价" → `hq_products.suggested_retail_price`（**与价盘曲线无关**，只在选品 inputs.sku_attributes 和产品库展示）
- "上次价 / 涨跌"对比 → snapshot 时间序列的**相邻两点 retail_price 之差**推导，不来自任何独立字段或 `store_price_changes`
- `store_price_changes` 表：参见下方 § store_price_changes —— **该表在 V027 起读路径和写路径都被废弃**，价盘视角下不存在

**约束 #2**：唯一允许的写入是 `store.routes POST /store/skus:import`。系统**绝不**因调价、apply 等动作往本表写。

**约束**：`UNIQUE (store_id, product_id, snapshot_date, source)` — 同日同源覆盖；`CHECK source IN ('erp_sync', 'manual')`。

**索引**：
- `(store_id, product_id, snapshot_date DESC)` — 价格曲线频用
- `(store_id, snapshot_date DESC)` — 整店最新一期

---

## 6 · 门店洞察 / 竞品 / 问卷 (V007)

### `store_insights`

> 门店周边商圈报告（AI 生成 + POI 缓存）。每店一行。[V007.sql](../apps/api/src/db/migrations/V007__store_insight.sql) · **V015 起精简至 4 字段 + poi_data**

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| store_id | UUID UNIQUE FK(stores) | 所属门店（每店至多一份） | `surveys.upsertStoreInsight()`（Dify 回调）| `insights.routes` / `ai-shelves.loadEnvSummary` 兜底 |
| category | TEXT | 商圈业态（如「住宅区·文教区」） | Dify 工作流回调 | 报告展示 |
| **crowd_source_analysis** | TEXT | 人群分析（自然文本） | 同上 | `ai-shelves.loadEnvSummary`：`scene_state.env_crowd` 为空时**兜底** / 报告展示 |
| **competitor_analysis** | TEXT | 竞对分析（自然文本） | 同上 | `ai-shelves.loadEnvSummary`：`scene_state.env_competitor` 为空时**兜底** / 报告展示 |
| top_competitors | JSONB DEFAULT '[]' | 前 N 个竞对名称数组（如 `["上好便利店","京东便利店"]`） | 同上 | 报告展示 |
| **poi_data** | JSONB DEFAULT '{}' | **V015 新增** · 高德 POI 检索原始结果缓存；店级一次性获取，问卷/洞察生成都复用，不再每次调高德 | `insights.refreshPoi()` / `surveys.upsertStoreInsight()` 触发时 | Dify 工作流 inputs / 报告侧栏 |
| created_at / updated_at | TIMESTAMPTZ | 系统列 | DB | — |

**触发动作**：
1. 首次进入门店洞察 → 后端调高德 POI（searchAround）→ 写 `poi_data`（独立 UPSERT，不带 AI 字段）。
2. 用户点「生成报告」→ 取 `poi_data` 作为 Dify 工作流 inputs → 工作流完成 webhook → upsertStoreInsight 写入 4 个 AI 字段（同店覆盖）。

**V015 删除字段**（迁移会 DROP COLUMN）：~~city~~ · ~~main_demographic~~ · ~~consumption_level~~ · ~~population_density~~ · ~~report_markdown~~ · ~~insight_data~~ · ~~generated_at~~ · ~~generated_by~~ · ~~source~~ —— 当前 Dify 工作流输出已不含这些字段，前端详情页也不再渲染（连带改 `surveys.service.ts` 的 INSERT/UPDATE/SELECT 与共享类型）。

---

### `store_competitors`

> 门店自己维护的竞对店列表。无全局去重，每店各登记自己的。[V007.sql](../apps/api/src/db/migrations/V007__store_insight.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | store_competitor_products FK |
| store_id | UUID FK(stores) | 所属门店 | `competitors.createCompetitor / updateCompetitor` | 列表 / 价格对比视图 |
| competitor_name | TEXT NOT NULL | 竞对店名 | 同上 | 前端 |
| kind | competitor_kind NOT NULL, DEFAULT 'offline' | online / offline | 同上 | 前端分类 |
| province / city / address / distance_m | TEXT / INT | 地理信息 | 同上 | 距离排序 |
| is_active | BOOLEAN NOT NULL, DEFAULT true | 是否在监控（false = 软删） | 同上 | **关键过滤** |
| attributes | JSONB | 扩展 | 同上 | — |

**索引**：`(store_id) WHERE is_active`。

---

### `store_competitor_products`

> 竞对店的商品清单。可映射到自家 product_id 做比价。[V007.sql](../apps/api/src/db/migrations/V007__store_insight.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | snapshots FK |
| competitor_id | UUID FK(store_competitors) ON DELETE CASCADE | 所属竞对 | `competitors.createCompetitorProduct` | 列表 / v_active_competitor_price |
| external_sku | VARCHAR(64) | 竞对侧 SKU 码 | 同上 | 对账 |
| product_name | TEXT NOT NULL | 竞品名 | 同上 | 前端 |
| brand / spec | TEXT | 品牌 / 规格 | 同上 | 前端 |
| **mapped_product_id** | UUID FK(hq_products) | **映射到自家商品**（可空） | 同上 | 比价 JOIN store_sku_snapshots |
| product_url / image_url | TEXT | 链接 / 图 | 同上 | 前端 |
| is_active | BOOLEAN NOT NULL, DEFAULT true | 是否监控 | 同上 | 关键过滤 |

---

### `store_competitor_price_snapshots`

> 竞品价格快照。每次采集一条，同日重复覆盖。[V007.sql](../apps/api/src/db/migrations/V007__store_insight.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| competitor_product_id | UUID FK ON DELETE CASCADE | 所属竞品 | `competitors.createCompetitorPrice` | v_active_competitor_price |
| snapshot_date | DATE NOT NULL, DEFAULT CURRENT_DATE | 采集日（与 competitor_product_id UNIQUE，同日覆盖） | 同上 | 趋势 |
| retail_price | NUMERIC(12,2) NOT NULL | 零售价 | 同上 | 比价 |
| promo_price | NUMERIC(12,2) | 促销价 | 同上 | 比价 |
| promo_text | TEXT | 促销描述 | 同上 | 前端 |
| source | TEXT, DEFAULT 'photo' | 'photo' / 'ocr' / 'manual' | 同上 | 数据质量 |
| photo_url | TEXT | 拍照证据 | 同上 | 前端"查看凭证" |
| collected_at | TIMESTAMPTZ NOT NULL | 采集时刻 | 同上 | 最新一期排序 |
| collected_by | UUID FK(users) | 采集者 | 同上 | 审计 |

---

### `store_survey_questions`

> 调研问卷模板。可全店（scene=NULL）或场景专用。[V007.sql](../apps/api/src/db/migrations/V007__store_insight.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | answers FK |
| store_id | UUID FK(stores) | 所属门店 | `surveys.replaceSurveyQuestions` 整体替换 | `surveys.listSurveyQuestions` |
| scene | SMALLINT FK | 场景（NULL = 全店） | 同上 | 同上 |
| question_no | SMALLINT | 问题序号（与 store_id, scene UNIQUE NULLS NOT DISTINCT） | 同上 | 前端排序 |
| question_text | TEXT NOT NULL | 问题文本 | 同上 | 前端 |
| question_kind | TEXT, DEFAULT 'multi' | single / multi / text | 同上 | 前端控件 |
| options | JSONB DEFAULT '[]' | 选项数组 | 同上 | 前端 |
| source | TEXT, DEFAULT 'ai' | ai / manual | 同上 | 审计 |
| generated_at / created_by | TIMESTAMPTZ / UUID | 生成时刻 / 创建者 | 同上 | 审计 |

**触发动作**：AI"聊一聊"完成 → webhook 调 `replaceSurveyQuestions` → 事务内 DELETE 旧 + INSERT 新。

---

### `store_survey_answers`

> 店长对问卷的回答。同一问题允许多次回答，取最新。[V007.sql](../apps/api/src/db/migrations/V007__store_insight.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| question_id | UUID FK(store_survey_questions) ON DELETE CASCADE | 所属问题 | `surveys.submitSurveyAnswers` | listSurveyQuestions LEFT JOIN |
| answer_value | JSONB NOT NULL | 答案（`{options:[idx]}` / `{text:'...'}`） | 同上 | 前端 / 报告 |
| answered_by | UUID FK(users) | 回答者 | 同上 | 审计 |
| answered_at | TIMESTAMPTZ NOT NULL | 回答时刻 | 同上 | DESC LIMIT 1 取最新 |

**索引**：`(question_id, answered_at DESC)`。

---

## 7 · 门店动作 (V008)

### `store_scene_adjustments`

> 调改批次摘要。每次 apply 一条。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | store_assortment_changes.adjustment_id FK |
| store_id / scene | UUID FK / SMALLINT | 门店 / 场景 | `scene.applyAdjustment` 事务内 | 调改历史 |
| summary_text | TEXT | 摘要（"上架 3 个、停止进货 2 个"） | 同上 | 时间线 |
| added_count / removed_count | INT NOT NULL | 加 / 减数 | 同上 | 摘要统计 |
| items | JSONB | **冻结快照**：申请时的 items 数组 | 同上 | 前端回显（不用查 changes） |
| ai_session_id | TEXT | 关联的 AI session | 同上 | 追踪 AI 建议有效性 |
| triggered_by / triggered_by_display | UUID FK(users) / TEXT | 触发者 / 显示名 | 同上 | 审计 / 前端 |
| triggered_at | TIMESTAMPTZ NOT NULL | 应用时刻 | 同上 | 销售额变化对比的分界点 |

**索引**：`(store_id, scene, triggered_at DESC)`。

---

### `store_assortment_changes`

> 调改明细。每条加 / 减一行。批次删了明细仍保留（约束 #4）。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| store_id / product_id / sku_code | UUID FK / VARCHAR | 门店 / 商品 / SKU 码 | 同上 | 销量追踪 |
| action | assortment_action NOT NULL | add / remove | 同上 | 摘要 |
| reason_code | assortment_reason, DEFAULT 'other' | 推荐原因码 | 同上 | 推荐有效性分析 |
| reason_text | TEXT | 原因文本 | 同上 | 前端 |
| scene | SMALLINT FK | 场景 | 同上 | 场景维度分析 |
| adjustment_id | UUID FK(store_scene_adjustments) ON DELETE SET NULL | 所属批次（批次删则 SET NULL，明细保留） | 同上 | 回溯 |
| ai_diagnosis | JSONB DEFAULT '{}' | AI 诊断扩展 | 同上 | 深度分析 |
| effective_date | DATE NOT NULL, DEFAULT CURRENT_DATE | 生效日 | 同上 | 效果评估分界 |
| created_by / created_by_display | UUID FK / TEXT | 创建者 / 显示名 | 同上 | 审计 |

**索引**：`(store_id, scene, created_at DESC)` / `(adjustment_id)`。

---

### `store_scene_remakes`

> 每场景调改计数缓存。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| store_id / scene | 复合 PK | 门店 + 场景 | applyAdjustment UPSERT | `scene.getStoreSceneOverview` |
| remake_count | INT NOT NULL, DEFAULT 0 | 累计调改次数 | 每次 apply +1 | 前端"调改 X 次"徽章 |
| last_remake_at | TIMESTAMPTZ | 最后调改时刻 | 同上 | 时间线 |
| last_adjustment_id | UUID FK(store_scene_adjustments) ON DELETE SET NULL | 最后一次批次 ID | 同上 | 销售额变化对比 |

---

### `store_scene_virtual_history`

> 虚拟陈列生成记录。每次工作流完成落一条。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| store_id / scene | UUID FK / SMALLINT | 门店 / 场景 | `scene.recordVirtualHistory`（工作流完成时）| `scenes.routes GET /scenes/:scene/virtual-history` |
| image_url | TEXT NOT NULL | 生成的图 URL | 同上 | 前端"查看历史版本" |
| raw_output | JSONB | Dify 原始响应 | 同上 | 调试 |
| ai_model / ai_session_id | TEXT | 模型 / session | 同上 | 追踪 |
| generated_at / generated_by | TIMESTAMPTZ / UUID | 生成时刻 / 触发者 | 同上 | 时间线 / 审计 |

**索引**：`(store_id, scene, generated_at DESC)`。

---

### `store_sku_corrections`

> 店长对 AI 的纠错（逐条确认时点"跳过 + 原因"）。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| store_id / product_id / sku_code | UUID FK / VARCHAR | 门店 / 商品 | `scene.submitCorrection` | 模型反馈数据 |
| scene | SMALLINT FK | 场景 | 同上 | 场景分析 |
| correction_kind | sku_correction_kind NOT NULL | missed / false_positive（detection） / remove / add / observe（decision） | 同上 | 类别统计 |
| correction_scope | sku_correction_scope NOT NULL | detection / decision | 同上 | 范围分组 |
| reason_code | TEXT NOT NULL | 原因码（应用层维护） | 同上 | 原因聚类 |
| reason_text | TEXT | 原因文本 | 同上 | 前端 |
| evidence_image_url | TEXT | 证据照 URL | 同上 | 前端"查看凭证" |
| submitted_by / submitted_at | UUID FK(users) / TIMESTAMPTZ NOT NULL | 提交者 / 时刻 | 同上 | 审计 |
| resolved_by / resolved_at / resolution_note | UUID / TIMESTAMPTZ / TEXT | 处理者 / 时刻 / 备注 | 后台处理 | 处理状态 |

**约束 #5**：`CHECK ((scope='detection' AND kind IN ('missed','false_positive')) OR (scope='decision' AND kind IN ('remove','add','observe')))`。

---

### `store_price_changes`

> 历史调价流水表。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)
>
> **V027 起：表保留 / 读路径全部废弃 / 写路径全部废弃**。本 app 是"模拟器 + 销售分析"工具,不接入门店 POS,无法真改门店价格 —— 用户在模拟器算完后须手动去经营系统调价,下一周 snapshot 导入自然反映出新价。**所有调价历史、涨跌对比、价盘曲线，都从 `store_sku_snapshots` 时间序列推导**，不消费本表。表保留不删,留作未来真接 POS 时再启用。
>
> 现存的 `POST /prices/changes` 端点 V027 起前端不再调用,变成孤儿。

| 字段 | 类型 | 业务含义 |
|---|---|---|
| id | UUID PK | 唯一 |
| store_id / product_id / sku_code | UUID FK / VARCHAR | 门店 / 商品 |
| old_price | NUMERIC(12,2) | 调前价 |
| new_price | NUMERIC(12,2) NOT NULL | 调后价 |
| source | price_change_source NOT NULL, DEFAULT 'manual' | manual / rule_engine |
| ai_advice / ai_model | JSONB DEFAULT '{}' / TEXT | AI 建议扩展 / 模型 |
| note | TEXT | 备注 |
| effective_date | DATE NOT NULL, DEFAULT CURRENT_DATE | 生效日 |
| changed_by / changed_by_display | UUID FK(users) / TEXT | 操作者 / 显示名 |
| created_at | TIMESTAMPTZ | 写入时刻 |

**关键约束**：**不写** `store_sku_snapshots`（约束 #2 反向）。

**索引**：`(store_id, product_id, created_at DESC)`（保留，未启用时也不收成本）。

---

## 8 · 海报 (V009)

### `store_poster_tasks`

> 海报任务：用户提交的稳定业务意图（mode / template / copy / 底图 / 商品）。换商品换文案 = 新任务。[V009.sql](../apps/api/src/db/migrations/V009__store_posters.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | generations / task_products FK |
| batch_id | UUID NOT NULL | 同批提交分组号（无 FK） | `posters.createTasks` 时生成 | 批量取消 |
| user_id | UUID NOT NULL FK(users) | 提交者 | 同上 | adopt 时权限校验 |
| store_id | UUID NOT NULL FK(stores) | 所属门店；**强制 session.currentStoreId** | 同上 | 权限隔离 |
| mode | poster_mode NOT NULL | photo_compose / official_bg_only / multi_product | 同上 | worker 决定 prompt 模板 |
| template | poster_template | 模板风格 | 同上 | 同上 |
| custom_style_description | TEXT | 自定义风格（仅 mode='custom'） | 同上 | 同上 |
| copy_text | TEXT NOT NULL | 文案 | 同上 | worker 拼 prompt |
| source_photo_url | TEXT | 底图反代 URL（前端展示用） | 同上 | worker 调 AI 时 `toExternalUrl()` 转直链 |
| product_image_url | TEXT | 商品图反代 URL（单 SKU 模式） | 同上 | 同上 |
| inputs | JSONB DEFAULT '{}' | **完整 AI 入参快照**（重放生成用） | 同上 | `claimAndProcess` 重放 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | 排序 |

**索引**：`(store_id, created_at DESC)` / `(batch_id)`。

---

### `store_poster_task_products`

> 任务关联商品。销量追踪起点。[V009.sql](../apps/api/src/db/migrations/V009__store_posters.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| task_id, product_id | 复合 PK | 任务 + 商品 | `createTasks` 循环 INSERT（单 SKU 1 行，multi N 行） | v_poster_product_sales 视图关联快照 |
| sku_code | VARCHAR(64) NOT NULL | SKU 码（冗余） | 同上 | 前端显示 |
| display_order | SMALLINT NOT NULL | 排序（multi 模式用） | 同上 | 同上 |
| created_at | TIMESTAMPTZ | 时间戳 | DB | — |

**约束 #14**：`product_id` 是销量追踪的标识（关联 store_sku_snapshots 对比 adopted 前后销量）。

---

### `store_poster_generations`

> 海报生成记录。同任务可多次尝试（attempt_no 递增）。**采用 = 销量追踪起点**。[V009.sql](../apps/api/src/db/migrations/V009__store_posters.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 生成 ID（采用 / 下载主键） | DB | — |
| task_id | UUID NOT NULL FK ON DELETE CASCADE | 所属任务 | `posters.*` 各方法 | 任务详情 |
| attempt_no | SMALLINT NOT NULL | 尝试号（1 起；与 task_id UNIQUE） | 同上 | 前端显示"第 N 次" |
| **status** | poster_generation_status NOT NULL | **状态机** queued → claimed → processing → succeeded / failed / canceled | worker 流转 | 前端 poll |
| claim_token | TEXT | worker 认领令牌 | `claimAndProcess` | 防并发 |
| claim_expires_at | TIMESTAMPTZ | 认领过期时刻（10 分钟） | 同上 | 过期回收 queued |
| claimed_at / started_at / finished_at | TIMESTAMPTZ | 各阶段时刻 | 同上 | 耗时 / 排序 |
| poster_image_url | TEXT | 海报图 URL（反代或 OSS 直链） | 同上 | 前端 / 下载 |
| thumbnail_url | TEXT | 缩略图 URL | 同上 | 列表 |
| ai_model / ai_prompt / ai_response | TEXT / TEXT / JSONB | 模型名 / prompt / 原始响应 | 同上 | 审计 / 调试 |
| generation_ms | INT | 耗时（ms） | 同上 | 性能分析 |
| error_code / error_message | TEXT | 失败错误 | 同上 | 前端错误展示（RC-D 后会带 OpenRouter 原始 error.message） |
| **is_adopted** | BOOLEAN NOT NULL | 是否已采用 | `adoptGeneration` | v_poster_product_sales 销量起点 |
| adopted_at | TIMESTAMPTZ | 采用时刻 | 同上 | 同上 |
| download_count | INT NOT NULL, DEFAULT 0 | 下载次数 | `recordDownload` | 使用频率 |

**关键约束**：
- `UNIQUE (task_id, attempt_no)` — 每 task 每 attempt 唯一
- **约束 #13**：`UNIQUE INDEX ... ON (task_id) WHERE is_adopted` — 每任务至多一条已采用
- `INDEX (status, created_at) WHERE status IN ('queued','claimed')` — worker 队列扫描

---

### `store_poster_assets`

> 海报素材库（背景 / 商品图）。按店隔离，软删。[V009.sql](../apps/api/src/db/migrations/V009__store_posters.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| store_id | UUID NOT NULL FK(stores) | 所属门店 | `posters.createAsset` | `listAssets` 严格按 store_id 过滤 |
| kind | TEXT NOT NULL | 'background' / 'product_photo' | 同上 | 列表过滤 |
| image_url | TEXT NOT NULL | URL（反代） | 同上 | 前端 / 任务引用 |
| uploaded_by | UUID FK(users) | 上传者 | 同上 | 审计 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | 排序 |
| deleted_at | TIMESTAMPTZ | 软删 | `deleteAsset` | 过滤 `WHERE deleted_at IS NULL` |

**索引**：`(store_id, kind) WHERE deleted_at IS NULL`。

---

## 9 · 视图 (V010)

### `v_login_events`

> 登录事件单源投影。从 sys_audit_events 筛 `event_kind='user_login'`。

**聚合自**：sys_audit_events
**字段**：id, created_at, actor_user_id, actor_display_name, target_store_id, client_type, ip, user_agent, payload
**谁查**：`admin-stats.listLoginEvents()` / 后台登录历史
**刷新**：普通 VIEW，实时算

---

### `v_store_product_curve`

> 门店 × SKU 历史曲线，**同日多源去重**：manual 优先 erp_sync。

**聚合自**：store_sku_snapshots（按 store_id/product_id/snapshot_date 分组，ROW_NUMBER 取首条）
**业务上为什么要**：去重规则（manual 优先）多处消费时需要统一，集中在视图里。
**谁查**：`store-skus.listStoreSkus` / `benchmark.computeBenchmarkForScene` / 价盘曲线
**刷新**：普通 VIEW
**V027 列变更**：投影列与 snapshots 同步删 `original_price` / `wholesale_price`，只剩 `retail_price` + 销量/库存指标。

---

### `v_active_competitor_price`

> 每个竞品的最新一期价格。三层 JOIN（competitors → products → 最新 price snapshot）通过 LATERAL 子查询完成。

**聚合自**：store_competitors + store_competitor_products + store_competitor_price_snapshots
**业务上为什么要**：避免对标查询时重复写三层 JOIN。
**谁查**：`competitors.getCompetitorPrices` / 价格对标
**刷新**：普通 VIEW

---

### `v_active_offers`（V029 新增 · V030 简化）

> "今天哪些优惠在跑" —— 店长 /posters 首页所有定价都从这层取数。**已自动剔除**作废批次和不在日期窗口内的 offer；星期掩码（周二会员日 / 周末啤酒日）V030 起**不再在 SQL 层卡**，原样透传给前端按"今明" toggle 决定显不显示（否则非生效那天前端拿不到任何数据，"今明"开关就没东西可过滤）。

**聚合自**：hq_promo_offers JOIN hq_promo_batches
**过滤条件**：`batches.is_voided = false AND current_date BETWEEN offers.valid_from AND offers.valid_to`
**字段**：offer 的全部列原样透传（含 `valid_weekday_mask`）
**谁查**：`promotions.service.ts → fetchPromoDataset`（既给"叠券模式"也给"只用会员价"两条算价路径）/ 海报店长侧首页
**刷新**：普通 VIEW，实时算

> 旧视图 `v_promotion_active`（按 `hq_promo_batches.is_active=true` 关联老 `hq_promo_batch_items`）在 V029 整体 DROP，不再存在。

---

### `v_super_admins`

> 当前活跃的超管用户列表。

**聚合自**：users + user_roles (system_role='super_admin')
**字段**：id, display_name, email, legacy_account
**谁查**：后台 / 权限校验 / 告警
**刷新**：普通 VIEW

---

### `v_store_competitor_counts`

> 每店活跃竞对数（替代 store_insights 冗余 competitor_count 列）。

**聚合自**：store_competitors（COUNT WHERE is_active）
**谁查**：admin-stats / 洞察卡片
**刷新**：普通 VIEW

---

### `v_poster_product_sales`

> 海报采用前后销量对比。**关键视图**：用 LATERAL 子查询找"adopted_at 之前最近一期"和"之后最新一期"。

**聚合自**：store_poster_generations(is_adopted=true) + tasks + task_products + store_sku_snapshots（两次 LATERAL）
**业务规则**：
- before：`WHERE snapshot_date <= adopted_at::date ORDER BY DESC LIMIT 1`
- after：`WHERE snapshot_date > adopted_at::date ORDER BY DESC LIMIT 1`
- `qty_delta_percent` = `(after - before) / before * 100`（前后任一 NULL 或 before=0 时 NULL）

**为什么用销量而非销售额**：销售额受调价干扰；销量更准确反映海报投放效果。
**谁查**：`posters.getPosterSalesImpact` / 海报 ROI 分析
**刷新**：普通 VIEW

---

## 10 · SQL 函数 (V012 / V019 / V023)

### `fn_category_path(p_category_id UUID) → TEXT`

> 递归向上拼接品类树路径，输出"大类/中类/小类"（不含场景层）。

**用法**：`SELECT fn_category_path(p.category_id) AS cat_path FROM hq_products p`
**业务用途**：商品 → 可读品类路径
**调用方**：`hq.listProducts` / `store-skus.listStoreSkus`（V023 后 benchmark 内部已转用 `fn_category_ancestor_name`；分场景/分类筛选请用 `fn_category_scene` 或 `fn_category_ancestor_name`，不要再字符串 split 这条路径）
**实现**：WITH RECURSIVE 走到根，过滤 level >= 1，string_agg 按 level 升序拼 `/`

---

### `fn_category_scene(p_category_id UUID) → SMALLINT`

> 递归向上找到所属场景，返回 scene 码。

**用法**：`WHERE fn_category_scene(p.category_id) = $scene`
**业务用途**：商品 → 场景 的唯一换算
**调用方**：`hq.listProducts(scene=)` / `scene.service` 场景校验 / `store-skus.listStoreSkus` / `ai-shelves.buildSkuAttributes` / `ai-shelves.loadStoreSkuMetrics`（V026 起新选品/诊断入参链路全部走它）
**实现**：WITH RECURSIVE 走到 level=0，SELECT scene LIMIT 1

---

### `fn_category_ancestor_name(p_category_id UUID, p_level SMALLINT) → TEXT`（V023）

> 从任意品类节点沿 `parent_id` 链向上找指定 level 的祖先名（0=场景 / 1=大类 / 2=中类 / 3=小类）。

**用法**：`SELECT fn_category_ancestor_name(p.category_id, 1::smallint) AS l1_name FROM hq_products p`
**业务用途**：替代 `split_part(fn_category_path(...), '/', N)` —— path 字符串分割在跨场景同名品类时会串。
**调用方**：`benchmark.computeBenchmarkForScene`（L1/L2/L3 三列）/ `store-skus.listStoreSkus`（categoryL1Name / L2Name / L3Name）/ `ai-shelves.buildSkuAttributes`（majorCategory/midCategory/subCategory）/ `ai-shelves.buildSkuJsonForVirtualShelf`（新品行 cat_l1/l2/l3）
**实现**：WITH RECURSIVE chain → 取 level = p_level 的节点 category_name

---

### `fn_assert_product_category_leaf()` TRIGGER FN（V019）

> hq_products 写入前钩子：强制 `category_id` 指向 `hq_categories.level = 3`（小类）。

**用法**：自动跑（`BEFORE INSERT OR UPDATE OF category_id ON hq_products`）。不在业务代码里手动调。
**业务用途**：根除"挂在 L1 冷藏品上"等旧脏数据复发；新插入/更新触发器即拦。
**违规处理**：异常 `hq_products.category_id 必须指向小类(level=3)，当前 level=X` → 事务回滚。

---

## 11 · 跨表才讲得清的业务规则

### 1. 当前选中门店 (currentStoreId)

**真理源**：`user_sessions.active_store_id`
**切换唯一入口**：`portal.switchActiveStore()`（设计决策 D11）
- 校验目标门店 `status='active'`
- 非超管校验 `user_stores` 有 (user_id, store_id)
- UPDATE active_store_id + last_seen_at

**未选店判定**：`middleware/require-store.ts` 检查 `req.user.currentStoreId IS NULL` → 返 `409 NO_STORE_SELECTED`

**初值规则**（登录时 `auth.pickCurrentStore`）：
- 单店用户：自动填该店
- 多店用户 / 飞书新用户 / 超管首登：NULL（前端 `/select-store` 引导）

---

### 2. 商品分类路径

**SQL 函数**：
- `fn_category_path()` —— WITH RECURSIVE 拼 "L1/L2/L3"，给前端展示用；V023 起业务代码不再 split 它
- `fn_category_ancestor_name(category_id, level)`（V023）—— 按 level 取祖先名，**业务代码统一用它**
- `fn_category_scene(category_id)` —— 商品 → 场景（scene 业务码 1-12）的唯一换算
- `fn_assert_product_category_leaf()`（V019 TRIGGER）—— 强制 `hq_products.category_id` 指向 L3

**不存路径**：分类编辑后路径自动更新；函数都是 STABLE，可被 planner 缓存。

---

### 3. 价盘曲线 = snapshot 单源（V027 重写）

**单源**：`store_sku_snapshots.retail_price` —— 周级实际售价（含 30/90 日销量）。

**实现**：`prices.getPriceCurve()` 只查 snapshots，按 `snapshot_date` 升序，每条点形如 `{ snapshotDate, retailPrice, salesQty30d?, salesAmount30d?, grossMargin30d? }`。

**批发价**：`hq_products.wholesale_price` JOIN 进 SKU 头部（一个 SKU 一个值，全期同值），用于成本线 / 利润计算。

**"上次价 / 涨跌"**：从 snapshot 时间序列相邻两点 retail_price 之差**前端推导**，不存数据库字段，不从 `store_price_changes` 读。

**为什么是单源**：本 app 是"模拟器 + 销售分析"工具 —— 不真改门店价。用户在工具里"模拟调价"算完目标价后，须去自己经营系统手动调，**下一周 snapshot 导入自然吃到新价** → 时间序列上 retail_price 跳变 = "事实上的调价"。`store_price_changes` 表只是模拟操作的预留日志位（V027 起也不再写），价盘视角下不存在。

---

### 4. 基准 SKU 按场景计算（**V023+ 全面重写：归一化平均代替朴素加权**）

**口径**（`benchmark.computeBenchmarkForScene`）：
- **排除当前店**（`WHERE store_id <> $1`）+ active 门店 + active 商品
- **场景筛选**：JOIN 时 `fn_category_scene(p.category_id) = $scene`（V023+ 走 category_id；不再字符串 split）
- **每店每 SKU 取最近两期**：`ROW_NUMBER() OVER (PARTITION BY store_id, product_id ORDER BY snapshot_date DESC, ...)`，rn=1 latest / rn=2 prev
- **门店本场景规模**：`store_scene_totals = SUM(latest_amt) BY store_id`（**只算本场景的 SKU**，避免烘焙 SKU 拿百货门店总额做分母）
- **归一化平均**（按用户口径，2026-06-15 起）：
  - `norm_avg_amt = AVG(item_amt / store_amt) × AVG(store_amt)` —— "SKU 在门店内占比的均值 × 门店在本场景规模的均值"
  - `norm_avg_qty = AVG(item_qty / NULLIF(store_qty,0)) × AVG(NULLIF(store_qty,0))`
  - **设计动机**：解耦"占比"与"门店规模"，避免"恰好在大店占比也高"导致的正相关偏估；两者独立时退化为朴素均值
- **psd_change**（环比 %）：`(Σ paired_latest_amt − Σ prev_amt) / Σ prev_amt × 100`，prev=0 → null
- **类目名**：`fn_category_ancestor_name(category_id, 1/2/3)` 三个函数调用（不再 split path）

详见 [benchmark.service.ts](../apps/api/src/services/benchmark.service.ts) 头部注释。

---

### 5. 海报销量对比

**视图 `v_poster_product_sales`**：
- before = `snapshot_date <= adopted_at::date` ORDER BY DESC LIMIT 1
- after = `snapshot_date > adopted_at::date` ORDER BY DESC LIMIT 1
- delta% = `(after - before) / before * 100`，前后任一 NULL 或 before=0 时 NULL

用销量（qty）而非销售额（amount），避免调价对销售额的干扰。

---

### 6. 促销「上传 = 全量替换」（V029 重写）

老语义（"批次 + 手动激活 + 唯一索引保 is_active"）V029 起整体废弃，换成：

**业务约束**：同一时刻全库只允许一份"未作废"的促销批次（`hq_promo_batches.is_voided = false`）—— 这就是店长当前看到的本期活动。

**上传事务**（`promotions.service.uploadPromotion`）：
1. `pg_advisory_xact_lock(hashtext('hq_promo_batches.upload'))` —— 同一时刻只允许一个上传事务进入（防两个并发上传都看到旧状态后各自留下"鬼批次"）
2. `UPDATE hq_promo_batches SET is_voided = true WHERE is_voided = false` —— 把所有旧批次一次性作废
3. INSERT 新批次 + 循环 INSERT raw_items + offers
4. 整事务提交

任一步失败 → 整事务回滚 → 旧批次依然有效，前端无感。

**为什么不再用唯一索引**：旧设计要求"新建时先腾出唯一索引"分两步，操作流程比业务复杂；新设计直接用 `is_voided` 翻转 + advisory lock，无需独立的"激活"动作。

### 7. 优惠机制与凑单池语义（V029 新增）

促销 Excel 的活动话术（"会员 9 折"、"满 88 减 10"、"买 5 瓶送 1 瓶"等 14 种实测话术）在 `hq_promo_offers` 里被规范成 4 类机制：

| 机制 | 业务含义 | 典型话术 | 是否默认可叠 |
|---|---|---|---|
| `flat_price` | 单件特价 | "特价 9.9 元" | 否 |
| `bundle_price` | 几件总价（子类 `fixed_total` / `nth_ratio` / `add_extra` / `buy_m_get_n`） | "2 件 9.9"、"第二件半价"、"加 1 元多 1 件"、"买 5 送 1" | 否 |
| `percent_discount` | 百分比折扣 | "会员 9 折" | 是 |
| `pool_threshold` | 整盘满减（需凑齐池里的 SKU 才生效） | "怡宝饮料品牌满 88 减 10" | 是 |

**凑单池**用 `pool_label` 串成虚拟组，无独立表：
- 会员价 sheet 的「促销组 N」→ `pool_label = member_price/促销组N`，店长前端聚成一张组卡，标题"会员价"
- 品牌满减 sheet 的「品牌段落名」→ `pool_label = brand_coupon/怡宝饮料品牌满减`，聚成"会员价 + 品牌满减券"组卡

**组卡 vs 单品卡的分配规则**（前端 shim，详 [promotions.functions.ts](../apps/web/src/lib/promotions.functions.ts)）：同一 SKU 同时落在会员价组和品牌满减组时，**会员价组优先**；SKU 只属于品牌满减组时按品牌满减聚组；SKU 没有任何 pool 时落单品卡。被聚进组的 SKU 不会再单独出现在单品卡里（防重复）。

---

### 8. "上次调价时间"（V027 重写：走 snapshot 序列）

**V027 起**：`store_price_changes` 不读不写，"上次调价时间"改成"**最后一次 retail_price 跳变所在的 snapshot_date**"，从 snapshot 时间序列推导。

`store-skus.listStoreSkus()` 用窗口函数 `LAG(retail_price) OVER (PARTITION BY store_id, product_id ORDER BY snapshot_date)` 找到最近一次 `retail_price != lag_retail_price` 的 snapshot_date,投影为 `lastPriceChangeAt: string | null`；前端价盘"最近调整"按它 DESC 排。

**历史**：RC-A（2026-06-14）一度是 LEFT JOIN `store_price_changes` 取 `MAX(created_at)`,V027 起改为 snapshot-derived。

---

## 12 · 业务动作 → 表写入路径速查表

### 身份 / 会话
- **登录（账密）**：`users.last_login_at` + INSERT `user_sessions` + INSERT `sys_audit_events('user_login')`
- **登录（飞书）**：可能 INSERT `users` + UPSERT `user_feishu_identities` + 追加 `user_roles` / `user_stores` + INSERT `user_sessions` + 审计
- **切店**：UPDATE `user_sessions.active_store_id` + last_seen_at
- **登出**：UPDATE `user_sessions.revoked_at` + 审计

### 后台账号
- **创建账号**：INSERT `users` + INSERT `user_roles` + INSERT `user_stores` + 审计 `user_create`
- **重置密码**：UPDATE `users.legacy_password_hash` + UPDATE `user_sessions.revoked_at`（强制下线）+ 审计
- **改门店绑定**：DELETE `user_stores` (user_id) + INSERT 新集合 + 审计
- **改角色**：DELETE `user_roles` (user_id) + INSERT 新集合 + 审计

### 后台系统设置
- **改 AI 模型**：UPSERT `sys_settings` (key='poster_image_model') + 审计 `app_setting_change`

### 使用会话
- **开 app**：INSERT `sys_usage_sessions` + UPDATE 旧会话（超时检测）
- **心跳**：UPDATE `sys_usage_sessions.last_heartbeat_at`
- **关 app**：UPDATE `sys_usage_sessions.status='ended'` + ended_at

### 总部数据
- **超管上传促销 Excel**（V029 起 = "上传即生效"，无独立激活动作）：
  1. `pg_advisory_xact_lock('hq_promo_batches.upload')` 串行化并发上传
  2. `UPDATE hq_promo_batches SET is_voided = true WHERE is_voided = false` 作废所有旧批次
  3. INSERT 新 `hq_promo_batches` + 批量 INSERT `hq_promo_raw_items` + 批量 INSERT `hq_promo_offers` + 回写 row_total / parsed_total
  4. 审计 `promotion_batch_upload`
- **手动作废一份批次**（总部回滚用）：UPDATE `hq_promo_batches.is_voided = true` + 审计 `promotion_batch_delete`
- **超管改门店档案**：UPSERT `stores` + 审计 `store_update`

### 货盘
- **上传场景照片**：UPSERT `store_scene_state` (photos 追加 + status='photo_uploaded')
- **AI 检测结果回写**：UPDATE `store_scene_state.detection_data` + status='detected'
- **逐条确认进度**：UPDATE `store_scene_state.draft`
- **点跳过纠错**：INSERT `store_sku_corrections`
- **apply 调改（核心）**：INSERT `store_scene_adjustments` + 循环 INSERT `store_assortment_changes` + UPSERT `store_scene_remakes` + **RESET** `store_scene_state` (photos=[]/detectionData={}/draft=NULL/status='empty'/virtual_*=NULL)
- **触发虚拟陈列**：（工作流完成后）UPDATE `store_scene_state.virtual_*` + INSERT `store_scene_virtual_history`
- **编辑周边摘要**：UPDATE `store_scene_state.env_crowd / env_competitor`

### 门店 SKU
- **超管导入快照**：UPSERT `store_sku_snapshots`（同日同源覆盖）+ 审计 `sku_import`
- ~~**调价**~~：V027 起前端"模拟调价"**不写后端**（纯本地算）；用户须去经营系统手动调价，下一周 snapshot 导入自然反映。`store_price_changes` 表保留不删但读写路径均废弃。

### 竞品 / 问卷
- **加竞对店**：INSERT `store_competitors`
- **加竞品**：INSERT `store_competitor_products`
- **采集价格（拍照）**：UPSERT `store_competitor_price_snapshots`（同日覆盖）
- **提交问卷答案**：INSERT `store_survey_answers`（同题多答累积）
- **AI 周边洞察完成**：UPSERT `store_insights` + DELETE/INSERT `store_survey_questions`

### 海报
- **提交任务**：INSERT `store_poster_tasks` + INSERT `store_poster_task_products` + INSERT `store_poster_generations(attempt_no=1, queued)`
- **worker 认领+生成**：UPDATE generation 进入 claimed → processing → succeeded（写 poster_image_url）/ failed（写 error_*）
- **重新生成**：取消旧 queued/claimed/processing 的 generation + INSERT 新 generation(attempt_no=max+1)
- **采用**：UPDATE generation.is_adopted=true / adopted_at
- **下载**：UPDATE generation.download_count++
- **上传素材**：INSERT `store_poster_assets`
- **删素材**：UPDATE `store_poster_assets.deleted_at`（软删）

---

## 13 · "我想知道 X 该查哪"速查表

| 业务问题 | 查这 | 备注 |
|---|---|---|
| 某店某 SKU 现在卖多少钱 | `v_store_product_curve.retail_price`（latest snapshot） | V027 起 snapshot 单源，`prices.getPriceCurve` 不再合并 changes |
| 某 SKU 调价历史 | snapshot 时间序列里 retail_price 跳变的 snapshot_date | V027 起从 snapshot 派生，不读 `store_price_changes` |
| 某 SKU 建议零售价 / 批发价 | `hq_products.suggested_retail_price` / `wholesale_price` | V027 起不再从 snapshot 读；全期同值；建议价不进价盘曲线 |
| ~~某 SKU 历史调价时间线~~ | ~~store_price_changes~~ → snapshot 序列的 retail_price 跳变 | V027 起读写都废弃 |
| 当前生效促销有哪些 | `v_active_offers`（V029 起；旧 `v_promotion_active` 已删） | 自动过滤未作废批次 + 在有效期内的 offer；星期掩码由前端处理 |
| 某 SKU 现在能享什么优惠 | `v_active_offers WHERE sku_code = ?` | 一行 = 一条标准化 offer；店长端按 `pool_label` 聚组卡 |
| 某次上传 Excel 当时写的什么 | `hq_promo_raw_items WHERE batch_id = ?` | 原 sheet 行原样存档；用于复盘脏话术 |
| 诊断 / 选品 AI 工作流跑到哪了 | `store_scene_state.diagnose_status / strategy_status` | V028 起后端常驻；前端关 tab 也不丢 |
| 某店调改了多少次 | store_scene_remakes（缓存）或 store_scene_adjustments（流水） | remakes 是计数；adjustments 是详情 |
| 某用户登录历史 | v_login_events | 从 sys_audit_events 筛 user_login |
| 某竞品最新价 | v_active_competitor_price | 自动取最新快照 |
| 海报采用后销量增长 | v_poster_product_sales | 前后两期快照对比 |
| 某店某商品基准 | `benchmark.computeBenchmarkForScene()`（跨店归一化平均，详 § 11.4） | 不是单张表 |
| 上架待选池白名单 | `hq_products WHERE is_whitelisted AND fn_category_scene(category_id)=?` | V025 起一个 boolean 列；V026 起以 sku_attributes 每 SKU 自带 is_whitelisted 标记传给 Dify |
| 商品标签 / 市场最低价 | `hq_products.tags TEXT[]` / `hq_products.market_min_price / market_min_price_source`（V026） | GIN 索引；Dify inputs.sku_attributes 直接读 |
| 某人管哪些店 | user_stores（WHERE user_id=?） | 一人多店 |
| 当前选中门店 | user_sessions.active_store_id | 每会话唯一 |
| 海报"被卡在哪儿"了 | store_poster_generations.status + error_code + error_message | RC-D 后含 OpenRouter 真错因 |
| 这场景上次调改清空了什么 | scene.service.applyAdjustment 事务（参 § 7） | RC-B 后清 photos / status / draft / detection / virtual_* |

---

**文档版本**：2026-06-18（对应 V001-V030 全部已应用）
**最近一次较大更新**：
- **V028 诊断 / 选品 AI 工作流改后端常驻**：`store_scene_state` 加 `diagnose_status / diagnose_raw_outputs / strategy_status / strategy_raw_outputs` 四字段，让"三段诊断 / 选品策略"两个 Dify 工作流不再 SSE 透传到浏览器 —— 关 tab / 刷新页面后仍能拿回结果。`virtual_status / virtual_raw_outputs`（虚拟陈列，V006 起）+ `store_insights`（周边洞察，PR #41）现在和这两个工作流走同一范式。
- **V029 促销数据整体重构**：老促销表 / 视图全删（`hq_promo_batch_items` / `hq_promo_mix_groups` / `v_promotion_active`），重建为「批次（`hq_promo_batches`）+ 档案行（`hq_promo_raw_items`）+ 标准化优惠（`hq_promo_offers`）」三层；新增 ENUM `promo_activity_type`（5 个 sheet 的活动类别）/ `promo_mechanic`（4 类优惠机制）；上传语义改为「新文件入库即把所有旧批次自动作废，同一时刻只有一份生效」；凑单组用 `pool_label` 串成虚拟组，无独立表。
- **V030 星期掩码下放前端**：`v_active_offers` 不再按"今天是否在 offer 生效星期内"卡掉数据，而是把 `valid_weekday_mask` 透传前端，由"今明" toggle 自己决定显示策略 —— 否则非生效那天前端连"今明"按钮都没东西可过滤。
- **V027 产品定位重塑**：本 app 是"模拟器 + 销售分析"工具，不写门店真实价。`store_sku_snapshots` 删 `original_price` / `wholesale_price` 只保留 `retail_price`；价盘曲线改 snapshot 单源；`store_price_changes` 读写路径全部废弃（表保留）；前端"应用调价"改"模拟调价"+ 被动提示。
- V023 加 `fn_category_ancestor_name`（避免跨场景同名品类被字符串 split 串）；V024 → V025 → V026 白名单三步演进（独立表 → boolean 列 → Dify inputs.sku_attributes 每 SKU 自带标记）；V026 加 `hq_products.tags` / `market_min_price` / `market_min_price_source`；`benchmark.computeBenchmarkForScene` 全面重写为归一化平均（§ 11.4）；ai-shelves inputs 重构：`sku_data / major_category / mid_category / whitelist / new_product_skus` 全删，换成 `sku_attributes / store_sku_data` + 结构化 `poi_data` + `current_date`。

**配套文档**：[api-contracts.md](./api-contracts.md) · [data-flow.md](./data-flow.md) · [state-management.md](./state-management.md)
