/**
 * 选品模块 API 客户端 —— 直接对接 P3 后端
 *
 * 与 lib/api-client.ts 同源（通用 request + ApiError），但只暴露选品需要的端点；
 * 字段名以后端实际返回为准（用本地 interface，不强依赖 @myj/shared 旧契约）。
 */
import { ApiError } from '@/lib/api-client';

const BASE = '/api/v1';

interface RequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString().replace(window.location.origin, ''), {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as unknown as T;
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* */ }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? `HTTP ${res.status}`,
      body?.error?.details,
      body?.requestId,
    );
  }
  return (await res.json()) as T;
}

// ---- 类型 ---------------------------------------------------------------

export interface SceneDef {
  scene: number;
  name: string;
  categories: Array<{ code: string; name: string }>;
}

export interface SceneOverview {
  scene: number;
  shelfConfigured: boolean;
  qaDone: boolean;
  adjustmentCount: number;
  hasDraft: boolean;
  /** 该场景 draft 最近一次更新时间；null = 没草稿。前端按此倒序选"继续 X 调改" */
  draftUpdatedAt: string | null;
  lastSalesDeltaPercent: number | null;
}

export interface StoreSku {
  productId: string;
  skuCode: string;
  productName: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  categoryPath: string | null;
  scene: number | null;
  retailPrice: number | null;
  originalPrice: number | null;
  wholesalePrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
  stockQty: number | null;
  snapshotDate: string;
  salesAmountChange30d: number | null;
  salesQtyChange30d: number | null;
}

export interface SceneRuntime {
  scene: number;
  status: 'empty' | 'photo_uploaded' | 'detected' | 'reviewing' | 'confirmed';
  photos: Array<{ url: string }>;
  detectionData: Record<string, unknown>;
  virtualStatus: 'idle' | 'processing' | 'completed' | 'failed';
  virtualRawOutputs: unknown;
  virtualContext: unknown;
  lastSnapshot: unknown;
  envCrowd: string | null;
  envCompetitor: string | null;
  draft: unknown;
  updatedAt: string | null;
}

export interface ShelfGroup {
  storeId: string;
  scene: number;
  groupIndex: number;
  shelfType: string | null;
  widthCm: number | null;
  layerCount: number | null;
  categories: string[];
  notes: string | null;
}

export interface AdjustmentItem {
  action: 'add' | 'remove';
  skuCode: string;
  productName?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export interface Adjustment {
  id: string;
  scene: number;
  summaryText: string | null;
  addedCount: number;
  removedCount: number;
  items: AdjustmentItem[];
  triggeredAt: string;
  triggeredByDisplay: string | null;
}

export interface SurveyQuestion {
  id: string;
  scene: number | null;
  questionNo: number;
  questionText: string;
  questionKind: 'single' | 'multi' | 'text';
  options: string[];
  answer: unknown;
}

// ---- 端点 ---------------------------------------------------------------

export const scenesApi = {
  list: () => request<{ scenes: SceneDef[] }>('/scenes'),
  overview: () => request<{ scenes: SceneOverview[] }>('/scenes/overview'),
  runtime: (scene: number) => request<SceneRuntime>(`/scenes/${scene}/runtime`),
  saveRuntime: (scene: number, patch: Partial<SceneRuntime>) =>
    request<SceneRuntime>(`/scenes/${scene}/runtime`, { method: 'PUT', body: patch }),
  clearRuntime: (scene: number) =>
    request<void>(`/scenes/${scene}/runtime`, { method: 'DELETE' }),

  listShelves: (scene: number) =>
    request<{ groups: ShelfGroup[] }>(`/scenes/${scene}/shelves`),
  replaceShelves: (
    scene: number,
    groups: Array<Pick<ShelfGroup, 'shelfType' | 'widthCm' | 'layerCount'> & { categories?: string[] }>,
  ) => request<{ groups: ShelfGroup[] }>(`/scenes/${scene}/shelves`, {
    method: 'PUT', body: { groups },
  }),

  apply: (scene: number, body: { summaryText?: string; items: AdjustmentItem[]; aiSessionId?: string }) =>
    request<Adjustment>(`/scenes/${scene}/adjustments`, { method: 'POST', body }),
  listAdjustments: (scene: number, limit = 50) =>
    request<{ adjustments: Adjustment[] }>(`/scenes/${scene}/adjustments`, { query: { limit } }),

  submitCorrection: (scene: number, body: {
    skuCode: string;
    kind: 'missed' | 'false_positive' | 'remove' | 'add';
    scope: 'detection' | 'decision';
    reasonCode: string;
    reasonText?: string;
  }) => request<unknown>(`/scenes/${scene}/corrections`, { method: 'POST', body }),

  /** multipart 上传货架照片 → 后端落 OSS + 追加 runtime.photos */
  uploadPhotos: async (scene: number, files: File[]): Promise<{ urls: string[] }> => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    const res = await fetch(`${BASE}/scenes/${scene}/photos`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) {
      let b: any = null;
      try { b = await res.json(); } catch { /* */ }
      throw new ApiError(res.status, b?.error?.code ?? 'UNKNOWN',
        b?.error?.message ?? `HTTP ${res.status}`, b?.error?.details, b?.requestId);
    }
    return (await res.json()) as { urls: string[] };
  },

