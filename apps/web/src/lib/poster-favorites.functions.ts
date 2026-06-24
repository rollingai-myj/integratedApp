/**
 * 海报收藏接口 shim
 *
 * 后端路由:GET/POST/DELETE /posters/favorites
 * 与 [poster-jobs.functions](./poster-jobs.functions.ts) 同款 jsonFetch 风格,credentials:include。
 */

export interface PosterFavorite {
  id: string;
  generationId: string;
  taskId: string;
  batchId: string;
  posterImageUrl: string | null;
  thumbnailUrl: string | null;
  copyText: string;
  template: string;
  skuCode: string | null;
  createdAt: string;
}

const BASE = '/api/v1';

async function jsonFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) msg = body.error.message;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listFavorites(): Promise<{ items: PosterFavorite[] }> {
  return jsonFetch<{ items: PosterFavorite[] }>('/posters/favorites');
}

export async function addFavorite(generationId: string): Promise<{ favorite: PosterFavorite }> {
  return jsonFetch<{ favorite: PosterFavorite }>('/posters/favorites', {
    method: 'POST',
    body: JSON.stringify({ generationId }),
  });
}

export async function removeFavorite(generationId: string): Promise<void> {
  await jsonFetch(`/posters/favorites/${encodeURIComponent(generationId)}`, {
    method: 'DELETE',
  });
}
