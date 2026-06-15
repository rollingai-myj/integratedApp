# 数据库结构文档

> 给新加入项目的开发：每张表 / 每个字段是什么、什么时候被读、什么时候被写。优先用业务语言（不照搬 SQL 注释）。
>
> 数据源：
> - 迁移文件：[apps/api/src/db/migrations/](../apps/api/src/db/migrations/) — V001 到 V013
> - 视图：[V010__views.sql](../apps/api/src/db/migrations/V010__views.sql)
> - SQL 函数：[V012__category_functions.sql](../apps/api/src/db/migrations/V012__category_functions.sql)
> - V013 后的 prune：[V013__prune_unused_columns.sql](../apps/api/src/db/migrations/V013__prune_unused_columns.sql)
> - 字段 → 接口形态：见 [data-flow.md](./data-flow.md)
> - 字段 → HTTP 契约：见 [api-contracts.md](./api-contracts.md)
> - 字段 → 前端状态：见 [state-management.md](./state-management.md)

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
| 总部主数据 | hq_categories, hq_products, hq_benchmark_skus | hq, benchmark |
| 促销 | hq_promo_batches, hq_promo_batch_items, hq_promo_mix_groups, hq_promo_sku_texts | promotions |
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
| `benchmark_segment` | `core` / `innovation` | 基准 SKU 类别（核心款 / 创新款） |
| ~~`store_ownership`~~ | ~~`direct` / `franchise`~~ | **已删除（V014 起）** |
| `promotion_scope` | `all_stores` / `city` / `store_list` | 选品文案的作用域 |

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

## 1 · 身份 / 会话 / 权限 (V002)*clear

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

## 2 · 系统横切 / 全局设置 (V003 / V011)*clear

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

## 3 · 总部主数据 (V004 / V012)*clear

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
| length_mm / width_mm / height_mm | NUMERIC(10,2) | 物理尺寸（毫米） | 初始化 | 货架规划 / 选品 |
| category_id | UUID FK(hq_categories) | 所属品类 | 初始化 | `fn_category_path` / `fn_category_scene` |
| is_new_product | BOOLEAN | 是否新品 | 初始化 / 后台改 | 选品优先级 |
| is_private_label | BOOLEAN | 是否自有品牌 | 初始化 | 采购 / 选品 |
| wholesale_price | NUMERIC(12,2) | 批发价（进价） | 初始化 / 后台改 | 成本计算 |
| suggested_retail_price | NUMERIC(12,2) | 总部建议零售价 | 初始化 / 后台改 | 促销基准；门店实价见 store_sku_snapshots |
| introduced_at | DATE | 上市日期 | 初始化 | 新品判定 |
| `official_image_url` | — | **已删除（V013 起）**；图片走 OSS 命名约定 | — | — |
| status | product_status NOT NULL, DEFAULT 'active' | active / delisted | 初始化 / 后台下架 | `WHERE status='active'` |
| attributes | JSONB | 扩展属性 | 初始化 | 特殊业务 |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | 时间戳 + 软删 | DB | 过滤 |

**图片处理**（V013 后）：商品图改为 `GET /hq/products/:skuCode/official-image` 302 重定向到 OSS（命名约定 `product_pic/{skuCode}.png`）；支持动态 `?w=` 缩放参数。

---

### `hq_benchmark_skus`

