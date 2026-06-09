/**
 * Shim：兼容原 poster repo 引用的 @/lib/usage.functions
 *
 * 老 repo 用 usage_sessions 表 + 30s 心跳统计"店长在线时长"。
 * 整合后这部分会由 host 统一做（计划放在 admin 模块）。
 * 当前 shim 直接打 host 的 /usage/sessions:start + /usage/sessions/:id/heartbeat，
 * 失败也不阻塞 UI（fire-and-forget）。
 */

interface ServerFnInput<T> {
  data: T;
}

const BASE = '/api/v1';

export async function startSession(
  _input?: ServerFnInput<{ deviceId?: string; storeId?: string | null }>,
): Promise<{ id: string | null }> {
  try {
    const res = await fetch(`${BASE}/usage/sessions:start`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return { id: null };
    const body = (await res.json()) as { sessionId?: string };
    return { id: body.sessionId ?? null };
  } catch {
    return { id: null };
  }
}

export async function heartbeat(
  input: ServerFnInput<{ sessionId: string }>,
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`${BASE}/usage/sessions/${encodeURIComponent(input.data.sessionId)}/heartbeat`, {
      method: 'POST',
      credentials: 'include',
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export const DAILY_POSTER_LIMIT = 999999;

export async function getTodayUsage(): Promise<{ count: number; limit: number }> {
  try {
    const res = await fetch(`${BASE}/usage/poster-count-today`, { credentials: 'include' });
    if (!res.ok) return { count: 0, limit: DAILY_POSTER_LIMIT };
    const body = (await res.json()) as { count?: number };
    return { count: body.count ?? 0, limit: DAILY_POSTER_LIMIT };
  } catch {
    return { count: 0, limit: DAILY_POSTER_LIMIT };
  }
}
