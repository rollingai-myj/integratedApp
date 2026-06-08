/**
 * 根路由 (`__root.tsx`)
 *
 * - 应用全局壳：HTML 文档、字体、全局样式
 * - 应用全局 Provider：React Query
 * - <Outlet /> 渲染子路由
 */
import { createRootRoute, Outlet, Scripts } from '@tanstack/react-router';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import '../styles.css';

const STORE_PICKER_PATH = '/';

/**
 * 全局错误拦截：业务接口在 session 没选门店时会返 409 NO_STORE_SELECTED。
 * 拦到就跳门户首页，由门店选择器接管（详见 spec § 0.5）。
 */
function handleGlobalError(err: unknown): void {
  if (
    typeof window !== 'undefined' &&
    err instanceof ApiError &&
    err.code === 'NO_STORE_SELECTED' &&
    window.location.pathname !== STORE_PICKER_PATH
  ) {
    window.location.assign(STORE_PICKER_PATH);
  }
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '门店助手 · 美宜佳' },
      {
        name: 'description',
        content: '美宜佳门店助手统一应用：货盘选品、价盘管理、活动海报。',
      },
    ],
    links: [{ rel: 'icon', href: '/favicon.ico' }],
  }),
  component: RootComponent,
});

function RootComponent() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
        queryCache: new QueryCache({ onError: handleGlobalError }),
        mutationCache: new MutationCache({ onError: handleGlobalError }),
      }),
  );

  return (
    <RootDocument>
      <QueryClientProvider client={qc}>
        <Outlet />
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head />
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
