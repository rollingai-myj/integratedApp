/**
 * Layout route — 所有需要登录的页都通过这个 layout route 套 AppShell。
 * 文件名 `_app` 是 TanStack Router layout route 约定:无 URL 段,只提供 layout。
 */
import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';

export const Route = createFileRoute('/_app')({
  component: AppShell,
});
