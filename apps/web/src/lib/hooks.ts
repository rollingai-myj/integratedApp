/**
 * React Query hooks for M2/M3/M4
 *
 * 单文件聚合所有业务模块的 query/mutation，避免 12 个微 hook 文件。
 * 命名约定：useXxx 为 query，useXxxMutation 为写。
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

export function useStoreSkus(
  storeId: string | null | undefined,
  params?: { search?: string; categoryPath?: string },
) {
  return useQuery({
    queryKey: ['master', 'skus', storeId, params?.search ?? '', params?.categoryPath ?? ''] as const,
    queryFn: () => masterApi.listStoreSkus(storeId!, params),
    enabled: !!storeId,
    staleTime: 30_000,
  });
}

// ============================================================================
// 模块 5 货架 / 场景
// ============================================================================

export function useShelfConfigs(storeId: string | null | undefined) {
  return useQuery({
    queryKey: ['shelves', 'config', storeId] as const,
    queryFn: () => shelvesApi.listConfigs(storeId!),
    enabled: !!storeId,
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

export function useSceneAdjustmentCounts(storeId: string | null | undefined) {
  return useQuery({
    queryKey: ['scenes', 'counts', storeId] as const,
    queryFn: () => scenesApi.adjustmentCounts(storeId!),
    enabled: !!storeId,
    staleTime: 30_000,
  });
}

// ============================================================================
// 模块 6 价盘
// ============================================================================

export function usePriceCurve(
  storeId: string | null | undefined,
  skuCodes: string[],
  daysBack = 90,
) {
  return useQuery({
    queryKey: ['prices', 'curve', storeId, skuCodes.join(','), daysBack] as const,
    queryFn: () => pricesApi.curve(storeId!, { skuCodes, daysBack }),
    enabled: !!storeId && skuCodes.length > 0,
    staleTime: 60_000,
  });
}

export function useSubmitPriceChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitPriceChangeRequest) => pricesApi.adjust(body),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['master', 'skus', vars.storeId] });
      await qc.invalidateQueries({ queryKey: ['prices', 'curve', vars.storeId] });
    },
  });
}

// ============================================================================
// 模块 7 海报
// ============================================================================

export function usePosters(params?: { scope?: 'mine' | 'all'; storeId?: string; limit?: number }) {
  return useQuery({
    queryKey: ['posters', 'list', params?.scope ?? 'mine', params?.storeId ?? '', params?.limit ?? 50] as const,
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
