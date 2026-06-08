/* eslint-disable */
/**
 * 自动生成 —— 不要手动编辑
 *
 * 这份文件由 @tanstack/router-plugin 在 dev / build 时自动从 src/routes/ 生成。
 * 仓库里 commit 一份初始版本是为了让 `npm run typecheck` 不依赖 dev server 运行过一次。
 */
import { Route as rootRoute } from './routes/__root.js';
import { Route as IndexRoute } from './routes/index.js';
import { Route as LoginRoute } from './routes/login.js';
import { Route as ShelvesIndexRoute } from './routes/shelves.index.js';
import { Route as PricesIndexRoute } from './routes/prices.index.js';
import { Route as PostersIndexRoute } from './routes/posters.index.js';
import { Route as AdminIndexRoute } from './routes/admin.index.js';

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': { parentRoute: typeof rootRoute };
    '/login': { parentRoute: typeof rootRoute };
    '/shelves/': { parentRoute: typeof rootRoute };
    '/prices/': { parentRoute: typeof rootRoute };
    '/posters/': { parentRoute: typeof rootRoute };
    '/admin/': { parentRoute: typeof rootRoute };
  }
}

const IndexRouteFinal = IndexRoute.update({
  path: '/',
  getParentRoute: () => rootRoute,
} as never);

const LoginRouteFinal = LoginRoute.update({
  path: '/login',
  getParentRoute: () => rootRoute,
} as never);

const ShelvesIndexRouteFinal = ShelvesIndexRoute.update({
  path: '/shelves/',
  getParentRoute: () => rootRoute,
} as never);

const PricesIndexRouteFinal = PricesIndexRoute.update({
  path: '/prices/',
  getParentRoute: () => rootRoute,
} as never);

const PostersIndexRouteFinal = PostersIndexRoute.update({
  path: '/posters/',
  getParentRoute: () => rootRoute,
} as never);

const AdminIndexRouteFinal = AdminIndexRoute.update({
  path: '/admin/',
  getParentRoute: () => rootRoute,
} as never);

export const routeTree = rootRoute.addChildren([
  IndexRouteFinal,
  LoginRouteFinal,
  ShelvesIndexRouteFinal,
  PricesIndexRouteFinal,
  PostersIndexRouteFinal,
  AdminIndexRouteFinal,
]);
