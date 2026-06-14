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
  uploadPosterAsset,
} from './api-client.js';
import type {
  CreatePosterTasksRequest,
  CreatePosterTasksResponse,
  AdoptPosterGenerationResponse,
  PosterDownloadResponse,
  PosterAssetUploadResponse,
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
  params?: { scene?: number; q?: string },
) {
  return useQuery({
    queryKey: ['master', 'skus', storeId, params?.scene ?? -1, params?.q ?? ''] as const,
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

// ============================================================================
// 模块 7 海报
// ============================================================================

// ---- 任务 / 生成分离模型 hooks ---------------------------------------------

export function usePosterTasks(params?: {
  scope?: 'mine' | 'current' | 'all';
  status?: 'active' | 'done' | 'failed';
  batchId?: string;
  storeId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: [
      'posters',
      'tasks',
      params?.scope ?? 'mine',
      params?.status ?? 'all',
      params?.batchId ?? '',
      params?.storeId ?? '',
      params?.limit ?? 100,
    ] as const,
    queryFn: () => postersApi.listTasks(params),
    staleTime: 30_000,
  });
}

export function usePosterTaskDetail(taskId: string | null | undefined) {
  return useQuery({
    queryKey: ['posters', 'task', taskId] as const,
    queryFn: () => postersApi.getTask(taskId!),
    enabled: !!taskId,
    staleTime: 30_000,
  });
}

export function useCreatePosterTasks() {
  const qc = useQueryClient();
  return useMutation<CreatePosterTasksResponse, Error, CreatePosterTasksRequest>({
    mutationFn: (body) => postersApi.createTasks(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posters', 'tasks'] });
      await qc.invalidateQueries({ queryKey: ['posters', 'today-count'] });
    },
  });
}

export function useCancelPosterBatch() {
  const qc = useQueryClient();
  return useMutation<{ canceled: number }, Error, string>({
    mutationFn: (batchId) => postersApi.cancelBatch(batchId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posters', 'tasks'] });
    },
  });
}

export function useRegeneratePosterTask() {
  const qc = useQueryClient();
  return useMutation<{ generation: import('@myj/shared').PosterGeneration }, Error, string>({
    mutationFn: (taskId) => postersApi.regenerate(taskId),
    onSuccess: async (_d, taskId) => {
      await qc.invalidateQueries({ queryKey: ['posters', 'tasks'] });
      await qc.invalidateQueries({ queryKey: ['posters', 'task', taskId] });
    },
  });
}

export function useAdoptPoster() {
  const qc = useQueryClient();
  return useMutation<AdoptPosterGenerationResponse, Error, string>({
    mutationFn: (generationId) => postersApi.adopt(generationId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posters'] });
    },
  });
}

export function useDownloadPoster() {
  return useMutation<PosterDownloadResponse, Error, string>({
    mutationFn: (generationId) => postersApi.download(generationId),
  });
}

export function usePosterGallery(params?: {
  scope?: 'mine' | 'current' | 'all';
  adopted?: boolean;
  storeId?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: [
      'posters',
      'gallery',
      params?.scope ?? 'mine',
      params?.adopted ?? null,
      params?.storeId ?? '',
      params?.limit ?? 30,
    ] as const,
    queryFn: () => postersApi.gallery(params),
    staleTime: 30_000,
  });
}

export function usePosterTodayCount() {
  return useQuery({
    queryKey: ['posters', 'today-count'] as const,
    queryFn: () => postersApi.todayCount(),
    staleTime: 60_000,
  });
}

export function usePosterAssets(kind?: 'background' | 'product_photo') {
  return useQuery({
    queryKey: ['posters', 'assets', kind ?? 'all'] as const,
    queryFn: () => postersApi.listAssets(kind),
    staleTime: 60_000,
  });
}

export function useUploadPosterAsset() {
  const qc = useQueryClient();
  return useMutation<
    PosterAssetUploadResponse,
    Error,
    { kind: 'background' | 'product_photo'; file: File | Blob; filename?: string }
  >({
    mutationFn: (args) => uploadPosterAsset(args),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posters', 'assets'] });
    },
  });
}

export function useDeletePosterAsset() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (assetId) => postersApi.deleteAsset(assetId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['posters', 'assets'] });
    },
  });
}

export function usePosterSalesTracking(days?: number) {
  return useQuery({
    queryKey: ['posters', 'sales-tracking', days ?? 30] as const,
    queryFn: () => postersApi.salesTracking({ days }),
    staleTime: 5 * 60_000,
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
