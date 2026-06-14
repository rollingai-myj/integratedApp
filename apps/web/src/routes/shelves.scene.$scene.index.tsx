import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { WorkspacePage } from '@/features/shelves/pages/WorkspacePage';

export const Route = createFileRoute('/shelves/scene/$scene/')({
  component: () => (
    <ShelvesAppShell>
      <WorkspacePage />
    </ShelvesAppShell>
  ),
});
