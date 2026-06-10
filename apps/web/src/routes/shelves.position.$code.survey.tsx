/**
 * /shelves/position/$code/survey —— 货架组配置 + 调研问卷
 * 原 repo: src/pages/v2/SurveyPage.tsx
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import SurveyPage from '@/components/shelves/pages/SurveyPage';

export const Route = createFileRoute('/shelves/position/$code/survey')({
  component: () => (
    <ShelvesAppShell>
      <SurveyPage />
    </ShelvesAppShell>
  ),
  head: () => ({ meta: [{ title: '调研问卷 · 选品助手' }] }),
});
