/**
 * 根路由 (`__root.tsx`)
 *
 * - 应用全局壳：HTML 文档、字体、全局样式
 * - 应用全局 Provider：React Query
 * - 全局 <Toaster>（sonner）：所有模块的 toast()/toastSuccess() 调用都靠它渲染；
 *   早期只有 prices.cold 局部挂了一个，导致 shelves/posters 的 toast 全部"静默"，
 *   用户点保存看不到任何反馈，以为没生效。
 * - <Outlet /> 渲染子路由
 */
import { createRootRoute, Outlet, Scripts } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import '../styles.css';
import stylesCssUrl from '../styles.css?url';

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
    links: [
      { rel: 'icon', href: '/favicon.ico' },
      { rel: 'stylesheet', href: stylesCssUrl },
    ],
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
      }),
  );

  return (
    <RootDocument>
      <QueryClientProvider client={qc}>
        <Outlet />
        <Toaster position="top-center" richColors />
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href={stylesCssUrl} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
