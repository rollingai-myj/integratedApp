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
// 健康检查
// ============================================================================

export const healthApi = {
  check: () => request<HealthResponse>('/health'),
};
