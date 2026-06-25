/**
 * 后端 API 客户端（精简版）
 *
 * 历史背景：整合前是 7 个完整 API 对象（auth / portal / master / shelves /
 * scenes / prices / posters / promotions），整合后大量业务改走 TanStack Start
 * server functions（lib/*.functions.ts）或 features/shelves/api.ts 本地 API，
 * 这里只剩下 web 端真正还在直接调的方法。被砍的清单见 lib/hooks.ts 顶部注释。
 *
 * 接口字段定义复用 @myj/shared 作为前后端契约的 single source of truth。
 */
import type {
  ApiErrorBody,
  FeishuAuthorizeResponse,
  FeishuExchangeRequest,
  FeishuJsapiConfigResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  PortalModulesResponse,
  PortalStoresResponse,
  SwitchStoreRequest,
  SwitchStoreResponse,
  ListStoreSkusResponse,
  PriceCurveResponse,
  ListScenesResponse,
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
  me: () => request<MeResponse>('/auth/me'),

  login: (body: LoginRequest) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  feishuAuthorize: (redirectUri?: string) => {
    const qs = redirectUri ? `?redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    return request<FeishuAuthorizeResponse>(`/auth/feishu/authorize${qs}`);
  },

  feishuExchange: (body: FeishuExchangeRequest) =>
    request<LoginResponse>('/auth/feishu/exchange', { method: 'POST', body }),

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
  /** 当前 session 门店的在册 SKU（含售价 + 销量快照） */
  listSkus: (params?: { scene?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.scene !== undefined) qs.set('scene', String(params.scene));
    if (params?.q) qs.set('q', params.q);
    const q = qs.toString();
    return request<ListStoreSkusResponse>(`/store/skus${q ? `?${q}` : ''}`);
  },
};

// ============================================================================
// 模块 5 · 场景
// ============================================================================

export const scenesApi = {
  /** 全部场景定义（货架位 + 品类） */
  list: () => request<ListScenesResponse>('/scenes'),
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
};
