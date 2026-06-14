import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { RecordsPage } from '@/features/shelves/pages/RecordsPage';

export const Route = createFileRoute('/shelves/scene/$scene/records')({
  component: () => (
    <ShelvesAppShell>
      <RecordsPage />
    </ShelvesAppShell>
  ),
});
