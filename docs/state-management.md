# 前端状态管理清单

> 前端所有"持续存在的状态" —— 它住哪、谁写它、谁读它。**目的**：避开"以为是局部 state 其实被全模块依赖"的隐性耦合。
>
> **栈**：React + TanStack Router + TanStack Start (SSR + Server Functions) + TanStack Query + Vite。源码：[apps/web/src/](../apps/web/src/)
>
> **三层视角**：
> 1. **服务端 session**（cookie `sso_token` + DB `user_sessions.active_store_id`）—— 真理源
> 2. **TanStack Query 缓存** —— 服务端 state 的客户端副本
> 3. **React Context / 组件 state / localStorage** —— 纯客户端 state
>
> 接口契约 → [api-contracts.md](./api-contracts.md)；数据形状 → [data-flow.md](./data-flow.md)

---

## 全局依赖速查表（核心）

| 状态 | 住在哪 | 谁写 | 谁读（top 5） | 生命周期 |
|---|---|---|---|---|
| **Current User (me)** | Query `['auth', 'me']` | `useLogin()`, `useFeishuExchange()`, `useLogout()` invalidation | HomePage、所有模块 guard、route guard | 应用挂载 fetch；登录/登出/切店 invalidate |
| **Current Store** | 嵌在 `me.currentStore`（后端 session 是真理源） | `useSwitchStore()` (POST /portal/active-store) → invalidate `['auth','me']` | HomePage、所有模块 storeId queryKey、select-store guard | 后端 session 持久；切店触发 me 重拉 |
| **Visible Stores** | Query `['portal', 'stores']` | GET /portal/stores | select-store 页、HomePage 下拉 | 按需 fetch，切店 invalidate |
| **Scenes (List)** | Query `['scenes', 'list']` | GET /scenes | 货盘首页卡片、所有 scene 详情页 | 一次 fetch，10 min stale |
| **Scene Runtime (Draft)** | Query `['scenes', scene, 'runtime']` | GET / PUT /scenes/:scene/runtime | FlowPage / InfoPage / QAPage / SetupPage / LastPage | 进路由 fetch；保草稿 / apply 后 invalidate |
| **Scene Adjustment Counts** | Query `['scenes', 'counts', storeId]` | GET /scenes/adjustments-count | 货盘首页 badge | 30s stale |
| **Shelves Config** | Query `['shelves', 'config', storeId]` | GET /shelves/config | SetupPage | 60s stale |
| **Price Curve** | Query `['prices', 'curve', storeId, skuCodes, daysBack]` | GET /prices/curve | SkuDetailDialog、价格图 | 60s stale |
| **Price Changes** | Query `['prices', 'changes', storeId, skuCode?, limit?]` | GET /prices/changes | SkuDetailDialog 时间线 | 30s stale |
| **Store SKU Master** | Query `['master', 'skus', storeId, scene, query]` | GET /store/skus | 价盘 grid、海报选品 | 30s stale；调价后 invalidate |
| **Poster Tasks** | Query `['posters', 'tasks', ...]` + JobsContext 本地 | GET /posters/tasks + JobsContext 3 s 轮询 | 海报应用主屏、JobsBadge | 创建/取消/重生 invalidate |
| **Poster Task Detail** | Query `['posters', 'task', taskId]` | GET /posters/tasks/:taskId | 详情页 | 重生 invalidate |
| **Poster Gallery** | Query `['posters', 'gallery', ...]` | GET /posters/gallery | 已保存海报 tab | 30s stale |
| **Poster Assets** | Query `['posters', 'assets', kind]` | GET /posters/assets | 素材选择器 | 60s stale；上传/删除 invalidate |
| **Poster Today Count** | Query `['posters', 'today-count']` | GET /posters/today-count | 当日配额 badge | 60s stale；建任务 invalidate |
| **Active Promotions** | Query `['promotions', 'active']` | GET /promotions/active | 海报促销 grid | 5 min stale |
| **Recommended Promotions** | Query `['promotions', 'recommend']` | GET /promotions/recommend | 推荐 carousel | 5 min stale |
| **Poster Jobs Queue** | `JobsProvider [jobs, setJobs]` | `listMyActiveJobs()` (3s poll) + `processPosterJob()` + 入队占位 | JobsBadge、job drawer | 登录后 3s 轮询；登出清空 |
| **Active Session（工作块）** | localStorage `poster-app/current-session-v1` | `getOrStartSession()`, `appendBatchToSession()`, `endSession()` | JobsContext activeSession memo | 入队创建；存档/清空/30 min idle 结束 |
| **IOSDevice Zoom** | React Context (`IOSDeviceCtx`) | resize / visualViewport 监听 | Radix Dialog/Popover（portal 出去的） | 挂载 init，实时更新 |
| **Guide Step** | React Context (`GuideCtx`) + localStorage `myj_guide_seen_v1` | `setStep` 用户操作 | GuideOverlay | 首次启动；完成 / skip 标记 |
| **Promotion Selection** | React Context (`PromotionCtx`) | 用户选择促销 | 海报 Batch 屏幕 | 仅会话内，刷新即丢 |
| **Recent Posters** | localStorage `poster-app/recent-v1` | `addRecent()` 生成成功 | RecentDrawer | 最多 30，iOS Safari 大 base64 加载时过滤 |
| **Session History** | localStorage `poster-app/session-history-v2` | `saveSession()` session 结束 | 销量跟踪 dashboard | session 结束写入 |
| **Promo Mode** | localStorage `promoMode` | 用户切换 'stack'/'memberOnly' | 促销 grid 过滤 | 持久；启动加载 |

