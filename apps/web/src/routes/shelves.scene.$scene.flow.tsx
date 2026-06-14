import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { FlowPage } from '@/features/shelves/pages/FlowPage';

export const Route = createFileRoute('/shelves/scene/$scene/flow')({
  component: () => (
    <ShelvesAppShell>
      <FlowPage />
    </ShelvesAppShell>
  ),
});
