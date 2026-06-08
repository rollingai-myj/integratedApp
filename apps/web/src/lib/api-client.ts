/**
 * 后端 API 客户端
 *
 * 所有对 /api/v1/* 的调用都从这里走，便于：
 *   - 统一加 cookie 凭证
 *   - 统一错误格式解析
 *   - 统一请求 ID 透传
 *
 * 接口字段定义优先复用 @myj/shared，避免前后端类型漂移。
 */
import type { MeResponse, HealthResponse, ApiErrorBody } from '@myj/shared';

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
    credentials: 'include', // 带 cookie
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await res.json()) as ApiErrorBody;
    } catch {
      // 非 JSON 响应
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

  /** 退出登录 */
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  // TODO M1: login, feishuAuthorize, feishuCallback, feishuExchange, feishuH5Sign
};

// ============================================================================
// 健康检查（不在规划，但通用）
// ============================================================================

export const healthApi = {
  check: () => request<HealthResponse>('/health'),
};

// TODO M1+: 其它 9 个模块的客户端按需补全
