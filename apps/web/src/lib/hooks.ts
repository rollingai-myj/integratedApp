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

/**
 * 调价流水（ops_store_price_change）—— "调价历史"的真实数据源。
 *
 * 不传 skuCode 拿门店全部记录（HistoryDialog 用）；传 skuCode 时拿单 sku 流水
 * （SkuDetailDialog 时间线用）。同日多次调价每次都是独立行，自然支持
 * 8→9→10 这种连续调价的完整展示。
 */
export function usePriceChanges(
  storeId: string | null | undefined,
  params?: { skuCode?: string; limit?: number },
) {
  return useQuery({
    queryKey: ['prices', 'changes', storeId, params?.skuCode ?? '', params?.limit ?? 200] as const,
    queryFn: () => pricesApi.changes(params),
    enabled: !!storeId,
    staleTime: 30_000,
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
      await qc.invalidateQueries({ queryKey: ['prices', 'changes', vars.storeId] });
    },
  });
}

/**
 * 价盘 · AI 批量诊断
 *
 * 调统一后端 /prices/diagnose（密钥保护、配额、审计都在后端）。
 * 入参是想诊断的 SKU 列表（每个含价格 / 销量 / 毛利率），返回每个 SKU 的建议。
 * 没用 useQuery 是因为这个调用是用户显式触发（点"刷新 AI 建议"按钮），不是
 * 数据维度的 query。返回 mutation，调用方用 `mutateAsync` 拿结果即可。
 */
export function useDiagnoseSkus() {
  return useMutation({
    mutationFn: (
      skus: Array<{
        skuCode: string;
        currentPrice: number;
        wholesalePrice?: number;
        salesQty30d?: number;
        grossMargin30d?: number;
      }>,
    ) => pricesApi.diagnose(skus),
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
