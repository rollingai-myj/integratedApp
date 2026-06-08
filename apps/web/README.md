# @myj/web · 统一前端

美宜佳门店助手的统一前端，基于 React 19 + TanStack Start + TanStack Router + Tailwind CSS 4 + shadcn/ui。

## 启动

```bash
# 在仓库根目录
npm install                     # 装所有 workspace 依赖
cp apps/web/.env.example apps/web/.env

# 启动开发服务器（端口 5173）
npm run dev:web

# 浏览器打开 http://localhost:5173
```

前端通过 `/api` 代理到后端（默认 `http://localhost:8787`），所以请确保后端也在跑：

```bash
# 另一个终端
npm run dev:api
```

## 路由结构（M0）

```
/             门户首页（已登录时显示 4 个模块卡片）
/login        登录页
/shelves      货盘选品（M2 实现，当前是空白页占位）
/prices       价盘管理（M3 实现）
/posters      活动海报（M4 实现）
/admin        后台管理（M5 实现）
```

文件式路由由 [`@tanstack/router-plugin`](https://tanstack.com/router) 自动从 `src/routes/` 生成 `src/routeTree.gen.ts`。**不要手动编辑** `routeTree.gen.ts`，它会被覆盖。

## 目录约定

```
apps/web/
├── public/                  静态资源
├── src/
│   ├── assets/              图片
│   ├── components/
│   │   ├── ui/              shadcn 组件库（保持原样不动）
│   │   ├── BrandMark.tsx
│   │   └── IOSDevice.tsx
│   ├── hooks/               自定义 hook
│   ├── lib/
│   │   ├── api-client.ts    后端调用封装
│   │   ├── auth.ts          认证状态管理
│   │   └── utils.ts         shadcn 的 cn() 工具
│   ├── routes/              文件式路由（每加一个文件就多一个页面）
│   ├── server.ts            SSR 服务端入口
│   ├── start.ts             TanStack Start 实例
│   ├── router.tsx           Router 客户端入口
│   ├── routeTree.gen.ts     自动生成，不要编辑
│   └── styles.css           全局样式（含 Tailwind 指令）
└── vite.config.ts
```

## 加一个新页面

1. 在 `src/routes/` 下加一个文件，例如 `prices.detail.tsx`
2. 文件名按 TanStack Router 约定（`xxx.yyy.tsx` 表示 `/xxx/yyy`）
3. 保存后开发服务器会自动重启，`routeTree.gen.ts` 自动更新

## 加一个新的 API 调用

1. 在 [docs/planning/unified-api-spec.md](../../docs/planning/unified-api-spec.md) 找到对应接口
2. 在 `src/lib/api-client.ts` 里加一个调用函数
3. 在页面里用 `@tanstack/react-query` 调用

## 后续里程碑

| 里程碑 | 影响前端的部分 |
|---|---|
| M1 | 完成飞书登录、`/me` 真实化、门户首页对接真实模块和门店 |
| M2 | 选品全部页面、拍照检测、虚拟货架可视化 |
| M3 | 价盘列表、调价弹窗、价格曲线、竞品对标 |
| M4 | 海报选品、单张生成、批量队列、历史 |
| M5 | 后台管理界面 |

详见 [docs/milestones.md](../../docs/milestones.md)。
