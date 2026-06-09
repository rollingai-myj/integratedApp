/**
 * React Query hooks for M2/M3/M4
 *
 * 业务接口的 storeId 已经从 session 取（spec § 0 / D13），所以 hook 内部
 * 不会再把 storeId 拼进 URL/Body。但 hook 入参仍保留 storeId，用途有二：
 *   - 放进 queryKey：切店后 key 变化，自动 refetch；
 *   - 作 `enabled` 闸门：没选门店时不发请求。
 * 这样路由层完全无感，所有"按门店取"的语义还在前端，只是不再下传到后端。
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
  PosterGenerateResponse,
  SubmitPriceChangeRequest,
  SubmitPriceChangeResponse,
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
    queryFn: () => masterApi.listSkus(params),
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
    queryFn: () => shelvesApi.listConfigs(),
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
    queryFn: () => scenesApi.adjustmentCounts(),
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
    queryFn: () => pricesApi.curve({ skuCodes, daysBack }),
    enabled: !!storeId && skuCodes.length > 0,
    staleTime: 60_000,
  });
}

export function useSubmitPriceChange() {
  const qc = useQueryClient();
  return useMutation<
    SubmitPriceChangeResponse,
    Error,
    SubmitPriceChangeRequest & { storeId?: string }
  >({
    mutationFn: ({ storeId: _ignored, ...body }) => pricesApi.adjust(body),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['master', 'skus', vars.storeId] });
      await qc.invalidateQueries({ queryKey: ['prices', 'curve', vars.storeId] });
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
  return useMutation<
    PosterGenerateResponse,
    Error,
    PosterGenerateRequest & { storeId?: string }
  >({
    mutationFn: ({ storeId: _ignored, ...body }) => postersApi.generate(body),
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
