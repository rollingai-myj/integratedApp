import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { LastPage } from '@/features/shelves/pages/LastPage';

export const Route = createFileRoute('/shelves/scene/$scene/last')({
  component: () => (
    <ShelvesAppShell>
      <LastPage />
    </ShelvesAppShell>
  ),
});
