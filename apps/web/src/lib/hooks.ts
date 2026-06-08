/**
 * React Query hooks for M2/M3/M4
 *
 * 业务接口的 storeId 全部从 session 取（spec § 0 / D13），所以这里的 hook
 * 都不接受 storeId 参数。只有"非业务"的 query（如门店列表）才会显式带 store 维度。
 *
 * 切店成功后会失效所有业务 query —— 见 useSwitchStore 的 onSuccess。
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  masterApi,
  pricesApi,
  postersApi,
  promotionsApi,
  shelvesApi,
  scenesApi,
} from './api-client.js';
import type {
  PosterGenerateRequest,
  SubmitPriceChangeRequest,
} from '@myj/shared';

// ============================================================================
// 模块 3+4 主数据
// ============================================================================

export function useStores() {
  return useQuery({
    queryKey: ['master', 'stores'] as const,
    queryFn: () => masterApi.listStores(),
    staleTime: 5 * 60_000,
  });
}

export function useSkus(params?: { search?: string; categoryPath?: string }) {
  return useQuery({
    queryKey: ['skus', params?.search ?? '', params?.categoryPath ?? ''] as const,
    queryFn: () => masterApi.listSkus(params),
    staleTime: 30_000,
  });
}

// ============================================================================
// 模块 5 货架 / 场景
// ============================================================================

export function useShelfConfigs() {
  return useQuery({
    queryKey: ['shelves', 'config'] as const,
    queryFn: () => shelvesApi.listConfigs(),
    staleTime: 60_000,
  });
}

export function useScenes() {
  return useQuery({
    queryKey: ['scenes', 'list'] as const,
    queryFn: () => scenesApi.list(),
    staleTime: 10 * 60_000,
  });
}

export function useSceneAdjustmentCounts() {
  return useQuery({
    queryKey: ['scenes', 'counts'] as const,
    queryFn: () => scenesApi.adjustmentCounts(),
    staleTime: 30_000,
  });
}

// ============================================================================
// 模块 6 价盘
// ============================================================================

export function usePriceCurve(skuCodes: string[], daysBack = 90) {
  return useQuery({
    queryKey: ['prices', 'curve', skuCodes.join(','), daysBack] as const,
    queryFn: () => pricesApi.curve({ skuCodes, daysBack }),
    enabled: skuCodes.length > 0,
    staleTime: 60_000,
  });
}

export function useSubmitPriceChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitPriceChangeRequest) => pricesApi.adjust(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['skus'] });
      await qc.invalidateQueries({ queryKey: ['prices', 'curve'] });
    },
  });
}

// ============================================================================
// 模块 7 海报
// ============================================================================

export function usePosters(params?: {
  scope?: 'mine' | 'current' | 'all';
  storeId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: [
      'posters',
      'list',
      params?.scope ?? 'mine',
      params?.storeId ?? '',
      params?.limit ?? 50,
    ] as const,
    queryFn: () => postersApi.list(params),
    staleTime: 30_000,
  });
}

export function useGeneratePoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PosterGenerateRequest) => postersApi.generate(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posters', 'list'] });
    },
  });
}

// ============================================================================
// 模块 8 促销
// ============================================================================

export function useActivePromotions() {
  return useQuery({
    queryKey: ['promotions', 'active'] as const,
    queryFn: () => promotionsApi.active(),
    staleTime: 5 * 60_000,
  });
}

export function useRecommendedPromotions() {
  return useQuery({
    queryKey: ['promotions', 'recommend'] as const,
    queryFn: () => promotionsApi.recommend(),
    staleTime: 5 * 60_000,
  });
}
