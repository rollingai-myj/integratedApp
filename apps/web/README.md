# @myj/web · 移动端前端

美宜佳门店助手的**移动端**(店长用),iOS 风格,微信 / 飞书 / 浏览器都能打开。PC 端超管控制台是另一个项目: [apps/admin-web](../admin-web/)。

| 项 | 选择 |
|---|---|
| 框架 | React 19 + TanStack Start (SSR) |
| 路由 | TanStack Router(文件式路由) |
| 数据 | TanStack Query |
| 样式 | Tailwind CSS 4 + shadcn/ui |
| 构建 | Vite 7 |
| dev | `vite dev`,端口 5173;nginx 反代 80 → 宿主 8089 |

## 启动

平时跟全栈一起用 docker compose 一把启(在仓库根):

```bash
docker compose --profile dev up -d
# 移动端: http://localhost:8089
```

只跑前端(后端走宿主 8787):

```bash
npm install                         # 仓库根
npm run dev:web                     # 端口 5173
# 浏览器 http://localhost:5173 (跟后端约好 CORS / proxy)
```

前端通过 `/api/*` 代理到后端(vite.config 里 `VITE_API_BASE_URL` 控制),docker compose 里走 `http://api:8787`,本机直跑走 `http://localhost:8787`。

## 路由结构(文件式)

文件名按 TanStack Router 约定(`xxx.yyy.tsx` → `/xxx/yyy`,`$param` 表示动态段)。`routeTree.gen.ts` 由 `@tanstack/router-plugin` 自动从 `src/routes/` 生成,**不要手动编辑**。

| 路由 | 文件 | 说明 |
|---|---|---|
| `/` | `routes/index.tsx` | 首页:四个模块卡片(选品 / 价盘 / 海报 / 门户)+ 当前门店 |
| `/login` | `routes/login.tsx` | 账号密码 / 飞书 OAuth 二选一 |
| `/select-store` | `routes/select-store.tsx` | 多门店账号选门店 |
| `/shelves` | `routes/shelves.index.tsx` | 货盘选品首页(12 个场景卡片 + badge) |
| `/shelves/scene/$scene/index` | `routes/shelves.scene.$scene.index.tsx` | 单场景调改主屏 |
| `/shelves/scene/$scene/info` | …`.info.tsx` | 场景信息 |
| `/shelves/scene/$scene/setup` | …`.setup.tsx` | 货架配置 |
| `/shelves/scene/$scene/qa` | …`.qa.tsx` | 问卷 |
| `/shelves/scene/$scene/flow` | …`.flow.tsx` | 选品流程(拍照 → 诊断 → 选品 → 应用 → 虚拟陈列) |
| `/shelves/scene/$scene/records` | …`.records.tsx` | 历史调改记录 |
| `/shelves/scene/$scene/last` | …`.last.tsx` | 上次调改回顾 |
| `/prices` | `routes/prices.index.tsx` | 价盘 grid + 模拟调价 |
| `/prices/cold` | `routes/prices.cold.tsx` | 冷藏品独立分组 |
| `/posters` | `routes/posters.index.tsx` | 海报应用(选品 → 单张 / 批量生成 → 收藏 / 历史) |

> 移动端**已经没有** `/admin` 路由 —— 后台功能整体迁移到 [apps/admin-web](../admin-web/)(PC 端,nginx 81 端口)。

## 目录约定

```
apps/web/
├── public/                  静态资源(图标、style-refs 风格参考图等)
├── src/
│   ├── assets/              图片
│   ├── components/
│   │   ├── ui/              shadcn 组件库(保持原样不改)
│   │   ├── posters/         海报模块的子组件 / context
│   │   ├── shelves/         选品模块的子组件
│   │   ├── BrandMark.tsx
│   │   └── IOSDevice.tsx    所有业务路由必须 <IOSDevice> 包裹,否则字号比例错乱
│   ├── features/            按模块组织的页面级容器
│   ├── hooks/               自定义 hook
│   ├── lib/
│   │   ├── api-client.ts    后端调用封装(promotionsApi / postersApi / ...)
│   │   ├── auth.ts          认证状态 + useSwitchStore
│   │   ├── hooks.ts         所有 useQuery / useMutation hook 集中地
│   │   └── utils.ts         shadcn cn() 工具
│   ├── routes/              文件式路由(每加一个文件就多一个页面)
│   ├── server.ts            SSR 服务端入口
│   ├── start.ts             TanStack Start 实例
│   ├── router.tsx           客户端 router 入口
│   ├── routeTree.gen.ts     自动生成,不要编辑
│   └── styles.css           全局样式(含 Tailwind 指令)
└── vite.config.ts
```

## 加一个新页面

1. 在 `src/routes/` 下加一个文件,如 `prices.detail.tsx`
2. 文件名按 TanStack Router 命名(`prices.detail.tsx` → `/prices/detail`)
3. 用 `<IOSDevice>` 包裹(业务路由都要,否则字号错乱)
4. 保存,vite dev 自动重生 `routeTree.gen.ts`

## 加一个新的 API 调用

1. 在 [docs/api-contracts.md](../../docs/api-contracts.md) 找对应接口的契约
2. 在 `src/lib/api-client.ts` 加一个调用函数(snake_case → camelCase 通常已在后端做了)
3. 在 `src/lib/hooks.ts` 加一个 `useXxx` hook 走 `useQuery` / `useMutation`
4. 页面里 `const { data } = useXxx(...)` 用

## 状态管理

完整清单见 [docs/state-management.md](../../docs/state-management.md)。三层视角速查:

| 层 | 存什么 |
|---|---|
| 服务端 session(cookie `sso_token` + `user_sessions.active_store_id`) | 真理源:登录身份 + 当前激活门店 |
| TanStack Query 缓存(`['auth', 'me']` / `['scenes', ...]` 等) | 服务端 state 的客户端副本 |
| React Context + localStorage | 纯客户端 state(IOSDevice zoom / GuideStep / 海报 session / 收藏 LRU 等) |

## 调试

```bash
# 看实时 web 日志(SSR 报错 / vite HMR 状态)
docker compose --profile dev logs -f web

# 切到本机直跑(不走 docker)
npm run dev:web   # http://localhost:5173

# 改了 routes/ 没生效 → 看 routeTree.gen.ts 是否更新
ls -la src/routeTree.gen.ts
```

## 双入口

```
nginx :80  →  web  (你在编辑的这个项目,移动端 SSR,端口 8089)
nginx :81  →  admin-web (PC 超管控制台,端口 8090)
```

两边走的是**同一组后端 + 同一份 session cookie**,只是按 host:port 分到不同前端容器。