---

## 1 · 认证 & Session State

### Current User

**判定登录**：
- 后端在 `/api/v1/auth/login` 或 `/api/v1/auth/feishu/exchange` 成功后写 HttpOnly cookie `sso_token`
- 前端通过 `GET /api/v1/auth/me` 拿 `MeResponse`，缓存到 Query `['auth', 'me']`
- `useMe()`：[apps/web/src/lib/auth.ts:16-30](../apps/web/src/lib/auth.ts)
- `isAuthenticated(me)`：[apps/web/src/lib/auth.ts:88-91](../apps/web/src/lib/auth.ts) —— 看 `me?.user` 存不存在

**登录流程**：
1. 用户进 `/login`（[routes/login.tsx](../apps/web/src/routes/login.tsx)）
2. 两种登录（组件本地 state `mode`）：
   - **飞书 OAuth**：`useFeishuExchange()` → POST `/auth/feishu/exchange`
   - **账密**：`useLogin()` → POST `/auth/login`
3. 两者 onSuccess 都 invalidate `['auth', 'me']` → 自动重拉 → HomePage 检测 `isAuthenticated(me)` 后跳走
4. **401 不重试**（[lib/auth.ts:25-28](../apps/web/src/lib/auth.ts)）—— 让 route guard 立刻跳登录页

**新行为**：后端**已经不再返 409 NO_STORE_SELECTED**（业务接口逻辑还在，但 `/auth/me` 永远返响应；session 里 `currentStore` 为 null 让前端去 select-store）。所以前端**没有 409 catch block**，靠 route guard 跳转处理。

### Current Store (currentStoreId)

**真理源**：后端 session `user_sessions.active_store_id`。
**客户端副本**：嵌在 `MeResponse.currentStore` 里，住在 `['auth', 'me']` Query 缓存。

**读它的地方**：
- [routes/index.tsx:94](../apps/web/src/routes/index.tsx): `const store = me.currentStore`
- [routes/select-store.tsx:54](../apps/web/src/routes/select-store.tsx): `if (me?.currentStore) navigate('/')`
- [features/shelves/AppShell.tsx:22](../apps/web/src/features/shelves/AppShell.tsx): 货盘模块入口 guard
- [routes/posters.index.tsx:50](../apps/web/src/routes/posters.index.tsx): 传给 host-bridge
- [lib/hooks.ts](../apps/web/src/lib/hooks.ts) 全部带 storeId 的 hook

**写它的地方**：唯一入口 `useSwitchStore()`（[lib/auth.ts:65-72](../apps/web/src/lib/auth.ts)）→ POST `/portal/active-store` → 成功 invalidate `['auth', 'me']`。

**关键不变量**：所有带门店上下文的 queryKey 都把 `storeId` 列在 key 里 —— **切店 → key 变 → 老缓存被丢 → 自动用新 storeId 重新请求**。这是整个换店逻辑的核心机制，**新增带 storeId 的 query 必须遵守**。

### Logout

`useLogout()`（[lib/auth.ts:76-86](../apps/web/src/lib/auth.ts)）→ POST `/auth/logout` (204) → invalidate `['auth', 'me']` + `['portal', 'stores']` → 前端跳 `/login`。使用点：[routes/index.tsx:110-115](../apps/web/src/routes/index.tsx) 头部退出按钮。