  /** SSE：Dify align 工作流（货架对齐 + 三段诊断）。返回原始 Response，给 readWorkflowFinished 消费 */
  streamDiagnose: (scene: number, photoUrl: string, signal?: AbortSignal): Promise<Response> =>
    sseFetch(`${BASE}/scenes/${scene}/ai/diagnose`, { photoUrl }, signal),

  /** SSE：Dify selection 工作流（选品方案） */
  streamStrategy: (scene: number, signal?: AbortSignal): Promise<Response> =>
    sseFetch(`${BASE}/scenes/${scene}/ai/strategy`, {}, signal),

  /** SSE：Dify virtual-shelf 工作流（陈列示意图） */
  streamVirtualShelf: (scene: number, signal?: AbortSignal): Promise<Response> =>
    sseFetch(`${BASE}/scenes/${scene}/ai/virtual-shelf`, {}, signal),
};

/** 调商品识别 detect 端点 —— Blob → base64 + JSON POST */
export interface DetectBox {
  x: number; y: number; w: number; h: number;
  skuCode: string;
  confidence: number;
}
export interface DetectResult {
  boxes: DetectBox[];
  /** 非 null = 服务降级，UI 显示琥珀色横幅 */
  error: { code: 'UPSTREAM_DOWN' | 'NETWORK' | 'PARSE'; message: string } | null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export const detectApi = {
  detect: async (
    scene: number,
    blob: Blob,
    filename = 'shelf.jpg',
  ): Promise<DetectResult> => {
    let res: Response;
    try {
      const imageBase64 = await blobToBase64(blob);
      res = await fetch(`${BASE}/scenes/${scene}/detect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, filename }),
      });
    } catch (err) {
      return { boxes: [], error: { code: 'NETWORK', message: (err as Error).message } };
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error?.message) msg = j.error.message; } catch { /* */ }
      return { boxes: [], error: { code: 'UPSTREAM_DOWN', message: msg } };
    }
    try {
      const data = await res.json() as { boxes?: DetectBox[] };
      return { boxes: data.boxes ?? [], error: null };
    } catch (err) {
      return { boxes: [], error: { code: 'PARSE', message: (err as Error).message } };
    }
  },
};

/** SSE fetch helper：统一 credentials + Accept + 非 2xx 抛 ApiError */
async function sseFetch(
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let b: { error?: { code?: string; message?: string }; requestId?: string } | null = null;
    try { b = await res.json(); } catch { /* */ }
    throw new ApiError(
      res.status,
      b?.error?.code ?? 'UNKNOWN',
      b?.error?.message ?? `HTTP ${res.status}`,
      undefined,
      b?.requestId,
    );
  }
  return res;
}

export const storeApi = {
  skus: (scene?: number) =>
    request<{ skus: StoreSku[] }>(`/store/skus`, { query: { scene } }),
  shelves: () => request<{ shelves: ShelfGroup[] }>('/store/shelves'),
};

export const insightsApi = {
  questions: (scene: number | null) =>
    request<{ questions: SurveyQuestion[] }>('/insights/surveys/questions', {
      query: scene == null ? {} : { scene },
    }),
  replaceQuestions: (
    scene: number | null,
    questions: Array<Pick<SurveyQuestion, 'questionText' | 'questionKind' | 'options'>>,
    source: 'ai' | 'manual' = 'ai',
  ) => request<{ questions: SurveyQuestion[] }>('/insights/surveys/questions', {
    method: 'PUT',
    query: scene == null ? {} : { scene },
    body: { questions, source },
  }),
  submitAnswers: (answers: Array<{ questionId: string; value: unknown }>) =>
    request<{ written: number }>('/insights/surveys/answers', {
      method: 'PUT', body: { answers },
    }),
  /**
   * 触发 Dify questions 工作流生成场景问卷题目（SSE 流式）。
   * 返回原始 Response，由上层 readWorkflowFinished 消费。
   */
  streamQuestions: (scene: number, signal?: AbortSignal): Promise<Response> => {
    const url = `${BASE}/insights/surveys/questions/ai?scene=${scene}`;
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        let body: { error?: { code?: string; message?: string }; requestId?: string } | null = null;
        try { body = await res.json(); } catch { /* */ }
        throw new ApiError(
          res.status,
          body?.error?.code ?? 'UNKNOWN',
          body?.error?.message ?? `HTTP ${res.status}`,
          undefined,
          body?.requestId,
        );
      }
      return res;
    });
  },
};

export const hqApi = {
  /** 商品官方图 URL（由后端 302 → OSS） */
  productImageUrl: (skuCode: string) => `${BASE}/hq/products/${encodeURIComponent(skuCode)}/official-image`,
  /** 商品条码图 URL（由后端 302 → OSS） */
  productBarcodeUrl: (skuCode: string) => `${BASE}/hq/products/${encodeURIComponent(skuCode)}/barcode`,
};
