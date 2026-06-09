/**
 * Shim：兼容原 poster repo 引用的 @/lib/poster.functions
 *
 * 老 repo 的 generatePoster 是 createServerFn，直接调 OpenRouter Vision 模型。
 * 整合后由统一后端 /api/v1/posters/generate 代理（密钥在后端 .env，
 * 浏览器看不到，决策 D11 也在那一层落 audit_events.is_ai_call=TRUE）。
 *
 * 这里把老的 PosterStyleId → 后端 PosterTemplate、PosterMode 适配一下，
 * 把后端的 PosterRecord 适配成老的 PosterResult，让 poster-app 子树零修改。
 */
import type { PosterGenerateRequest, PosterGenerateResponse } from '@myj/shared';

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

export async function generatePoster(
  input: ServerFnInput<GeneratePosterInput>,
): Promise<PosterResult> {
  const d = input.data;

  // 老的 mode → 新后端 PosterMode 枚举
  const backendMode = d.mode === 'bg_only' ? 'official_bg_only' : 'photo_compose';

  const body: PosterGenerateRequest = {
    template: d.styleId,
    mode: backendMode,
    copyText: d.copy,
    sourcePhotoUrl: d.photo,                                  // data URL 直接透传
    productImageUrl: d.productImageUrl ?? undefined,
    customStyleDescription: d.customStyle ?? undefined,
    skuCode: d.sku ?? undefined,
    categoryName: d.category ?? undefined,
  };

  const res = await fetch(`${BASE}/posters/generate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) msg = err.error.message;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }

  const body2 = (await res.json()) as PosterGenerateResponse;
  return {
    imageUrl: body2.poster.posterImageUrl,
    modelUsed: body2.poster.aiModel ?? '',
    promptUsed: '',   // 后端不暴露具体 prompt 给前端（决策 D11 留痕只在 audit/job 表）
  };
}
