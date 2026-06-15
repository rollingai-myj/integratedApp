import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { HomePage } from '@/features/shelves/pages/HomePage';

export const Route = createFileRoute('/shelves/')({
  component: () => (
    <ShelvesAppShell>
      <HomePage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '选品助手 · 美宜佳' }] }),
});
