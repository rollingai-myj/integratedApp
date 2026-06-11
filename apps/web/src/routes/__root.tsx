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
      {
        name: 'viewport',
        // 禁用浏览器级捏合缩放：我们整站用 IOSDevice 的 CSS zoom 把 390 设计稿等比放大撑满
        // 视口，用户再触发浏览器缩放会让 visualViewport.width 偏离屏宽，CSS zoom 跟着算错，
        // 表现是"页面坍缩到屏幕上半部分"。两套缩放不能共存。
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no',
      },
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

/**
 * 在 React 注水前先算好 IOSDevice 用的 zoom / 内层高度，写进 documentElement 的
 * CSS 变量。这样 SSR HTML 一旦被浏览器画出来就已经是正确比例，避免"刷新闪一下半屏"。
 * React 那边的 useEffect 仍然存在，负责响应 resize / URL bar 折叠后实时更新。
 */
const IOS_DEVICE_BOOTSTRAP = `(function(){try{
var vv=window.visualViewport;
var w=(vv&&vv.width)||window.innerWidth;
var h=(vv&&vv.height)||window.innerHeight;
var z=w/390;
var de=document.documentElement;
de.style.setProperty('--iod-zoom',String(z));
de.style.setProperty('--iod-h',(h/z)+'px');
}catch(e){}})();`;

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* charset 和 viewport 必须直接写进 SSR HTML：head() 里的 meta 是
           TanStack Router 客户端注水后才写进 DOM 的，那段窗口里浏览器还按默认
           viewport（允许捏合缩放）渲染，用户可能在首帧把页面缩坏。 */}
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no"
        />
        <link rel="stylesheet" href={stylesCssUrl} />
        <script dangerouslySetInnerHTML={{ __html: IOS_DEVICE_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
