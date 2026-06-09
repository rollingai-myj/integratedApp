/**
 * /shelves/position —— 场景列表（货架位 + 调改次数）
 * 原 repo: src/pages/v2/PositionPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import PositionPage from '@/components/shelves/pages/PositionPage';

export const Route = createFileRoute('/shelves/position')({
  component: () => (
    <ShelvesAppShell>
      <PositionPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '选场景 · 选品助手' }] }),
});
