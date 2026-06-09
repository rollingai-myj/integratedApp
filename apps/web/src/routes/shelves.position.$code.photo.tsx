/**
 * /shelves/position/$code/photo —— 拍照诊断 + 一键应用 + 虚拟货架
 * 原 repo: src/pages/v2/PhotoPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import PhotoPage from '@/components/shelves/pages/PhotoPage';

export const Route = createFileRoute('/shelves/position/$code/photo')({
  component: () => (
    <ShelvesAppShell>
      <PhotoPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '拍照诊断 · 选品助手' }] }),
});
