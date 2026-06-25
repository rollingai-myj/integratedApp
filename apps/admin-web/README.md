# @myj/admin-web · PC 超管控制台

美宜佳门店助手的**PC 端**(总部用),纯客户端 SPA,没有 SSR。移动端在 [apps/web](../web/);后端在 [apps/api](../api/)。

| 项 | 选择 |
|---|---|
| 框架 | React 19 + TanStack Router(文件式路由) |
| 数据 | TanStack Query |
| 样式 | 内联 style + 自维护 `TOKENS`(无 Tailwind / shadcn,跟移动端独立) |
| 构建 | Vite 7(`vite dev` 端口 5174;`vite build` 出纯静态 `dist/`) |
| 部署 | dev:Vite dev server;prod:nginx 容器静态服务 + SPA fallback |
| 鉴权 | 共用后端 session cookie + `super_admin` 角色 gate |

## 启动

平时一起用 docker compose 一把启(仓库根):

```bash
docker compose --profile dev up -d
# PC 超管:http://localhost:8090
```

只跑 admin-web(脱离 docker):

```bash
npm install                              # 仓库根
npm run dev:admin-web                    # 端口 5174
# 浏览器 http://localhost:5174
```

前端通过 `/api/v1/*` 走 `VITE_API_BASE_URL`(docker 内是 `http://api:8787`,本机直跑是 `http://localhost:8787`),登录走后端 session cookie。

## 角色 gate

进入任何 `/_app/*` 路由都会:

1. `GET /auth/me`(`fetchMe()` in `lib/auth.ts`)
2. 如果未登录 → 跳 `/login`
3. 如果已登录但**不是 `super_admin`** → 跳 `/login?reason=no-permission`

普通店长账号即使登录成功也进不来,只能用 `super_admin` 账号(默认 `admin` 用户)。

## 路由(文件式)

`routeTree.gen.ts` 由 `@tanstack/router-plugin` 自动从 `src/routes/` 生成,**不要手动编辑**。

| 路由 | 文件 | 说明 |
|---|---|---|
| `/login` | `routes/login.tsx` | 账号密码登录(`POST /auth/login`),无飞书 SSO |
| `/` | `routes/_app.index.tsx` | 仪表盘:4 KPI + 调改趋势 + Top 5 门店 + 场景占比 |
| `/changes` | `routes/_app.changes.tsx` | 调改记录:筛选 + 分页 + 行展开看智能体分析 + CSV 导出 |
| `/stores` | `routes/_app.stores.tsx` | **门店信息**综合页:批量 CSV 导入 + 列表 + 单店增/改/删 |
| `/uploads/promotions` | `routes/_app.uploads.promotions.tsx` | 活动数据:xlsx 5 工作表上传 + 历史批次启用/停用 |
| `/uploads/products` | `routes/_app.uploads.products.tsx` | 产品主数据:CSV 上传 + 冲突弹窗 + apply/rollback |
| `/uploads/snapshots` | `routes/_app.uploads.snapshots.tsx` | 门店销售快照:CSV 上传 + apply/rollback |

`_app.tsx` 是 layout route,套 `<AppShell>`(三栏:左导航 + 顶 bar + 主区域),`_app.xxx.tsx` 都是它的子路由。

## 目录结构

```
apps/admin-web/
├── public/                           静态资源(promotions-template.xlsx 等)
├── index.html                        Vite SPA 入口
├── vite.config.ts                    端口 5174 + allowedHosts: true(放过 nginx Host header)
├── tsconfig.json
├── package.json
└── src/
    ├── main.tsx                      React 入口(挂 RouterProvider + QueryClient)
    ├── tokens.ts                     设计 tokens:红 #E11D2A、暖白底 #FAF7F2、三阶 ink 色 + 字号 + 阴影
    ├── components/
    │   ├── AppShell.tsx              三栏布局 + 鉴权门 + 顶 bar 头像菜单
    │   ├── ConfirmDialog.tsx         通用确认弹窗 + useConfirmDialog() hook(替代浏览器 confirm())
    │   └── CsvUploadPage.tsx         通用 CSV 上传页(products / snapshots / stores 内嵌共用)
    ├── lib/
    │   ├── api.ts                    apiFetch / ApiError(同源 fetch + cookie)
    │   ├── auth.ts                   fetchMe / logout / isSuperAdmin
    │   ├── uploads.ts                数据上传 API(fetchSpecs / uploadCsv / fetchConflicts / applyBatch / rollback)
    │   ├── promo-uploads.ts          活动数据 xlsx API(走旧 promotions/batches:upload)
    │   ├── stores.ts                 门店档案 API(list / get / create / patch / delete)
    │   └── changes.ts                调改记录 API
    └── routes/                       文件式路由(见上表)
```

## 加一个新页面

1. 在 `src/routes/` 下加 `_app.xxx.tsx`(`_app.` 前缀让它套 AppShell)
2. 用 `createFileRoute('/_app/xxx')({ component: XxxPage })`
3. 在 `components/AppShell.tsx` 的 `NAV` 数组里加菜单项,以及 `pageTitleForPath()` 里加标题映射
4. 保存,`vite dev` 自动重生 `routeTree.gen.ts`

## 常用模式

- **应用内弹窗**:不要用 `window.confirm()`,用 `useConfirmDialog()` + `await confirm({ title, description, danger })`
- **批量操作的冲突预览**:先 `fetchConflicts(batchId)`,有冲突时弹 `<ConflictDialog>` 让用户选 `upsert` / `insert_only` / 取消
- **行展开 inline 编辑**:列表表格 + 点行展开成 form,form 内 PATCH(`null = 清空`、`undefined = 不动`)
- **URL search 同步**:筛选 + 分页用 `validateSearch` + `useNavigate({ replace: true })`,可分享 / 收藏 / 后退

## 调试

```bash
# 实时 dev 日志(HMR / 编译错)
docker compose --profile dev logs -f admin-web

# 改了 routes/ 没生效 → routeTree 是否重生
ls -la src/routeTree.gen.ts

# 生产产物本地预览(模拟 prod runtime stage)
npm run -w apps/admin-web build
npx http-server apps/admin-web/dist -p 4173 -P http://localhost:4173/index.html
```

## 跟其它两个 apps 的关系

```
nginx :80   →  web        (移动端 SSR,8089 出口)
nginx :81   →  admin-web  (PC SPA,8090 出口)
   ↘         ↘
    /api/*   都到 api 容器(同一后端 + 同一 session cookie)
```

后端不区分调用方来自哪个前端,只看 cookie 里的用户角色。