---

## 2 · React Context Providers

### `IOSDeviceCtx` —— **业务路由必包**

**位置**：[components/IOSDevice.tsx:26](../apps/web/src/components/IOSDevice.tsx)

```ts
interface IOSDeviceCtx {
  zoom: number;        // viewportWidth / 390 (iPhone 14 设计宽度)
  designWidth: number; // 永远 390
}
```

**作用**：业务路由统一以 390 px 为设计宽度，根据真机视口算 zoom 比例。同时把 zoom 同步到 `--iod-zoom` / `--iod-h` CSS 变量供样式 token 用。

**写**：mount 后读 CSS 变量初值（SSR 注入）；effect 监听 `window.resize` + `visualViewport.resize/scroll`（[IOSDevice.tsx:68-92](../apps/web/src/components/IOSDevice.tsx)）。

**读**：Radix 的 Dialog/Popover **portal 到 body** —— 跑出了 IOSDevice 的 zoom 容器 —— 所以这些组件要 `useIOSDeviceZoom()` 拿到 zoom 后用 inline style `zoom` 把自己缩回去。

> ⚠️ **强约束（CLAUDE memory 记录的硬规矩）**：所有业务模块路由必须 `<IOSDevice>` 包裹，否则字号比例错乱。新加路由时必检。

### `PromotionCtx` —— 海报促销选择缓冲

[components/posters/PromotionContext.tsx:30](../apps/web/src/components/posters/PromotionContext.tsx)

```ts
{ selected: SelectedPromotion | null;
  setSelected: ...;
  batch: SelectedPromotion[];
  setBatch: ... }
```

仅会话内，刷新即丢。

### `GuideCtx` —— 首次引导

[components/posters/GuideContext.tsx:31](../apps/web/src/components/posters/GuideContext.tsx)

```ts
{ step, isActive, start, next, skip }
```

持久标记走 localStorage key `myj_guide_seen_v1`，`hasSeenGuide()` / `markSeen()` 控制是否首次启动自动跑引导。

### `JobsCtx` —— 海报生成任务队列（**最复杂**）

[components/posters/JobsContext.tsx](../apps/web/src/components/posters/JobsContext.tsx)

外暴露：

```ts
{ batches, active, activeSession,
  enqueueBatch, requeueJob,
  dismiss, endCurrentSession, dismissCurrentSession, refresh }
```

Provider 内部状态：

```ts
const [jobs, setJobs] = useState<Job[]>([]);        // 所有 job 行
const [userId, setUserId] = useState<string|null>(null);
const [sessionTick, setSessionTick] = useState(0);  // 强制重读 localStorage session
const workersByBatch = useRef<Set<string>>(new Set()); // 防重复 worker pool
```

**写入路径**：
- 3 s 轮询 `listMyActiveJobs()` → merge（[JobsContext.tsx:160-167](../apps/web/src/components/posters/JobsContext.tsx)）
- 入队 `enqueueBatch()` → 立刻插占位（line 319）
- Worker 跑完 `processPosterJob()` → 更新结果（line 245）
- 乐观先 mark 为 processing 再发给 worker（line 235-236）

**生命周期**：
- Auth 状态变化（[line 122-133](../apps/web/src/components/posters/JobsContext.tsx)）：登录后 setUserId + 启动 3s 轮询；登出后清空 jobs + clearSession + 抖 sessionTick
- Worker pool（line 225-254）：并发 5；逐 job 处理
- 心跳（line 213-223）：每 60s 检查，session 30 min 没动就结束

**Stuck 处理**：90 s（STUCK_MS）以上仍 queued/processing 的视为僵尸 → 从 activeSession 视图隐藏（line 429），自动 dismiss（line 444-447），server 端 `resetStaleJob()` 尝试重置（line 200）。

**消费者**：[JobsBadge.tsx](../apps/web/src/components/posters/JobsBadge.tsx)、海报 App 主屏、各 drawer。

### 其他 Context（UI primitives，跳过）

- `FormFieldContext` / `FormItemContext`（shadcn form 内部）
- `SidebarContext` / `ChartContext` / `CarouselContext` / `ToggleGroupContext`

---

## 3 · TanStack Query 缓存（按域）

### QueryClient 配置

[routes/__root.tsx:46-56](../apps/web/src/routes/__root.tsx)

```ts
defaultOptions: {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  },
}
```

### Auth / Portal

