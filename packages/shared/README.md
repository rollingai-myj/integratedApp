# @myj/shared

前后端共享的 TypeScript 类型定义。**单源:`src/index.ts`**(目前 600+ 行)。

## 为什么独立成 package

- 后端 [apps/api/src/types/api.ts](../../apps/api/src/types/api.ts) 复用同名 interface
- 移动端 [apps/web/src/lib/api-client.ts](../../apps/web/src/lib/api-client.ts) 也复用
- 字段命名 / 可空性变动时,只在这里改一次 → 前后端编译器一起报错催改

## 用法

工作区已经把它声明为依赖,直接 import:

```typescript
import type {
  MeResponse,
  StoreRef,
  CategoryNode,
  ProductRow,
  // ...
} from '@myj/shared';
```

无需 `npm install` 任何东西,monorepo workspaces 已自动 link。

## 内容速览

`src/index.ts` 按主题分块,主要覆盖:

| 主题 | 关键类型 |
|---|---|
| 通用 | `ApiErrorBody`, `HealthResponse` |
| 认证 / 门户 | `CurrentUser`, `MeResponse`, `StoreRef`, `PortalModulesResponse` |
| 总部主数据 | `CategoryNode`, `ProductRow` |
| 货盘 / 场景 | `SceneRuntime` 系列 |
| 价盘 | `PriceCurvePoint`, `PriceChangeRow` |
| 海报 | `PosterTask`, `PosterGeneration`, `CreatePosterTasksRequest`, `ListPosterTasksResponse`, `GetPosterTaskResponse` |
| 促销 | `PromoOfferRow`, `ActivePromosResponse` |
| 竞品 / 洞察 / 问卷 | `Competitor`, `StoreInsight`, `SurveyQuestion` |

完整覆盖范围以 `src/index.ts` 当前内容为准 — 不要凭这份 README 的清单写代码,**以源文件为准**。

## ⚠️ 不在 shared 里的地方

- **admin-web 故意不走 shared**:[apps/admin-web/](../../apps/admin-web/) 的所有 API 响应类型直接定义在它自己的 `src/lib/*.ts`。设计意图是 admin 字段不跨端,**避免让移动端被超管端字段改动牵连**。
- **shelves / competitors 部分用局部类型**:这两个模块的 service 有时候定义自己的 row 类型而不复用 shared,漂移风险翻倍 — 改这两个模块的字段时要格外小心。

## 改一个字段时的协同清单

加 / 改一个跟数据库相关的字段,**5 处必须一起改**(项目惯例):

1. `apps/api/src/db/migrations/V0XX__xxx.sql` — DB schema
2. `apps/api/src/services/<module>.service.ts` — service interface + 投影
3. `packages/shared/src/index.ts` — **共享类型**(就是这里)
4. `apps/web/src/lib/api-client.ts` 或对应 hook — 移动端消费
5. `docs/database-schema.md` + `docs/api-contracts.md` — 文档

漏一处,编译器要么报错,要么 silent 漂移 → 前端拿到 undefined。

## 调试

```bash
# 单独跑 shared 的 tsc
npm run -w packages/shared typecheck
```

通常不单跑 — 它在 api / web / admin-web 各自的 tsc 里都会被联动检查。
