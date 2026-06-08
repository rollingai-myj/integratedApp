/**
 * 客户端 Router 入口
 *
 * 路由树由 `@tanstack/router-plugin` 从 src/routes/ 自动生成到 routeTree.gen.ts。
 * **不要**手动编辑 routeTree.gen.ts。
 */
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.js';

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