| QueryKey | 端点 | Hook | Trigger | 消费者 |
|---|---|---|---|---|
| `['auth','me']` | GET /auth/me | `useMe()` | app 启动；登录/登出/切店 invalidate | 所有 route guard |
| `['portal','stores']` | GET /portal/stores | `useVisibleStores()` | 手动 + 切店 invalidate | select-store |

### Master / Store

| QueryKey | Trigger / Enabled | 消费者 |
|---|---|---|
| `['master','stores']` | 手动 | 全局门店列表 |
| `['master','skus', storeId, scene, q]` | enabled: storeId | 价盘 SKU grid、海报选品 |

### Shelves / Scenes

| QueryKey | Stale | 消费者 |
|---|---|---|
| `['shelves','config', storeId]` | 60 s | SetupPage |
| `['scenes','list']` | 10 min | 货盘首页、所有 scene 页 |
| `['scenes','counts', storeId]` | 30 s | 货盘首页 badge |
| `['scenes', scene, 'runtime']` | — | FlowPage、InfoPage、QAPage、SetupPage |
| `['scenes', scene, 'shelves']` | — | InfoPage、SetupPage |
| `['scenes', scene, 'adjustments']` | — | RecordsPage、LastPage |
| `['scenes', scene, 'survey', 'questions']` | — | QAPage |

### Prices

| QueryKey | Stale | 消费者 |
|---|---|---|
| `['prices','curve', storeId, skuCodes, daysBack]` | — | 价格图、SkuDetailDialog |
| `['prices','changes', storeId, skuCode?, limit?]` | — | 历史对话框 |

Mutation：`useSubmitPriceChange()` ([lib/prices/...](../apps/web/src/lib/prices) line 126-139)
→ invalidate `['master','skus', ...]` + `['prices','curve', ...]` + `['prices','changes', ...]`

### Posters

| QueryKey | Stale | 消费者 |
|---|---|---|
| `['posters','tasks', scope, status, batchId, storeId, limit]` | 30 s | 海报主屏 |
| `['posters','task', taskId]` | 30 s | 详情 |
| `['posters','today-count']` | 60 s | 配额 badge |
| `['posters','gallery', ...]` | 30 s | 画廊 |
| `['posters','assets', kind]` | 60 s | 素材选择器 |
| `['posters','sales-tracking', days]` | 5 min | 销量 dashboard |
| `['posters','list', ...]` | 30 s | **已 deprecated**，删 |

Mutations（[lib/api-client.ts:211+](../apps/web/src/lib/api-client.ts)）：
- `useCreatePosterTasks` → invalidate tasks + today-count
- `useCancelPosterBatch` → invalidate tasks
- `useRegeneratePosterTask` → invalidate tasks + task detail
- `useAdoptPoster` → invalidate `['posters']` **通配**（粒度过粗，可优化为 gallery 单 key）
- `useDownloadPoster` → 不 invalidate（只增计数）
- `useUploadPosterAsset` / `useDeletePosterAsset` → invalidate assets

### Promotions

| QueryKey | Stale | 消费者 |
|---|---|---|
| `['promotions','active']` | 5 min | 海报促销 grid |
| `['promotions','recommend']` | 5 min | 推荐 carousel |

### Route Loader 预拉

**目前没有**。所有 query 都是组件 render 后才发起，没有 loader 级预拉。

---

## 4 · TanStack Router State

### URL Params

- `/shelves/scene/$scene/flow` （以及 `info` / `qa` / `setup` / `last` / `records`）
  - `useParams` 读 `scene: string`，包成 `queryKey: ['scenes', Number(scene), 'runtime']`
  - [FlowPage.tsx:57-58](../apps/web/src/features/shelves/pages/FlowPage.tsx)

### Search Params

- `/login?code=<feishu_code>&state=<state>`：飞书回调；Zod 校验后自动触发 `useFeishuExchange()`（[routes/login.tsx:24-30](../apps/web/src/routes/login.tsx)）

### Root Route Context

[routes/__root.tsx](../apps/web/src/routes/__root.tsx)：

- 全局 `<QueryClientProvider>`
- 全局 `<Toaster>`（早期 bug：只有 prices.cold 有局部 toaster → shelves/posters 的 toast 静默 —— 已修，挪到 root）

---

## 5 · 重点 Local Component State

跳过普通 `useState`。只列**承载业务态**或**深度 prop 钻**的：

### `/routes/login.tsx`

