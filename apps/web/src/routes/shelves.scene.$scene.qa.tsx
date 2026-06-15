import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/features/shelves/AppShell';
import { QAPage } from '@/features/shelves/pages/QAPage';

export const Route = createFileRoute('/shelves/scene/$scene/qa')({
  component: () => (
    <ShelvesAppShell>
      <QAPage />
    </ShelvesAppShell>
  ),
});
