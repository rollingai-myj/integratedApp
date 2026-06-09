/**
 * /shelves/position/$code/last —— 上一次调改快照
 * 原 repo: src/pages/v2/LastRecordPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import LastRecordPage from '@/components/shelves/pages/LastRecordPage';

export const Route = createFileRoute('/shelves/position/$code/last')({
  component: () => (
    <ShelvesAppShell>
      <LastRecordPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '上一次调改 · 选品助手' }] }),
});
