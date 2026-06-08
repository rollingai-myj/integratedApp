/**
 * 客户端 Router 入口
 *
 * 约定：导出名必须为 `getRouter`（TanStack Start 1.167+ 的固定要求）。
 * 路由树由 `@tanstack/router-plugin` 从 src/routes/ 自动生成到 routeTree.gen.ts。
 *
 * 不要手动编辑 routeTree.gen.ts。
 */
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.js';

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}
