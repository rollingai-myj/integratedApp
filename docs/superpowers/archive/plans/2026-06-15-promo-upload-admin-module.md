# 促销批次上传入口模块（超管端）

**日期**：2026-06-15
**状态**：TODO，待启动
**优先级**：低于 [2026-06-15-dify-workflows-to-backend-background.md](2026-06-15-dify-workflows-to-backend-background.md)（先做 Dify 后端化再做这个）

## 背景

促销活动后端已就绪，前端**整块缺失**。当前 admin 页面是 "M5 即将开放" 占位卡，超管无法通过 UI 上传/管理促销批次。每次更新促销得手工拼 JSON 调后端，或者直接灌 SQL。

## 后端现状（已有，不动）

`apps/api/src/routes/promotions.routes.ts` 6 个端点齐全：

| 端点 | 权限 | 说明 |
|---|---|---|
| `POST /promotions/batches:upload` | super_admin | 接 `{fileName, sourceFileUrl?, notes?, activate?, rows: [...]}`，每 row 含 sku_code/product_name/价格/优惠/有效期/mix_group_code 等 17 字段；落 `hq_promo_batches` + `hq_promo_batch_items` |
| `GET /promotions/batches` | super_admin | 批次列表，可带 `limit` |
| `GET /promotions/active` | 登录用户 | 当前激活批次 + 商品 + groups（店长 /posters 已消费） |
| `GET /promotions/recommend` | 登录用户 | 按用户偏好排序 + groups（店长 /posters 已消费） |
| `DELETE /promotions/batches/:batchId` | super_admin | 删批次（级联 items / mix_groups VIEW 自动跟随） |
| `POST /promotions/batches/:batchId/activate` | super_admin | 切换激活批次（同时只有 1 个 active） |

`uploadPromotion` 服务（promotions.service.ts）已经做了 Excel 行 → DB 转换的全套逻辑，前端只需把 .xlsx 解析成那个 rows[] 结构就行。

## 前端要做的活

### 1. API 客户端补 4 个超管方法

`apps/web/src/lib/api-client.ts:353` 的 `promotionsApi`，目前只暴露：
```ts
active: () => request('/promotions/active'),
recommend: () => request('/promotions/recommend'),
```

补：
```ts
listBatches: (limit?: number) => request(`/promotions/batches?limit=${limit ?? ''}`),
uploadBatch: (body) => request('/promotions/batches:upload', { method: 'POST', body }),
deleteBatch: (batchId: string) => request(`/promotions/batches/${batchId}`, { method: 'DELETE' }),
activateBatch: (batchId: string) => request(`/promotions/batches/${batchId}/activate`, { method: 'POST' }),
```

### 2. 共享类型

`packages/shared/src/index.ts` 加：
- `UploadPromotionRequest`（对齐 `uploadSchema` 的 zod 定义）
- `UploadPromotionResponse`
- `ListBatchesResponse`
- `PromoBatchRow`（单行批次元数据）

后端 `uploadSchema` 字段清单见 `promotions.routes.ts:34-63`，照抄。

### 3. 新增前端 feature 目录

`apps/web/src/features/admin/promotions/`，至少 3 个文件：

- `UploadPage.tsx` —— 拖拽 / 选 `.xlsx` 文件 → SheetJS / `xlsx` 包解析 → 预览 N 行 → 显式填 `fileName / notes / activate` → 调 `uploadBatch`
- `BatchListPage.tsx` —— 表格展示批次（filename / activated / activated_at / row_total / product_count / group_count / created_at），每行操作"激活 / 删除"
- `parseExcel.ts` —— Excel 列名 ↔ rows[] 字段的映射 + 校验（必填、价格非负、有效期格式、mix_group_code 同组内 category_name 一致等）

### 4. 路由

`apps/web/src/routes/`：
- `admin.promotions.tsx` —— `/admin/promotions` 上传页
- `admin.promotions.list.tsx` —— `/admin/promotions/list` 批次列表（或合并到一页）
- `admin.index.tsx` —— 拆掉 "M5 即将开放" 占位，改成 admin 模块导航卡片，第一个就是"促销批次"

### 5. 权限闸

后端 `requireRole('super_admin')` 已在；前端需要：
- 路由级守门：非 super_admin 进 `/admin/promotions` 直接跳 `/`
- HomePage / AdminPage 的菜单卡片对非超管隐藏

可以复用现有 `useMe` + `me.user.roles.includes('super_admin')` 判断。

## 工作量估算

| 项 | 估时 |
|---|---|
| api-client 4 个方法 + shared 类型 | 0.3d |
| Excel 解析 + 字段校验（用 `xlsx` 包） | 0.7d |
| 上传页 UI + 预览表 | 1d |
| 批次列表页 + 激活/删除操作 | 0.5d |
| 路由 + admin 入口卡片 + 权限闸 | 0.3d |
| 联调（小批次 / 大批次 / 含 mix_group / 含错误数据） | 0.5d |
| **合计** | **~3.3d** |

## 待澄清

- Excel 模板长什么样？后端 `uploadSchema` 是结构化 rows[]，但中间需要列名映射 —— 有没有总部固定模板？没有就自定义一份发给业务。
- 上传后是否需要"草稿态"（先上传不激活，超管二次确认再激活）？后端 `activate` 字段在 upload 时可选，默认行为可二选一。
- `sourceFileUrl` 在后端 schema 里是可选 —— 要不要把 .xlsx 也存 OSS？不存的话超管端无法回看原始文件。建议存。

## 关联文件

- 后端实现：[apps/api/src/routes/promotions.routes.ts](../../../apps/api/src/routes/promotions.routes.ts) / [apps/api/src/services/promotions.service.ts](../../../apps/api/src/services/promotions.service.ts)
- 前端占位：[apps/web/src/routes/admin.index.tsx](../../../apps/web/src/routes/admin.index.tsx)
- API 客户端：[apps/web/src/lib/api-client.ts:353](../../../apps/web/src/lib/api-client.ts)
- 共享类型：[packages/shared/src/index.ts](../../../packages/shared/src/index.ts)
- mix_groups 相关历史背景：[2026-06-15-mix-groups-integration-and-dead-chain-cleanup.md](2026-06-15-mix-groups-integration-and-dead-chain-cleanup.md)
