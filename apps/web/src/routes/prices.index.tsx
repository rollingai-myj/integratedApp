/**
 * 价盘 · 场景选择落地页
 *
 * 场景列表从 /api/v1/scenes 读，与选品 PositionPage 同源——这样运维只要改
 * plan_position_mapping 一处，两个模块自动同步。emoji 派生走 lib/scenes.ts
 * 的 emojiForScene。
 *
 * 当前只有 "冷藏" 场景接入了真实价盘数据 → 链到 /prices/cold；其它场景灰显，
 * Tooltip "数据准备中"。后续接入新场景时把 ENABLED_LINKS 加一行即可。
 *
 * 适配：左上角 ← 箭头返回门户（BrandHeader backTo="/"），与子页面"返回上一级"
 * 同款交互。
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { IOSDevice } from '@/components/IOSDevice';
import { BrandHeader } from '@/components/prices/BrandHeader';
import { useMe } from '@/lib/auth';
import { useScenes, useStoreSkus } from '@/lib/hooks';
import { emojiForScene } from '@/lib/scenes';

export const Route = createFileRoute('/prices/')({
  component: PricesHomePage,
  head: () => ({
    meta: [
      { title: '美宜佳价盘调整助手 · 品类选择' },
      { name: 'description', content: '美宜佳便利店运营人员的单品类价格调整决策工具' },
    ],
  }),
});

/** position_name → 已接入的子路由路径；不在表里的场景灰显 */
const ENABLED_LINKS: Record<string, '/prices/cold'> = {
  '冷藏': '/prices/cold',
};

function PricesHomePage() {
  const meQuery = useMe();
  const storeId = meQuery.data?.currentStore?.id ?? null;
  // 仅用于展示"x 个商品"角标；不阻塞渲染
  const skusQuery = useStoreSkus(storeId);
  const skuCount = skusQuery.data?.skus?.length ?? 0;

  const scenesQuery = useScenes();
  const scenes = scenesQuery.data?.scenes ?? [];

  return (
    <IOSDevice>
    {/* min-h-full（而非 min-h-screen）：IOSDevice 内层 overflow-y-auto 高度 =
        (100/zoom)vh，若用 100vh 会留出 (100/zoom-100)vh 的空白可滚区。 */}
    <div className="min-h-full bg-background">
      <BrandHeader backTo="/" />
      <main className="px-4 py-5 pb-8">
        <h1 className="text-lg font-semibold text-foreground">请选择场景</h1>

        {scenesQuery.isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载场景…
          </div>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {scenes.map((s) => {
                const key = `${s.positionCode}-${s.positionName}`;
                const to = ENABLED_LINKS[s.positionName];
                const emoji = emojiForScene(s.positionName);
                if (to) {
                  return (
                    <Link
                      key={key}
                      to={to}
                      className="group rounded-xl border bg-card p-4 shadow-sm transition active:scale-[0.98]"
                    >
                      <div className="text-3xl">{emoji}</div>
                      <div className="mt-3 text-base font-medium text-foreground">{s.positionName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="num font-semibold text-brand">{skuCount || 73}</span> 个商品
                      </div>
                      <div className="mt-2 text-[11px] text-brand">进入 →</div>
                    </Link>
                  );
                }
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <div
                        aria-disabled
                        className="cursor-not-allowed rounded-xl border bg-card p-4 opacity-40"
                      >
                        <div className="text-3xl">{emoji}</div>
                        <div className="mt-3 text-base font-medium text-foreground">{s.positionName}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">敬请期待</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>数据准备中</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </main>
    </div>
    </IOSDevice>
  );
}
