/**
 * 选品助手入口（/shelves）
 *
 * 旧 M5-PR1 的三 tab 占位页（场景/货架/SKU）已下线，整个 /shelves 子树切换到
 * 1:1 移植 rollingai-myj/skuSelection v2 流程：
 *   /shelves                       → HomePage（欢迎 + "开始调改"）
 *   /shelves/position              → PositionPage（场景列表 + 调改次数）
 *   /shelves/position/$code/...    → SurveyPage / SceneIndexPage / PhotoPage / ...
 *
 * shelves.* 路由都用 ShelvesAppShell 包一层：登录/选店校验 + 注入 selectedStore + 预拉 SKU。
 */
import { createFileRoute } from '@tanstack/react-router';
import { ShelvesAppShell } from '@/components/shelves/AppShell';
import HomePage from '@/components/shelves/pages/HomePage';

export const Route = createFileRoute('/shelves/')({
  component: ShelvesIndexPage,
  head: () => ({
    meta: [
      { title: '选品助手 · 美宜佳' },
      { name: 'description', content: 'AI 货架诊断 + 选品 + 虚拟货架生成' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' },
    ],
  }),
});

function ShelvesIndexPage() {
  return (
    <ShelvesAppShell allowNoStore>
      <HomePage />
    </ShelvesAppShell>
  );
}
