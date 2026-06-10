/**
 * /shelves/position/$code/record —— 调改效果追踪
 * 原 repo: src/pages/v2/RecordPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import RecordPage from '@/components/shelves/pages/RecordPage';

export const Route = createFileRoute('/shelves/position/$code/record')({
  component: () => (
    <ShelvesAppShell>
      <RecordPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '调改记录 · 选品助手' }] }),
});
