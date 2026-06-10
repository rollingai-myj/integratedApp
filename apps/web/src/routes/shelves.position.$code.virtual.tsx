/**
 * /shelves/position/$code/virtual —— 虚拟货架历史
 * 原 repo: src/pages/v2/VirtualPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import VirtualPage from '@/components/shelves/pages/VirtualPage';

export const Route = createFileRoute('/shelves/position/$code/virtual')({
  component: () => (
    <ShelvesAppShell>
      <VirtualPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '虚拟货架 · 选品助手' }] }),
});