> 总部圈定的核心 / 创新商品名单。选品推荐的对标。[V004.sql](../apps/api/src/db/migrations/V004__hq_master_data.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | 初始化 / 后台 | — |
| product_id | UUID FK(hq_products) | 关联商品（可空，待解析） | 初始化 | JOIN 取商品属性 |
| sku_code | VARCHAR(64) | SKU 码（product_id 空时作待解析键） | 初始化 | 人工关联 |
| segment | benchmark_segment NOT NULL | core / innovation | 初始化 | `hq.listBenchmarkSkus` 按 segment 过滤 |
| reason | TEXT | 入选理由 | 初始化 | 报表 |
| effective_from / effective_to | DATE | 生效期间（NULL = 永久） | 初始化 | 时间过滤 |
| is_active | BOOLEAN | 逻辑删 | 初始化 / 软删 | `listBenchmarkSkus` 过滤 |
| created_by | UUID FK(users) | 创建者 | 初始化 | 审计 |

---

## 4 · 促销 (V005)

> **使用情况速查**：当前 4 张表里 `hq_promo_batches` / `hq_promo_batch_items` 是海报模块的核心数据源（店长 /posters 首页直接读这套）；`hq_promo_mix_groups` 服务端已写已查、但**前端未消费**；`hq_promo_sku_texts` 是早期为选品模块准备的"商品旁标语"体系，**端到端均未启用**（详见每节顶部提示）。

### `hq_promo_batches`

> 总部每次上传一份新的促销 Excel，就在这张表新增一行。**全库同一时刻仅一条 `is_active=true`**——这就是店长在 /posters 首页看到的"本期活动"。新版本激活时，旧版本会自动停用，门店端立刻切换。[V005.sql](../apps/api/src/db/migrations/V005__hq_promotions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 本批活动的稳定标识 | 总部上传促销 Excel 时新建一行 | 店长侧 API 透传给前端作为"促销版本号"；批次内商品 / 凑单组通过它关联 |
| file_name | TEXT | 原始 Excel 文件名（如 `promotions-2026-06.xlsx`） | 总部上传时存档 | 总部端"促销批次"历史列表显示 |
| source_file_url | TEXT | 原 Excel 在 OSS 的下载链接（可空） | 上传时存档 | 总部端"下载原文件"按钮 |
| uploaded_by | UUID FK(users) | 哪个总部账号上传的这一批 | 上传接口取当前登录用户 | 总部端列表"上传人"列；审计追溯 |
| row_total | INT | Excel 原始数据行总数（含解析失败的） | 上传解析时计算 | 总部端用于和 product_count 对比、判断丢了多少行 |
| product_count | INT | 本批最终入库的单品促销条数 | 写完 batch_items 后回写 | 总部端列表概览（"本批共 1083 个商品"） |
| group_count | INT | 本批最终入库的凑单组数 | 写完 mix_groups 后回写 | 总部端列表概览 |
| parse_warnings | JSONB | 解析期间的告警数组（如"第 12 行单价非数字 → 跳过"） | 上传解析时追加 | 总部端"查看告警"用于排查脏数据 |
| is_active | BOOLEAN | **是否就是店长当前看到的促销** | 上传时勾选"立即激活"；总部端在列表里切换 | 店长侧所有促销查询（/promotions/active、/promotions/recommend）都按此筛选 |
| activated_at | TIMESTAMPTZ | 本版上线时刻 | 切到 is_active=true 时刷新 | 总部端版本历史时间线 |
| deactivated_at | TIMESTAMPTZ | 本版下线时刻 | 被新版本顶替或手动停用时刷新 | 同上 |
| notes | TEXT | 上传时留的备注（如"618 前置版本"） | 上传时可选填 | 总部端列表显示 |
| attributes | JSONB | 扩展槽（尚未使用） | — | — |
| created_at / updated_at | TIMESTAMPTZ | DB 时间戳 | DB | — |

**关键约束**（**约束 #9**）：
```sql
CREATE UNIQUE INDEX hq_promo_batches_one_active_uq
  ON hq_promo_batches (is_active) WHERE is_active;
```
全库最多一条 `is_active=true`。所以切换"本期活动"必须分两步：先把旧的设 false、再把新的设 true（合并成一条 UPDATE 会因唯一索引冲突失败）。

---

### `hq_promo_batch_items`

> 一条 = 某批活动里的一个单品的全部档位规则。**上传时点冻结的快照**：商品名/单位/原价等都是上传当时拷下来的副本，事后改 hq_products 主数据不会影响本表——保证历史促销永远可复现。[V005.sql](../apps/api/src/db/migrations/V005__hq_promotions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 本行稳定标识 | 上传解析时生成 | API 透传 |
| batch_id | UUID FK(hq_promo_batches) ON DELETE CASCADE | 所属批次 → 跟随批次激活/停用 | 上传解析时写入 | 所有促销查询的过滤条件；批次删除时级联清空 |
| row_index | INT | 在原 Excel 里是第几行（与 batch_id 组合唯一） | 按 Excel 顺序写入 | 总部端排查时定位原 Excel；前端按此稳定排序 |
| sku_code | VARCHAR(64) | 商品 SKU 码 | 上传解析时拷贝 | 店长端 ProductCard 主键；和门店实际库存对账 |
| product_name | TEXT | 商品名（**快照**） | 上传时拷贝 | 店长端 ProductCard 标题 |
| unit | TEXT | 计量单位（如"瓶"、"袋"） | 上传时拷贝 | 店长端拼"X 元 / 单位"文案 |
| category_name | TEXT | 大类名（**快照**） | 上传时拷贝 | 店长端首页分类条按此聚合（再走 mapCategoryToGroup 映射成 13 类） |
| original_price | NUMERIC(12,2) | 原价（**快照**） | 上传时拷贝 | 店长端"省 X%"折扣率计算的基准 |
| product_id | UUID FK(hq_products) | 关联到主数据商品（仅当 sku_code 反查命中） | 上传时按 sku_code 查主数据 | 个性化推荐时反查商品 → 品类 → 用户偏好（不影响快照价格） |
| best_label | TEXT | 服务端预选的"最划算"档位标签（如"会员价 + 满减券"） | 上传解析时算出 | 店长端 ProductCard 主推这一档 |
| best_required_qty | INT | 最优档需要买几件 | 上传解析时算出 | 店长端价格说明 |
| best_total_price | NUMERIC(12,2) | 最优档买齐后的总价 | 上传解析时算出 | 店长端展示"X 件 X 元" |
| best_effective_unit_price | NUMERIC(12,2) | 最优档折算后的单价 | 上传解析时算出 | 店长端 ProductCard 大字价 + 排序锚 |
| best_saving_percent | NUMERIC(6,2) | 最优档相对原价的折扣率（%） | 上传解析时算出 | 店长端"省 X%"标签；首屏"超优惠"分类按 ≥60% 筛选；分类内排序 |
| all_options | JSONB | 所有档位明细数组（每个含 label/qty/totalPrice/effectiveUnitPrice/savingPercent/validFrom/validTo 等） | 上传解析时写入 | 店长端切换"会员价 / 叠加"模式时按此重新选最优；deriveBest 的"今/明有效"判定也走这里 |
| valid_from | DATE | 本商品促销开始日 | 上传解析时写入 | 店长端"今日有效"开关：仅当 valid_dates 为空时用 from/to 判断 |
| valid_to | DATE | 本商品促销结束日 | 上传解析时写入 | 同上 |
| valid_dates | DATE[] | 限定具体日期（如"仅周二会员日 06-02/06-09/…"），非空时**优先于** from/to | 上传解析时写入 | 店长端"今日有效"判定的最高优先 |
| mix_group_code | TEXT | 所属凑单组编码 → 串到 hq_promo_mix_groups | 上传解析时写入 | （前端尚未消费，见 mix_groups 提示）总部端凑单组视图聚合用 |
| display_text | TEXT | 总部手写的展示文案（如"清仓特价"） | 上传时可选填 | 店长端 ProductCard 兜底文案 |
| attributes | JSONB | 扩展槽（尚未使用） | — | — |
| created_at / updated_at | TIMESTAMPTZ | DB 时间戳 | DB | — |

**业务不变量（约束 #3）**：`product_name / unit / category_name / original_price` 等是 Excel 上传时点的冻结快照，永不跟随 hq_products 主数据更新；保证历史促销可复现。

---

### `hq_promo_mix_groups`

> 多个 SKU 共享同一 `mix_group_code` 时聚合成"凑单组"（如"任选 3 件 9.9 元"）。**总部上传促销 Excel 时由 batch_items 自动 GROUP BY 聚合写入**，不需要单独录入。[V005.sql](../apps/api/src/db/migrations/V005__hq_promotions.sql)
>
> ⚠️ **当前前端未消费**：服务端 `/promotions/active` 已返回 `groups[]`，但 [apps/web/src/lib/promotions.functions.ts](../apps/web/src/lib/promotions.functions.ts) 的店长侧 shim 只读 `products[]`，`groups` 被直接丢弃；店长 /posters 首页全是单品卡片，没有"组合凑单"入口。**结论**：数据写入和查询都通了，差最后一步前端接入。

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 组的稳定标识 | 上传解析时聚合生成 | API 透传 |
| batch_id | UUID FK(hq_promo_batches) ON DELETE CASCADE | 所属批次 | 上传解析时写入 | 过滤当前活动的凑单组；批次删除级联清空 |
| mix_group_code | TEXT | 组编码（如"COLD_DRINK_SUMMER"，与 batch_id 组合唯一） | 上传解析时从 batch_items 同字段聚合 | 反查组内 batch_items |
| display_name | TEXT | 组的对外名 | 上传解析时按 `"{category_name} 系列"` 自动生成（category 缺失则 NULL） | 店长端凑单组卡片标题（待接入） |
| category_name | TEXT | 组的主品类（取组内首个非空品类） | 上传解析时聚合 | 店长端按品类分桶（待接入） |
| sku_codes | TEXT[] | 组内 SKU 列表（按 row_index 顺序） | 上传解析时 `array_agg` 写入 | 店长端展开组成员（待接入） |
| product_count | INT | 组内有多少个 SKU | 上传解析时 COUNT | 总部端排序优先级（多 SKU 的组排前） |
| best_label | TEXT | 整组凑齐后的最优档标签 | 上传解析时聚合 | 店长端卡片主推文案（待接入） |
| best_total_price | NUMERIC(12,2) | 凑齐后整组总价 | 上传解析时聚合 | 店长端卡片大字价（待接入） |
| best_saving_percent | NUMERIC(6,2) | 凑齐后相对原总价的折扣率 | 上传解析时聚合 | 店长端"省 X%"标签（待接入） |
| representative_image_url | TEXT | 组代表图 | （当前上传流程未填）后续总部端可补 | 店长端组卡片缩略图（待接入） |
| attributes | JSONB | 扩展槽（尚未使用） | — | — |
| created_at / updated_at | TIMESTAMPTZ | DB 时间戳 | DB | — |

---

### `hq_promo_sku_texts`

> 选品（/shelves）页商品旁的促销小标语 —— 与海报模块的促销批次是**两套完全独立的体系**：海报促销是按月整批上传 Excel、固定 1 个生效版本；本表是按 SKU 维度长期挂的小标签（如"低糖 0 卡"、"新品热卖"），支持按城市 / 门店范围筛选。[V005.sql](../apps/api/src/db/migrations/V005__hq_promotions.sql)
>
> ⚠️ **当前端到端未启用**：
> - 后端服务 `listScenePromoTexts` + 路由 `GET /api/v1/scenes/:scene/promo-texts` 已实现，按场景读取本表；
> - **但 apps/web/src/features/shelves/ 没有任何调用方**，端点实际是死端点；
> - **也完全没有写接口**（INSERT/UPDATE/DELETE 在服务层、路由层均不存在），生产环境无法维护数据；
> - 唯一数据来源是 [dev-seed.sql](../apps/api/src/db/seeds/dev-seed.sql) 灌的种子。
>
> **结论**：等"商品旁标语"产品决策落地后再接入；现状清空本表不影响任何业务。

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | 仅 dev-seed | listScenePromoTexts 返回 |
| group_code | VARCHAR(64) | 标语组编码（与 `mix_group_code` 是完全不同的体系） | 仅 seed | 选品页按组聚合（待接入） |
| group_name | TEXT | 标语组的显示名 | 仅 seed | 同上 |
| product_id | UUID FK(hq_products) | 标语挂在哪个商品上（与 category_id 二选一） | 仅 seed | LEFT JOIN 兜底取 category_id |
| sku_code | VARCHAR(64) | SKU 码（product_id 缺失时直接用） | 仅 seed | 选品页按 SKU 匹配（待接入） |
| promo_text | TEXT | 标语文案（如"低糖 0 卡"、"新品热卖"） | 仅 seed | 选品页 SKU 旁标签（待接入） |
| category_id | UUID FK(hq_categories) | 标语挂哪个品类（与 product_id 二选一） | 仅 seed | 走 `fn_category_scene` 把品类映射到场景编号、按场景过滤 |
| scope | promotion_scope NOT NULL | 作用范围：`all_stores` / `city` / `store_list` | 仅 seed | 当前服务端过滤掉 `store_list`（避免按门店维度展开） |
| scope_cities | TEXT[] | scope=city 时的城市白名单 | 仅 seed | 选品页按门店所在城市过滤（待接入） |
| scope_store_ids | UUID[] | scope=store_list 时的门店白名单 | 仅 seed | 同上 |
| effective_from | DATE | 标语生效起始 | 仅 seed | 时间过滤（当前查询未启用此条件） |
| effective_to | DATE | 标语停用日期 | 仅 seed | 同上 |
| is_active | BOOLEAN | 是否启用 | 仅 seed | 查询条件 |
| display_order | INT | 同组内显示顺序 | 仅 seed | 排序（当前查询未启用） |
| created_by | UUID FK(users) | 创建者 | 仅 seed | 审计 |
| attributes | JSONB | 扩展槽（尚未使用） | — | — |
| created_at / updated_at | TIMESTAMPTZ | DB 时间戳 | DB | — |

**约束 #6**：scope 三选一必须与对应 scope_cities / scope_store_ids 配对（all_stores 时两者都 NULL；city 时 cities 非空、store_ids NULL；反之）。

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
| env_crowd / env_competitor | TEXT | 周边人群 / 竞对摘要；**apply 后保留**（不清） | 用户编辑 / AI 补充 | AI 工作流上下文（兜底从 store_insights 取） |
| draft | JSONB | 调改草稿（phase / items 确认进度）；**apply 后 RESET 为 NULL** | 上传 / 检测 / 逐条确认时 PATCH | 跨设备续作恢复 |
| updated_by | UUID FK(users) | 最后更新者 | upsertSceneRuntime | 审计 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

**关键约束**：`UNIQUE (store_id, scene)` 保证每店每场景仅一行。

**触发动作**：
- POST `/scenes/:scene/photos` → photos 追加 + status='photo_uploaded'
- 前端 detect 后 PATCH → detectionData + status='detected'
- 逐条确认 → draft 更新
- POST `/scenes/:scene/adjustments` → **applyAdjustment 事务内** RESET photos=[] / detectionData={} / draft=NULL / status='empty' / virtual_*=NULL（RC-B 修复）

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

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一标识 | DB | — |
| store_id | UUID FK(stores) | 所属门店 | `store-skus.importStoreSnapshots()` | 价盘 / 选品 / 海报销量追踪 |
| product_id | UUID FK(hq_products) | 商品 | 导入时按 sku_code 反查 | 销量追踪 |
| sku_code | VARCHAR(64) | SKU 码 | INSERT | UNIQUE 约束的一部分 |
| snapshot_date | DATE | 快照日期 | INSERT | 时序排序；最新一期取 |
| retail_price / original_price / wholesale_price | NUMERIC(12,2) | 零售价 / 原价 / 批发价 | INSERT | 价格曲线 |
| sales_qty_30d / sales_amount_30d | INT / NUMERIC(14,2) | 30 日销量 / 销售额 | INSERT | **核心指标**：环比 / 排序 / 效果评估 |
| sales_qty_90d / sales_amount_90d | INT / NUMERIC(14,2) | 90 日 | INSERT | 趋势分析 |
| gross_margin_30d | NUMERIC(8,4) | 30 日毛利率 | INSERT | 选品决策 |
| stock_qty | INT | 库存 | INSERT | 补货 |
| last_delivery_at | DATE | 最后到货 | INSERT | 断货预判 |
| source | TEXT, DEFAULT 'manual' | 'erp_sync' / 'manual' | INSERT | 数据质量 |
| imported_by | UUID FK(users) | 导入者 | INSERT | 审计 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 | DB | — |

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

> 调价流水。**唯一调价数据归属**。[V008.sql](../apps/api/src/db/migrations/V008__store_actions.sql)

| 字段 | 类型 | 业务含义 | 谁写 | 谁读 |
|---|---|---|---|---|
| id | UUID PK | 唯一 | DB | — |
| store_id / product_id / sku_code | UUID FK / VARCHAR | 门店 / 商品 | `prices.submitPriceChange` | 价格曲线合并点 |
| old_price | NUMERIC(12,2) | 调前价（缺省时读最近快照 retail_price 回填） | 同上 | 前端变化方向 |
| new_price | NUMERIC(12,2) NOT NULL | 调后价 | 同上 | 价格曲线 |
| source | price_change_source NOT NULL, DEFAULT 'manual' | manual / rule_engine | 同上 | 审计 |
| ai_advice / ai_model | JSONB DEFAULT '{}' / TEXT | AI 建议扩展 / 模型 | 同上 | 追踪 |
| note | TEXT | 备注 | 同上 | 前端 |
| effective_date | DATE NOT NULL, DEFAULT CURRENT_DATE | 生效日 | 同上 | 时间线 |
| changed_by / changed_by_display | UUID FK(users) / TEXT | 操作者 / 显示名 | 同上 | 审计 |
| created_at | TIMESTAMPTZ | 调价时刻 | DB | **`store-skus.listStoreSkus()` 用 MAX(created_at) 作 `lastPriceChangeAt`** —— 价盘"最近调整"排序 |

**关键约束**：**不写** `store_sku_snapshots`（约束 #2 反向）。

**索引**：`(store_id, product_id, created_at DESC)`。

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

---

### `v_active_competitor_price`

> 每个竞品的最新一期价格。三层 JOIN（competitors → products → 最新 price snapshot）通过 LATERAL 子查询完成。

**聚合自**：store_competitors + store_competitor_products + store_competitor_price_snapshots
**业务上为什么要**：避免对标查询时重复写三层 JOIN。
**谁查**：`competitors.getCompetitorPrices` / 价格对标
**刷新**：普通 VIEW

---

### `v_promotion_active`

> 当前激活批次的全部促销商品（含商品官方图、建议价兜底）。

**聚合自**：hq_promo_batch_items + hq_promo_batches（is_active=true）+ hq_products（LEFT JOIN）
**业务上为什么要**：简化"取当前活跃促销 + 商品兜底属性"。
**谁查**：`promotions.listActivePromotions` / 海报选品
**刷新**：普通 VIEW

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

## 10 · SQL 函数 (V012)

### `fn_category_path(p_category_id UUID) → TEXT`

> 递归向上拼接品类树路径，输出"大类/中类/小类"（不含场景层）。

**用法**：`SELECT fn_category_path(p.category_id) AS cat_path FROM hq_products p`
**业务用途**：商品 → 可读品类路径
**调用方**：`hq.listProducts` / `hq.listBenchmarkSkus` / `benchmark.computeBenchmarkForScene` / `store-skus.listStoreSkus`
**实现**：WITH RECURSIVE 走到根，过滤 level >= 1，string_agg 按 level 升序拼 `/`

---

### `fn_category_scene(p_category_id UUID) → SMALLINT`

> 递归向上找到所属场景，返回 scene 码。

**用法**：`WHERE fn_category_scene(p.category_id) = $scene`
**业务用途**：商品 → 场景 的唯一换算
**调用方**：`hq.listProducts(scene=)` / `scene.service` 场景校验 / `store-skus.listStoreSkus`
**实现**：WITH RECURSIVE 走到 level=0，SELECT scene LIMIT 1

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

**SQL 函数 `fn_category_path()`**：WITH RECURSIVE 走父链，过滤 level >= 1，拼 "L1/L2/L3"。**不直接存路径**，避免维护成本；分类编辑后路径自动更新。

---

### 3. 价格曲线的双源合并

**双源**：
1. `store_sku_snapshots` 周级导入快照（含销量）
2. `store_price_changes` 实时调价（不含销量）

**合并**：`prices.getPriceCurve()` 各查一遍，结果每条点带 `source: 'snapshot' | 'change'` 字段；前端按 source 决定显示样式。

**为什么这样**：调价**不写**快照（约束 #2），但价格曲线又要展示调价 → 必须合并。

---

### 4. 基准 SKU 按场景计算

**口径**（`benchmark.computeBenchmarkForScene`）：
- 排除当前店（`WHERE store_id <> $1`）
- 各店各商品最新一期快照（DISTINCT ON (store_id, product_id) ORDER BY snapshot_date DESC）
- 按场景 L1 品类筛（`split_part(fn_category_path, '/', 1) = ANY(...)`)
- 加权平均：销售额为权重，`SUM(qty * amt) / SUM(amt)`；amt=0 时退化为 AVG(qty)

---

### 5. 海报销量对比

**视图 `v_poster_product_sales`**：
- before = `snapshot_date <= adopted_at::date` ORDER BY DESC LIMIT 1
- after = `snapshot_date > adopted_at::date` ORDER BY DESC LIMIT 1
- delta% = `(after - before) / before * 100`，前后任一 NULL 或 before=0 时 NULL

用销量（qty）而非销售额（amount），避免调价对销售额的干扰。

---

### 6. 促销批次单 Active 约束

**UNIQUE INDEX WHERE is_active**（约束 #9）：全库最多一条 `is_active=true`。
**激活流程**（`promotions.activateBatch`）：
1. UPDATE 旧 active = false（先腾出唯一索引）
2. UPDATE 新批次 = true

合并成一条 UPDATE 会因约束冲突失败 —— 必须分两步。

---

### 7. "上次调价时间" (RC-A, 2026-06-14)

**之前**：shared 类型声明了 `hasPriceChange: boolean` 但后端没返 → 前端排序失效。
**修复**：`store-skus.listStoreSkus()` SELECT 加 LEFT JOIN `store_price_changes` 取 `MAX(created_at)`，投影为 `lastPriceChangeAt: string | null`；前端价盘"最近调整"按它 DESC 排。

```sql
WITH ranked AS (...),
     last_change AS (
       SELECT product_id, MAX(created_at) AS last_at
         FROM store_price_changes WHERE store_id = $1 GROUP BY product_id
     )
SELECT ..., lc.last_at AS last_price_change_at
  FROM ranked latest LEFT JOIN ranked prev ON ...
  LEFT JOIN last_change lc ON lc.product_id = latest.product_id ...
```

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
- **超管上传促销 Excel**：INSERT `hq_promo_batches` + 批量 INSERT `hq_promo_batch_items` + 聚合 INSERT `hq_promo_mix_groups` + 回写 batches.product_count / group_count + 审计
- **激活新批次**：UPDATE 旧 is_active=false + UPDATE 新 is_active=true + 审计
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
- **调价**：INSERT `store_price_changes`（**绝不**写 snapshots）+ 审计 `price_change`

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
| 某店某 SKU 现在卖多少钱 | v_store_product_curve (latest) **或** store_price_changes (最新调价) | 两者合并看曲线：`prices.getPriceCurve` |
| 某 SKU 历史调价时间线 | store_price_changes（按 created_at DESC） | 调价唯一归属 |
| 当前活跃促销有哪些 | v_promotion_active | 自动过滤 is_active=true |
| 某店调改了多少次 | store_scene_remakes（缓存）或 store_scene_adjustments（流水） | remakes 是计数；adjustments 是详情 |
| 某用户登录历史 | v_login_events | 从 sys_audit_events 筛 user_login |
| 某竞品最新价 | v_active_competitor_price | 自动取最新快照 |
| 海报采用后销量增长 | v_poster_product_sales | 前后两期快照对比 |
| 某店某商品基准价 | `benchmark.computeBenchmarkForScene()`（跨店加权） | 不是单张表 |
| 某人管哪些店 | user_stores（WHERE user_id=?） | 一人多店 |
| 当前选中门店 | user_sessions.active_store_id | 每会话唯一 |
| 海报"被卡在哪儿"了 | store_poster_generations.status + error_code + error_message | RC-D 后含 OpenRouter 真错因 |
| 这场景上次调改清空了什么 | scene.service.applyAdjustment 事务（参 § 7） | RC-B 后清 photos / status / draft / detection / virtual_* |

---

**文档版本**：2026-06-14（对应 V001-V013，RC-A/B/C/D 修复后）  
**配套文档**：[api-contracts.md](./api-contracts.md) · [data-flow.md](./data-flow.md) · [state-management.md](./state-management.md)
