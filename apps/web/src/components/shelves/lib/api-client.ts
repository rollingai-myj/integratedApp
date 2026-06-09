/**
 * 原 repo 的 @/integrations/api/client 等价物
 *
 * 替代点：
 * - 原 repo：session/Bearer token；整合 app：HttpOnly cookie + `credentials: 'include'`
 * - 原 repo：路径 `/api/...`；整合 app：所有业务接口前缀 `/api/v1/...`
 *
 * 行为：调用方传 `/api/scenes/...` 一类老路径，shim 自动转成 `/api/v1/scenes/...`；
 * 调用方直接传 `/api/v1/...` 也允许。任何错误抛 `Error(API <status>: <text>)`，
 * 上层 catch 处理；404 视为正常空数据，保持与原 repo 一致。
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
const V1_PREFIX = '/api/v1';

/**
 * 路径归一化：
 *   - `/api/v1/...`  保持不变（已是 v1）
 *   - `/api/...`     当作老 repo 路径，自动改写为 `/api/v1/...`（兼容尚未改造的 service）
 *   - `/...`         新 shim 写法，直接拼 `/api/v1`
 *   - 绝对 URL      原样透传
 */
function normalizePath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/api/v1/')) return path;
  if (path.startsWith('/api/')) return `${V1_PREFIX}${path.slice(4)}`;
  return `${V1_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
}

/** 兼容旧 fetch 用法：返回 Headers 对象（v1 不再需要 Bearer，cookie 自动带） */
export function getAuthHeaders(): Record<string, string> {
  return {};
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE_URL}${normalizePath(path)}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res;
}

export const apiClient = {
  get: (path: string) => apiFetch(path),
  post: (path: string, body: unknown) =>
    apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path: string, body: unknown) =>
    apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string, body?: unknown) =>
    apiFetch(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
  upload: (path: string, formData: FormData) =>
    apiFetch(path, { method: 'POST', body: formData }),
};
