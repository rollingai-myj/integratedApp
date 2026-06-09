/**
 * /shelves/position/$code/info —— 基础信息编辑（环境/问答/货架组）
 * 原 repo: src/pages/v2/InfoPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import InfoPage from '@/components/shelves/pages/InfoPage';

export const Route = createFileRoute('/shelves/position/$code/info')({
  component: () => (
    <ShelvesAppShell>
      <InfoPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '基础信息 · 选品助手' }] }),
});
