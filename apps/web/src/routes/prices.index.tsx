/**
 * 价盘 · 场景选择落地页
 *
 * 场景列表从 /api/v1/scenes 读，与选品同源——运维只要在 hq_categories（场景
 * 顶层 level=0 + 子类目）改一处，两个模块自动同步。emoji 派生走 lib/scenes.ts
 * 的 emojiForScene。
 *
 * 是否可点 = 该场景在本店 store_sku_snapshots 是否有数据(perSceneQueries 直接拿
 * count)。count > 0 → 可点链到 /prices/cold;count = 0 → 灰显"暂无数据"。
 * `/prices/cold` 一个组件吃所有场景,靠 ?scene= 区分(缺省 = 冷藏,向下兼容旧 URL)。
 *
 * 适配：右上角 ⌂ 主页键回门户(BrandHeader 内置,不传 upTo 时入口无 ← 返回键),
 * 与子页面「左 ← 返回 + 右 ⌂ 主页」交互一致。
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { IOSDevice } from '@/components/IOSDevice';
import { BrandHeader } from '@/components/prices/BrandHeader';
import { useMe } from '@/lib/auth';
import { useScenes } from '@/lib/hooks';
import { masterApi } from '@/lib/api-client';
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

function PricesHomePage() {
  const meQuery = useMe();
  const storeId = meQuery.data?.currentStore?.id ?? null;

  const scenesQuery = useScenes();
  const scenes = scenesQuery.data?.scenes ?? [];

  // 每个场景的 SKU 条数 —— 旧实现是用 useStoreSkus(storeId) 全量拉一遍把同一个 total 显示
  // 在每张卡上,所有场景看上去 SKU 数都一样。改成对每个场景独立拉 /store/skus?scene=X,
  // useQueries 同时发起、各自缓存。复用跟 useStoreSkus 一致的 queryKey,跟其他页面(如选品
  // SkuListPanel)的相同请求共享缓存,不会重复发请求。
  const perSceneQueries = useQueries({
    queries: scenes.map((s) => ({
      queryKey: ['master', 'skus', storeId, s.scene, ''] as const,
      queryFn: () => masterApi.listSkus({ scene: s.scene }),
      enabled: !!storeId,
      staleTime: 30_000,
    })),
  });
  const countByScene = new Map<number, number | null>();
  scenes.forEach((s, i) => {
    const q = perSceneQueries[i];
    countByScene.set(s.scene, q?.data ? q.data.skus.length : null);
  });

  // 可选(有数据)的场景置顶,组内保持原顺序。JS sort 稳定 —— 加载阶段全部 hasData=false,
  // 排序不打乱原顺序;各 query 陆续返回后,有数据的场景才被浮到顶。
  const sortedScenes = scenes.slice().sort((a, b) => {
    const ea = (countByScene.get(a.scene) ?? 0) > 0 ? 1 : 0;
    const eb = (countByScene.get(b.scene) ?? 0) > 0 ? 1 : 0;
    return eb - ea;
  });

  return (
    <IOSDevice>
    {/* min-h-full（而非 min-h-screen）：IOSDevice 内层 overflow-y-auto 高度 =
        (100/zoom)vh，若用 100vh 会留出 (100/zoom-100)vh 的空白可滚区。 */}
    <div className="min-h-full bg-background">
      <BrandHeader />
      <main className="px-4 py-5 pb-8">

        <h1 className="text-lg font-semibold text-foreground">请选择场景</h1>

        {scenesQuery.isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载场景…
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3">
            {sortedScenes.map((s) => {
              const key = `${s.scene}-${s.name}`;
              const emoji = emojiForScene(s.name);
              const count = countByScene.get(s.scene);
              const loading = !storeId || count === null || count === undefined;
              const hasData = !loading && (count ?? 0) > 0;
              if (hasData) {
                // 冷藏走默认 URL(向下兼容);其他场景带 ?scene= 走同一个 cold 页组件
                const searchParam = s.name === '冷藏' ? {} : { scene: s.name };
                return (
                  <Link
                    key={key}
                    to="/prices/cold"
                    search={searchParam}
                    className="group rounded-xl border bg-card p-4 shadow-sm transition active:scale-[0.98]"
                  >
                    <div className="text-3xl">{emoji}</div>
                    <div className="mt-3 text-base font-medium text-foreground">{s.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="num font-semibold text-brand">{count}</span> 个商品
                    </div>
                    <div className="mt-2 text-[11px] text-brand">进入 →</div>
                  </Link>
                );
              }
              return (
                <div
                  key={key}
                  aria-disabled
                  className="cursor-not-allowed rounded-xl border bg-card p-4 opacity-40"
                >
                  <div className="text-3xl">{emoji}</div>
                  <div className="mt-3 text-base font-medium text-foreground">{s.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {loading ? '加载中…' : '暂无数据'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
    </IOSDevice>
  );
}
