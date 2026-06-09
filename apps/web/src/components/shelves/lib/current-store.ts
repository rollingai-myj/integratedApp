/**
 * 当前 session 门店缓存 —— 不少 v1 路径段需要门店 UUID（如 /master/environment/:storeId），
 * 而原 repo 业务代码里传的 storeId 是门店编号（"粤37893" 之类）。这里集中向
 * /api/v1/auth/me 拿 currentStore，缓存到下次刷新；inflight 共享，避免并发风暴。
 *
 * 业务层不应直接 cookie 解 JWT —— 走这层。失败返回 null，调用方做 fallback。
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

export interface CurrentStoreInfo {
  id: string;       // UUID
  code: string;     // 业务编号 / 飞书店号，如 "粤37893"
  name: string;     // 显示名
}

let cached: CurrentStoreInfo | null = null;
let inflight: Promise<CurrentStoreInfo | null> | null = null;

export async function getCurrentStore(): Promise<CurrentStoreInfo | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/me`, { credentials: 'include' });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        currentStore?: { id?: string; code?: string; name?: string } | null;
      };
      const s = data.currentStore;
      if (!s?.id || !s.code) return null;
      cached = { id: s.id, code: s.code, name: s.name ?? '' };
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearCurrentStoreCache(): void {
  cached = null;
}
