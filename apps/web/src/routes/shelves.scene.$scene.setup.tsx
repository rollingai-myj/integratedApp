import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { SetupPage } from '@/features/shelves/pages/SetupPage';

export const Route = createFileRoute('/shelves/scene/$scene/setup')({
  component: () => (
    <ShelvesAppShell>
      <SetupPage />
    </ShelvesAppShell>
  ),
});
