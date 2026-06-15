import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { InfoPage } from '@/features/shelves/pages/InfoPage';

export const Route = createFileRoute('/shelves/scene/$scene/info')({
  component: () => (
    <ShelvesAppShell>
      <InfoPage />
    </ShelvesAppShell>
  ),
});
