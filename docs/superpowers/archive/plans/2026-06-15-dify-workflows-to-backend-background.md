# Dify 工作流改造：浏览器 tab → 后端真正后台

**日期**：2026-06-15
**状态**：TODO，待启动
**关联**：上一轮已落地的 `runStoreLoginBootstrap` / `ensureStoreInsight` / `ensureSceneQuestions` 范式（commit `7befa47`）

## 背景

目前 5 个 Dify 工作流里只有 2 个真正在后端进程跑（bootstrap 那条线），其余 3 个走"前端 fetch SSE → 浏览器 IIFE 读流 → 完成后写 DB"模式。架构隐患：

- 关 tab / 刷新页面 → IIFE 彻底没了
- DB 里的 `*_status` 字段卡在 'processing' 永远转不到 'completed'
- 用户重进页面看到永久 spinner 或者状态完全丢失

短期已通过 `FlowPage` hydrate 改 + `saveDraft` invalidate cache 修了**同 tab 内 navigate** 的恢复路径（commit 待定）。彻底解决需要本计划。

## 当前盘点

### 走"前端 SSE"模式（要改的）

| # | Workflow | 后端路由 | 前端消费点 | 备注 |
|---|---|---|---|---|
| 1 | **align**（货架对齐 + 三段诊断） | `POST /scenes/:scene/ai/diagnose` | `FlowPage.startDiagnosis` 第一个 IIFE | 拍照后诊断 |
| 2 | **selection**（选品策略） | `POST /scenes/:scene/ai/strategy` | `FlowPage.startDiagnosis` 第二个 IIFE | 拍照后选品 |
| 3 | **virtual-shelf**（虚拟陈列示意图） | `POST /scenes/:scene/ai/virtual-shelf` | `FlowPage` applyMutation 后 IIFE | 5~10 分钟级，已有 `virtualStatus` 状态机做半持久化 |

### 走"前端 SSE"但有后端 bootstrap 兜底的

| # | Workflow | 路由 | 备注 |
|---|---|---|---|
| 4 | **questions**（聊一聊出题） | `POST /insights/surveys/questions/ai` | bootstrap 已 pre-fill，95% 场景这条 SSE 不被触发，前端 `QAPage.genMutation` 仅作为 "历史为空" 兜底 |

### 死端点（清理掉）

| # | Workflow | 路由 | 备注 |
|---|---|---|---|
| 5 | **insight**（4 字段洞察） | `POST /insights/ai/report` | 前端搜不到任何 `streamInsight`；路由健在没人调；bootstrap 已经把 4 字段写好了 |

### 已在后端跑（不动）

- `ensureSceneQuestions` → `difyService.invoke('questions', ...)`，blocking，跑在 API 进程里
- `ensureStoreInsight` → `difyService.invoke('insight', ...)`，同上

## 改造方案

### 目标范式（仿 bootstrap）

每个工作流对应一组：

1. `store_scene_state` 多 1 个 `*_status` 字段（`virtual_status` 已有，align/selection 新加）+ 1 个 `*_raw_outputs` jsonb 存结果
2. 后端新增 `ensureXxx(storeId, scene)`：读 status → 'processing' 即返；'idle'/'failed' → 写 'processing' → `difyService.invoke(workflow, inputs)` blocking → 解析 → 写 'completed' + outputs，失败写 'failed' + 错误信息
3. 触发器（事件驱动，**不靠前端**）：
   - **align/selection**：用户上传完照片落 `/scenes/:scene/photos` 时，fire-and-forget 触发
   - **virtual-shelf**：用户 apply 调改时（`POST /scenes/:scene/adjustments`），fire-and-forget 触发（目前已经是这条时序，只是 IIFE 在前端）
4. 前端：去掉 `streamXxx` + `readWorkflowFinished` 那套，改成 `runtimeQ` 里读 `*_status` + `*_raw_outputs`，按状态机渲染 spinner / 结果
5. 同进程 `xxxInFlight: Set` 防并发重入（已有先例）

### 数据库

新迁移 V0?? 加列：

```sql
ALTER TABLE store_scene_state
  ADD COLUMN diagnose_status   scene_virtual_status DEFAULT 'idle' NOT NULL,
  ADD COLUMN diagnose_raw_outputs JSONB,
  ADD COLUMN strategy_status   scene_virtual_status DEFAULT 'idle' NOT NULL,
  ADD COLUMN strategy_raw_outputs JSONB;
```

