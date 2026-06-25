/**
 * React Query hooks（精简版）
 *
 * 历史背景：整合 monorepo 前从老 app 搬来 22 个 hook，覆盖主数据 / 货架 /
 * 价盘 / 海报 / 促销。整合后:
 *   - 海报 / 收藏 / 任务队列 改走 lib/poster*.functions.ts（TanStack Start server functions）
 *   - 货架 / 场景调改 改走 features/shelves/api.ts 本地 API 层
 *   - 促销改走 lib/promotions.functions.ts + PromotionContext
 *   - 门店列表改用 session（lib/auth.ts useMe 直接返回 me.stores）
 *   - V027 价盘 app 改成模拟器，调价相关接口（adjust / changes）整体砍掉
 *
 * 剩下这 3 个 hook 是唯一还跨整个 web 端被用的 TanStack Query 入口。
 */
import { useQuery } from '@tanstack/react-query';
import { masterApi, pricesApi, scenesApi } from './api-client.js';

export function useStoreSkus(
  storeId: string | null | undefined,
  params?: { scene?: number; q?: string },
) {
  return useQuery({
    queryKey: ['master', 'skus', storeId, params?.scene ?? -1, params?.q ?? ''] as const,
    queryFn: () => masterApi.listSkus(params),
    enabled: !!storeId,
    staleTime: 30_000,
  });
}

export function useScenes() {
  return useQuery({
    queryKey: ['scenes', 'list'] as const,
    queryFn: () => scenesApi.list(),
    staleTime: 10 * 60_000,
  });
}

export function usePriceCurve(
  storeId: string | null | undefined,
  skuCodes: string[],
  daysBack = 90,
) {
  return useQuery({
    queryKey: ['prices', 'curve', storeId, skuCodes.join(','), daysBack] as const,
    queryFn: () => pricesApi.curve({ skuCodes, daysBack }),
    enabled: !!storeId && skuCodes.length > 0,
    staleTime: 60_000,
  });
}