```ts
const [mode, setMode] = useState<LoginMode>('choose');
const [account, setAccount] = useState('');
const [password, setPassword] = useState('');
const [feishuStarting, setFeishuStarting] = useState(false);
const [errMsg, setErrMsg] = useState<string|null>(null);
```

### `/routes/index.tsx` （切店下拉）

```ts
const [open, setOpen] = useState(false);
```

### `/routes/select-store.tsx`

```ts
const [keyword, setKeyword] = useState('');
const [pickingId, setPickingId] = useState<string|null>(null); // 防多点击
```

### FlowPage（货盘核心工作流，**state 最重**）

[features/shelves/pages/FlowPage.tsx:73-91](../apps/web/src/features/shelves/pages/FlowPage.tsx)

```ts
const [stage, setStage] = useState<Stage>('photo');
const [photos, setPhotos] = useState<Array<{ url: string; localPreview?: string }>>([]);
const [uploading, setUploading] = useState(false);
const [detectBoxes, setDetectBoxes] = useState<DetectBox[]|null>(null);
const [detectError, setDetectError] = useState<string|null>(null);
const [detectDone, setDetectDone] = useState(false);
const [diagnosis, setDiagnosis] = useState<DiagnosisResult|null>(null);
const [strategy, setStrategy] = useState<AiStrategyItem[]|null>(null);
const [aiError, setAiError] = useState<string|null>(null);
const [reviewIndex, setReviewIndex] = useState(0);
const [decisions, setDecisions] = useState<Decision[]>([]);
const [skipReasons, setSkipReasons] = useState<(string|null)[]>([]);
const [hydrated, setHydrated] = useState(false);
```

**生命周期**：
1. mount → 从 server `runtime.draft` hydrate
2. user 推进 stage：`photo` → `diagnosing` → `review` → `confirm` → `applied`
3. 每次状态变化 `saveDraft()` 写回 runtime
4. `diagnosing` 阶段并行起 3 个 SSE 流（detect + diagnose + strategy）
5. `applied` 后再起 virtual-shelf SSE

### QAPage / SetupPage / RecordsPage / InfoPage / LastPage

每页都有自己的 local state + 各自的 `useQuery`（详见上表）。模式相对统一。

### 海报 App 各屏

`/components/posters/screens/*.tsx`：表单输入 + UI mode（loading/error）；跨屏 state 全走 Context（PromotionCtx / GuideCtx / JobsCtx）。

---

## 6 · 持久化客户端存储

### localStorage 总览

| Key | 内容 | 角色 |
|---|---|---|
| `myj_guide_seen_v1` | 首次引导完成标志 | UX 偏好 |
| `poster-app/recent-v1` | 最近 30 张海报（含 base64 dataURL，iOS Safari 加载时过滤） | 便捷 |
| `poster-app/session-history-v2` | 工作 session 历史（最多 30，含 storeId） | 销量跟踪用 |
| `poster-app/current-session-v1` | **当前活跃工作 session**（batchIds + 时间戳） | **承重** —— 见下方 ⚠️ |
| `UPLOAD_MODE_REMEMBER_KEY` | 上次选的上传模式 | UX 偏好 |
| `poster-app/bg-photo:<storeId>` | 该店上次背景图 dataURL | 便捷 |
| `poster-app/png-probes` | PNG 探测结果缓存 | 内部加速 |
| `promoMode` | `'stack' \| 'memberOnly'` | UX 偏好 |

### ⚠️ "承重"的 localStorage：`current-session-v1`

JobsContext 用它把"多次入队的多个 batch"聚成一个用户可见的 session（页面刷新都不丢）。如果手动清掉：
- 内存 `[jobs]` 会变孤儿
- 下次入队会生成新 session id
- **但 auth state 变化时整体清空**，所以实际风险低

> CLAUDE memory 里有规矩："不能为了赶时间退到 localStorage / no-op / silent catch"。当前列出的 localStorage 都**不是绕过 schema 的 shortcut**，而是 UX 缓存 / Session 聚合。新增 storage 要确认是不是又踩回这条线。

### Cookies

仅一项：HttpOnly `sso_token`（后端写，前端读不到）。

---

## 7 · 实时 / 流式状态

### SSE Workflow（5 个 AI 端点）

实现位置：[apps/web/src/features/shelves/sse.ts](../apps/web/src/features/shelves/sse.ts)

