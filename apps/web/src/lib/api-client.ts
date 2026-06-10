/**
 * 后端 API 客户端
 *
 * 所有对 /api/v1/* 的调用都从这里走，便于：
 *   - 统一加 cookie 凭证
 *   - 统一错误格式解析
 *   - 统一请求 ID 透传
 *
 * 接口字段定义复用 @myj/shared 作为前后端契约的 single source of truth。
 */
import type {
  ApiErrorBody,
  FeishuAuthorizeResponse,
  FeishuExchangeRequest,
  FeishuJsapiConfigResponse,
  HealthResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PortalModulesResponse,
  PortalStoresResponse,
  SwitchStoreRequest,
  SwitchStoreResponse,
  // M2/M3/M4
  ListStoresResponse,
  ListStoreSkusResponse,
  PriceCurveResponse,
  ListPriceChangesResponse,
  SubmitPriceChangeRequest,
  SubmitPriceChangeResponse,
  DiagnoseBatchResponse,
  DiagnoseSkuResult,
  PosterGenerateRequest,
  PosterGenerateResponse,
  PosterListResponse,
  ActivePromotionsResponse,
  RecommendPromotionsResponse,
  ListShelfConfigsResponse,
  ListScenesResponse,
  ListSceneAdjustmentCountsResponse,
} from '@myj/shared';

const BASE_URL = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // 204 No Content 没有 body，直接返回 undefined（调用方自己 cast）
  if (res.status === 204) return undefined as unknown as T;

  if (!res.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await res.json()) as ApiErrorBody;
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ApiError(
      res.status,
      errBody?.error?.code ?? 'UNKNOWN',
      errBody?.error?.message ?? `HTTP ${res.status}`,
      errBody?.error?.details,
      errBody?.requestId,
    );
  }

  return (await res.json()) as T;
}

// ============================================================================
// 模块 1 · 认证
// ============================================================================

export const authApi = {
  /** 当前登录用户 */
  me: () => request<MeResponse>('/auth/me'),

  /** 账密兜底登录 */
  login: (body: LoginRequest) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body }),

  /** 退出登录（204） */
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  /** 飞书 OAuth：拿跳转 URL（后端顺便种 state cookie） */
  feishuAuthorize: (redirectUri?: string) => {
    const qs = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return request<FeishuAuthorizeResponse>(`/auth/feishu/authorize${qs}`);
  },

  /** 飞书 OAuth：code → session */
  feishuExchange: (body: FeishuExchangeRequest) =>
    request<LoginResponse>('/auth/feishu/exchange', { method: 'POST', body }),

  /** 飞书 H5 SDK 签名 */
  feishuJsapiConfig: (url: string) =>
    request<FeishuJsapiConfigResponse>(
      `/auth/feishu/jsapi-config?url=${encodeURIComponent(url)}`,
    ),
};

// ============================================================================
// 模块 2 · 门户
// ============================================================================

export const portalApi = {
  modules: () => request<PortalModulesResponse>('/portal/modules'),
  stores: () => request<PortalStoresResponse>('/portal/stores'),
  switchStore: (body: SwitchStoreRequest) =>
    request<SwitchStoreResponse>('/portal/active-store', {
      method: 'POST',
      body,
    }),
};

// ============================================================================
// 模块 3+4 · 主数据
// ============================================================================

export const masterApi = {
  /** 当前用户可见门店（超管全部） */
  listStores: () => request<ListStoresResponse>('/master/stores'),

  /** 当前 session 门店的在册 SKU（含售价 + 销量快照） */
  listSkus: (params?: { search?: string; categoryPath?: string }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.categoryPath) qs.set('categoryPath', params.categoryPath);
    const q = qs.toString();
    return request<ListStoreSkusResponse>(`/skus${q ? `?${q}` : ''}`);
  },
};

// ============================================================================
// 模块 5 · 货架 / 场景
// ============================================================================

export const shelvesApi = {
  /** 当前 session 门店的货架配置 */
  listConfigs: () => request<ListShelfConfigsResponse>('/shelves/config'),
};

export const scenesApi = {
  /** 全部场景定义（货架位 + 品类） */
  list: () => request<ListScenesResponse>('/scenes'),

  /** 当前 session 门店各场景的调改次数 */
  adjustmentCounts: () =>
    request<ListSceneAdjustmentCountsResponse>('/scenes/adjustments-count'),
};

// ============================================================================
// 模块 6 · 价盘
// ============================================================================

export const pricesApi = {
  /** 价格曲线（按 SKU 时间序列）— 当前 session 门店 */
  curve: (params?: { skuCodes?: string[]; daysBack?: number }) => {
    const qs = new URLSearchParams();
    if (params?.skuCodes?.length) qs.set('skuCodes', params.skuCodes.join(','));
    if (params?.daysBack) qs.set('daysBack', String(params.daysBack));
    const q = qs.toString();
    return request<PriceCurveResponse>(`/prices/curve${q ? `?${q}` : ''}`);
  },

  /** 提交一次调价（D3：写流水 + 同时插一行 snapshot）— 当前 session 门店 */
  adjust: (body: SubmitPriceChangeRequest) =>
    request<SubmitPriceChangeResponse>('/prices/adjust', { method: 'POST', body }),

  /**
   * 调价流水记录（ops_store_price_change）— 当前 session 门店
   * 同一 sku 同一天可多条，按 createdAt DESC 返回。是"调价历史"的真实数据源
   * （早期版本从 fact 表 periods 反推会因 ON CONFLICT 覆盖丢失同日多次记录）
   */
  changes: (params?: { skuCode?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<ListPriceChangesResponse>(`/prices/changes${q ? `?${q}` : ''}`);
  },

  /** 批量 AI 诊断（走 Dify）— 当前 session 门店 */
  diagnose: (
    skus: Array<{
      skuCode: string;
      currentPrice: number;
      wholesalePrice?: number;
      salesQty30d?: number;
      grossMargin30d?: number;
      competitorPrices?: Array<{ channel: string; price: number }>;
    }>,
  ) =>
    request<DiagnoseBatchResponse>('/prices/diagnose', {
      method: 'POST',
      body: { skus },
    }),
};

export type { DiagnoseSkuResult };

// ============================================================================
// 模块 7 · 海报
// ============================================================================

export const postersApi = {
  /** 单张同步生成（PO-C1） */
  generate: (body: PosterGenerateRequest) =>
    request<PosterGenerateResponse>('/posters/generate', { method: 'POST', body }),

  /**
   * 海报历史：
   * - scope=mine（默认）我跨店生成的全部
   * - scope=current  我在当前 session 门店生成的（需要已选门店）
   * - scope=all      仅超管，全部海报（可附 storeId 过滤）
   */
  list: (params?: {
    scope?: 'mine' | 'current' | 'all';
    storeId?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.scope) qs.set('scope', params.scope);
    if (params?.storeId) qs.set('storeId', params.storeId);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<PosterListResponse>(`/posters${q ? `?${q}` : ''}`);
  },
};

// ============================================================================
// 模块 8 · 促销
// ============================================================================

export const promotionsApi = {
  /** 当前生效的促销批次（含 products + groups） */
  active: () => request<ActivePromotionsResponse>('/promotions/active'),

  /** 个性化推荐（按用户近 30 天海报品类重排） */
  recommend: () => request<RecommendPromotionsResponse>('/promotions/recommend'),
};

// ============================================================================
// 健康检查
// ============================================================================

export const healthApi = {
  check: () => request<HealthResponse>('/health'),
};
