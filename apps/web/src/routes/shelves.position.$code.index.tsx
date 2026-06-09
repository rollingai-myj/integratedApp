/**
 * /shelves/position/$code/index —— 场景调改入口 hub
 * 原 repo: src/pages/v2/SceneIndexPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import SceneIndexPage from '@/components/shelves/pages/SceneIndexPage';

export const Route = createFileRoute('/shelves/position/$code/')({
  component: () => (
    <ShelvesAppShell>
      <SceneIndexPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '调改入口 · 选品助手' }] }),
});
