/**
 * admin-web 后端调用统一封装。
 *
 * - 同源 fetch /api/v1/...,session cookie 自动带上(credentials: include)
 * - 错误响应抽出 .error.message 抛 ApiError,UI 直接展示
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ServerErrorShape {
  error?: { code?: string; message?: string };
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | null = null;
    try {
      const body = (await res.json()) as ServerErrorShape;
      if (body.error?.message) msg = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      /* keep msg */
    }
    throw new ApiError(msg, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