复用 `scene_virtual_status` enum（已有 `idle / processing / completed / failed`）。

### 后端

- 新增 `ensureDiagnose / ensureStrategy / ensureVirtualShelf` 三个函数（仿 `ensureStoreInsight`）
- 路由改造：
  - `POST /scenes/:scene/ai/diagnose / strategy / virtual-shelf` → 不再透传 SSE，改成"触发任务"端点（202 Accepted + fire-and-forget）
  - 或者直接走"上传照片即触发 align/selection"+"apply 调改即触发 virtual-shelf"，把这 3 个独立路由都删了
- 状态查询走现有 `GET /scenes/:scene/runtime`
- 删 `POST /insights/ai/report` 路由（死端点）

### 前端

- `FlowPage` 删 `startDiagnosis` 里的 3 个 SSE IIFE
- 替换为：照片上传成功后立刻 `setStage('diagnosing')` + 轮询 `runtimeQ`（refetchInterval 在 `diagnoseStatus` 非终态时拉）
- `LastPage` 已经有类似 `virtualStatus` 轮询模式，照搬
- `QAPage` 暂留 `streamQuestions` —— 它是 bootstrap 失败时的兜底，去掉它就只能依赖 bootstrap

### 触发时序变更

- **现在**：用户点"开始调改"→ 前端调 diagnose/strategy SSE
- **改后**：用户上传照片 → 后端在 `/scenes/:scene/photos` handler 里 fire-and-forget 触发 ensureDiagnose + ensureStrategy → 用户点"开始调改"时大概率已就绪或在跑

或保留显式按钮，但点击只是触发后端 ensure，不在前端读流。

## 工作量估算

| 模块 | 改动 | 估时 |
|---|---|---|
| 1 个新迁移 + scene_service 加字段 | SQL + service layer | 0.5d |
| 3 个 ensureXxx 函数 | 仿现有模板 | 0.5d |
| 触发器接入（上传 photo / apply adjustment） | 路由微调 | 0.5d |
| FlowPage SSE 拆除 + 轮询接入 | 大改造，3 个 IIFE 拆完 + 阶段状态机改 | 1.5d |
| LastPage virtual-shelf 接入新机制（其实只是拆掉前端 IIFE，状态机已是轮询） | 顺手 | 0.5d |
| 删 `/insights/ai/report` 死端点 | 简单 | 0.1d |
| 测试 + 联调 | 关 tab / 刷新 / 切店全场景 | 1d |
| **合计** | | **~4.5d** |

## 风险点

- **Dify 工作流超时**：virtual-shelf 5~10 分钟，blocking 调用要确保 API server 不在 90s 默认 nginx timeout 处挂掉。`streamDifyWorkflow` 是流式连接保活，改成 blocking 后要重新评估 timeout 链路。
- **并发请求互斥**：用户连点"开始调改"两次，需要靠 in-flight Set + status 字段双保险。
- **失败重试**：现在前端 IIFE 没重试，改后端后顺手加 1~2 次重试（virtual-shelf 已经有 3 次重试，可借鉴）。
- **错误信息显式化**：现在 SSE 抛错直接弹给用户，改后要把错信息存进 `*_status='failed'` 时的某个字段（aiError 或 raw_outputs.error），前端能读出来给用户看。

## 关联文件

- `apps/api/src/services/ai-shelves.service.ts` —— `runStoreLoginBootstrap` / `ensureStoreInsight` / `ensureSceneQuestions` 范式
- `apps/api/src/services/scene.service.ts` —— `upsertSceneRuntime`、`virtualStatus` 字段处理
- `apps/api/src/routes/scenes.routes.ts:471-507` —— 3 个待改的 SSE 透传路由
- `apps/api/src/routes/insights.routes.ts:79` —— `/insights/ai/report` 死端点
- `apps/web/src/features/shelves/pages/FlowPage.tsx` —— `startDiagnosis` 的 3 个 IIFE + apply 后 virtual-shelf IIFE
- `apps/web/src/features/shelves/pages/LastPage.tsx` —— `virtualStatus` 轮询参考实现
- `apps/web/src/features/shelves/api.ts:194-203, 319` —— 5 个 streamXxx 待删
- `apps/web/src/features/shelves/sse.ts` —— `readWorkflowFinished` / `extractDiagnosis` / `extractStrategy` / `extractQuestions`，改后只剩 QAPage 还在用（看是否一并清理）