| 端点 | Workflow | 结果落入 |
|---|---|---|
| POST `/scenes/:scene/photos` | （不是 SSE）JSON `{ boxes, elapsedMs }` | `detectBoxes` 本地 state |
| POST `/scenes/:scene/ai/diagnose` | Dify align | `diagnosis: DiagnosisResult` 本地 state |
| POST `/scenes/:scene/ai/strategy` | Dify selection | `strategy: AiStrategyItem[]` 本地 state |
| POST `/scenes/:scene/survey` | Dify questions | survey questions cache |
| POST `/scenes/:scene/ai/virtual-shelf` | Dify virtual_shelf | VirtualShelfRenderer prop（无结构化） |

**核心 helper**：
- `readWorkflowFinished()`：流式读 Response body，解 Dify SSE 格式，取 `workflow_finished.data.outputs`
- `extractDiagnosis()` / `extractStrategy()` / `extractQuestions()` / `extractVirtualShelf()`：从 outputs 里按 key 优先级提取数据（Selection → ShelfAiResult → SelectionResult → result → text → output）

⚠️ **CLAUDE memory 记录**：Dify outputs 兼容 string/object 时 string 分支必须先整段 `JSON.parse` 再退到正则；否则正则会错抓 strategy 内部的 skus 子数组。

### 轮询

| 哪里 | 间隔 | 做什么 |
|---|---|---|
| `JobsContext.refresh()` | 3 s | 拉 `/posters/.../my-active`，合并到本地 jobs |
| 心跳监测（idle） | 60 s | 检查 session 是否超 30 min 没动 |

**没有** WebSocket。

---

## 8 · 风险清单

### 状态重复

1. **门店选择 双写**
   - 后端 session（真）
   - 前端缓存（`me.currentStore`）
   - 风险：任何新加的"改 active store"路径**必须** invalidate `['auth','me']`，否则前端停留在旧店
   - 当前唯一入口 `useSwitchStore()` 已正确处理

2. **海报 job 状态 双写**
   - 后端：完整 job 行（queued/processing/done/error）
   - 前端：3s 轮询拿 active + 本地保 done/error
   - 协调规则：server 的 done/error 覆盖 local queued/processing
   - 副作用：90 s 老的本地 done/error 被自动隐藏（"stuck" 清理），用户可能以为 job 消失了

3. **工作 session 双写**
   - 内存 `JobsContext.activeSession`（从 jobs 推导）
   - localStorage `current-session-v1`（持久化）
   - 不一致时以 localStorage 为准（sessionTick 触发重读）

### 重构残留

1. ❌ `postersApi.generate()` / `postersApi.list()`：已 deprecated 仍在 [api-client.ts](../apps/web/src/lib/api-client.ts)。**全文 grep 后删**。

2. ❌ 没有 `NO_STORE_SELECTED` (409) 的 catch block。后端现在不再返 409（改成 currentStore: null + route guard 跳转）。如果后端**回退**，前端就会陷入 401-redirect 循环。

3. ⚠️ `extractVirtualShelf()` 返回 raw outputs，VirtualShelfRenderer 消费 `unknown`。Dify workflow 改字段时静默崩，没有 schema 守护。

### 失效粒度过粗

- `useAdoptPoster()` invalidate `['posters']` 通配 → 重拉 tasks + gallery + assets + today-count + sales-tracking 全部
- 应该只 invalidate `['posters', 'gallery']` 和 `['posters','task', taskId]`

### 错误兜底缺失

- 货盘 FlowPage 3 路 SSE 都挂时，UI 显示 errMsg 但**没有 retry 按钮**，用户得回退路由再进
- 价格图 SkuDetailDialog 在 query error 时无明确 fallback

---

## 9 · 新加东西时的检查表

加新业务路由 →
- [ ] 用 `<IOSDevice>` 包了吗
- [ ] 用到 storeId 的 queryKey 把 storeId 列进去了吗
- [ ] mutation onSuccess 决定 invalidate 哪个 key（默认 specific，少用通配）

加新 Context →
- [ ] Provider 在哪个层挂；登出/切店时是否要重置

加新 localStorage →
- [ ] 是 UX 偏好 / 缓存（OK），还是绕开后端 schema 的 shortcut（**不行**）
- [ ] 是否要在登出时清

加新 SSE 消费 →
- [ ] 用 `readWorkflowFinished()` 复用解析骨架
- [ ] 用 `extractXxx` 写明的 key 优先级
- [ ] Dify outputs 兼容 string/object 时**先整段 JSON.parse**
- [ ] FlowPage 里要在 stage 切换时清理半成品 state
