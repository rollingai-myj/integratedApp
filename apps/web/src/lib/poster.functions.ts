/**
 * Shim：兼容原 poster repo 引用的 @/lib/poster.functions
 *
 * Phase 5 数据层切换：
 * 旧的 /posters/generate（同步生成端点）已下线；统一后端走 task/generation 异步模型。
 * 这里做"同步外壳"——
 *   1) POST /posters/tasks 建一个 1-element 批次，拿到 task + generation #1 (queued)
 *   2) POST /posters/generations:claim { generationId } 精确认领并同步执行
 *   3) 等返回 succeeded/failed，适配成老的 PosterResult shape
 * 上层 poster-app 子树（components/posters/screens/*）零修改。
 */
import type {
  CreatePosterTasksRequest,
  CreatePosterTasksResponse,
  PosterGeneration,
} from '@myj/shared';

export type PosterStyleId = 'vibrant' | 'premium' | 'minimal' | 'custom';

export interface PosterResult {
  imageUrl: string;
  modelUsed: string;
  promptUsed: string;
}

interface ServerFnInput<T> {
  data: T;
}

export interface GeneratePosterInput {
  photo: string;                 // data URL（base64）
  copy: string;
  styleId: PosterStyleId;
  customStyle?: string;
  storeId?: string | null;
  sku?: string | null;
  category?: string | null;
  mode?: 'normal' | 'bg_only';
  productImageUrl?: string | null;
}

const BASE = '/api/v1';

async function jsonFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) msg = err.error.message;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function generatePoster(
  input: ServerFnInput<GeneratePosterInput>,
): Promise<PosterResult> {
  const d = input.data;
  const backendMode = d.mode === 'bg_only' ? 'official_bg_only' : 'photo_compose';

  // 1) 建任务（自动 generation #1 = queued）
  const createBody: CreatePosterTasksRequest = {
    tasks: [
      {
        template: d.styleId,
        mode: backendMode,
        copyText: d.copy,
        sourcePhotoUrl: d.photo,                           // data URL 直接透传
        productImageUrl: d.productImageUrl ?? undefined,
        customStyleDescription: d.customStyle ?? undefined,
        skuCode: d.sku ?? undefined,
        categoryName: d.category ?? undefined,
      },
    ],
  };
  const create = await jsonFetch<CreatePosterTasksResponse>('/posters/tasks', {
    method: 'POST',
    body: JSON.stringify(createBody),
  });
  const task = create.tasks[0];
  const generationId = task?.latestGeneration?.id;
  if (!generationId) {
    throw new Error('建任务后未返回 generation id');
  }

  // 2) 精确认领并同步执行（claim 路由内部直接调 Corelays gpt-image-2）
  const claim = await jsonFetch<{ generation: PosterGeneration } | undefined>(
    '/posters/generations:claim',
    { method: 'POST', body: JSON.stringify({ generationId }) },
  );
  if (!claim?.generation) {
    throw new Error('生成失败：未能认领刚建的任务');
  }
  const gen = claim.generation;

  if (gen.status !== 'succeeded' || !gen.posterImageUrl) {
    throw new Error(gen.errorMessage ?? `生成失败：${gen.status}`);
  }

  return {
    imageUrl: gen.posterImageUrl,
    modelUsed: gen.aiModel ?? '',
    promptUsed: '',   // 后端不暴露具体 prompt 给前端（决策 D11 留痕只在 audit/job 表）
  };
}
