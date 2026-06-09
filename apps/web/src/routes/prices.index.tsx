/**
 * 价盘 · 品类选择落地页（来自原 priceChange repo /）
 *
 * 1:1 还原原 repo `src/routes/index.tsx`：11 个 emoji 卡片，仅"冷藏"启用。
 * 适配：右上角加了一个"返回门户"小入口，方便从统一应用回到 home。
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { IOSDevice } from '@/components/IOSDevice';
import { BrandHeader } from '@/components/prices/BrandHeader';
import { useMe } from '@/lib/auth';
import { useStoreSkus } from '@/lib/hooks';

export const Route = createFileRoute('/prices/')({
  component: PricesHomePage,
  head: () => ({
    meta: [
      { title: '美宜佳价盘调整助手 · 品类选择' },
      { name: 'description', content: '美宜佳便利店运营人员的单品类价格调整决策工具' },
    ],
  }),
});

const CATEGORIES = [
  { key: 'cold', emoji: '❄️', name: '冷藏', enabled: true, to: '/prices/cold' as const },
  { key: 'candy', emoji: '🍬', name: '糖巧' },
  { key: 'bread', emoji: '🍞', name: '面包架' },
  { key: 'small_snack', emoji: '🍿', name: '小零食' },
  { key: 'big_leisure', emoji: '🎯', name: '大休闲' },
  { key: 'biscuit', emoji: '🍪', name: '饼干膨化' },
  { key: 'instant', emoji: '🍜', name: '方便食品' },
  { key: 'grain_oil', emoji: '🍚', name: '粮油调味' },
  { key: 'wine', emoji: '🍷', name: '酒' },
  { key: 'toy', emoji: '🧸', name: '玩具' },
  { key: 'daily', emoji: '🧴', name: '日化家杂' },
];

function PricesHomePage() {
  const meQuery = useMe();
  const storeId = meQuery.data?.currentStore?.id ?? null;
  // 仅用于展示"x 个商品"角标；不阻塞渲染
  const skusQuery = useStoreSkus(storeId);
  const skuCount = skusQuery.data?.skus?.length ?? 0;

  return (
    <IOSDevice>
    <div className="min-h-screen bg-background">
      <BrandHeader />
      <main className="px-4 py-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-foreground">请选择品类</h1>
          <Link
            to="/"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            返回门户
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">进入价格诊断与调整工作台</p>

        <TooltipProvider delayDuration={150}>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {CATEGORIES.map((c) => {
              if (c.enabled && c.to) {
                return (
                  <Link
                    key={c.key}
                    to={c.to}
                    className="group rounded-xl border bg-card p-4 shadow-sm transition active:scale-[0.98]"
                  >
                    <div className="text-3xl">{c.emoji}</div>
                    <div className="mt-3 text-base font-medium text-foreground">{c.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="num font-semibold text-brand">{skuCount || 73}</span> 个商品
                    </div>
                    <div className="mt-2 text-[11px] text-brand">进入 →</div>
                  </Link>
                );
              }
              return (
                <Tooltip key={c.key}>
                  <TooltipTrigger asChild>
                    <div
                      aria-disabled
                      className="cursor-not-allowed rounded-xl border bg-card p-4 opacity-40"
                    >
                      <div className="text-3xl">{c.emoji}</div>
                      <div className="mt-3 text-base font-medium text-foreground">{c.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">敬请期待</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>数据准备中</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </main>
    </div>
    </IOSDevice>
  );
}
