/**
 * 选品模块 API 客户端 —— 直接对接 P3 后端
 *
 * 与 lib/api-client.ts 同源（通用 request + ApiError），但只暴露选品需要的端点；
 * 字段名以后端实际返回为准（用本地 interface，不强依赖 @myj/shared 旧契约）。
 */
import { ApiError } from '@/lib/api-client';
import { compressShelfPhoto } from './lib/compressShelfPhoto';

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
  /** 商品深度(cm),hq_products.length_cm —— 虚拟陈列图按这个推每个商品高度比例 */
  lengthCm: number | null;
  /** 商品宽度(cm) */
  widthCm: number | null;
  /** 商品高度(cm),烘焙类陈列图用这个当视觉高度 */
  heightCm: number | null;
  categoryPath: string | null;
  scene: number | null;
  retailPrice: number | null;
  originalPrice: number | null;
  wholesalePrice: number | null;
  salesQty30d: number | null;
  /** 近 30 日真实销售额(V031 起改名;后端字段 sales_realamt_30d) */
  salesRealamt30d: number | null;
  stockQty: number | null;
  snapshotDate: string;
  /** 近 30 日 PSD 销售环比 %; V031 起来自 ERP 直接灌入的 snapshot.psd_hb_30d */
  psdHb30d: number | null;
  psdHb90d: number | null;
  /** 销量(件数)环比 %; 仍由后端从两期 sales_qty_30d 自算 */
  salesQtyChange30d: number | null;
}

export type AiTaskStatus = 'idle' | 'processing' | 'completed' | 'failed';

export interface SceneRuntime {
  scene: number;
  status: 'empty' | 'photo_uploaded' | 'detected' | 'reviewing' | 'confirmed';
  photos: Array<{ url: string }>;
  detectionData: Record<string, unknown>;
  virtualStatus: AiTaskStatus;
  virtualRawOutputs: unknown;
  virtualContext: unknown;
  /** V028: align(三段诊断) 后台任务状态,替换原前端 SSE IIFE */
  diagnoseStatus: AiTaskStatus;
  diagnoseRawOutputs: unknown;
  /** V028: selection(选品策略) 后台任务状态 */
  strategyStatus: AiTaskStatus;
  strategyRawOutputs: unknown;
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

/**
 * 调改效果追踪指标:
 *   - 'accumulating' = 数据不足(< 14 天 / 窗口无快照 / 无基线 / 基线 0),前端显示"数据积累中"
 *   - 'computed'     = 算出销量Δ% / 销售额Δ%。任一为 null = 该项基线 0(罕见),前端显示 "—"
 */
export type AdjustmentEffect =
  | { status: 'accumulating' }
  | {
      status: 'computed';
      qtyDeltaPct: number | null;
      amtDeltaPct: number | null;
      preDate: string;
      postDate: string;
    };

export interface Adjustment {
  id: string;
  scene: number;
  summaryText: string | null;
  addedCount: number;
  removedCount: number;
  items: AdjustmentItem[];
  triggeredAt: string;
  triggeredByDisplay: string | null;
  effect?: AdjustmentEffect;
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

/**
 * 标杆店(参考店) SKU 跨店加权平均指标 —— 同场景下排除本店后,按店配重均出的销量/销售额/环比。
 * 数值字段后端落库是 numeric,序列化后是 string;前端展示前要 Number() 一下。
 */
export interface BenchmarkSku {
  skuCode: string;
  skuName: string;
  spec: string;
  majorCategory: string;
  midCategory: string;
  subCategory: string;
  /** 跨店 30 日真实销售额加权平均(元) */
  sales30d: string;
  /** 跨店 30 日销量加权平均(件) */
  salesVolume30d: string;
  /** 跨店 PSD 销售环比(%);V031 起读 ERP 灌入的 snapshot.psd_hb_30d */
  psdChange: string;
  shelfLifeDays: number | null;
}

export const scenesApi = {
  list: () => request<{ scenes: SceneDef[] }>('/scenes'),
  overview: () => request<{ scenes: SceneOverview[] }>('/scenes/overview'),
  benchmark: (scene: number) =>
    request<{ scene: number; items: BenchmarkSku[] }>(`/scenes/${scene}/benchmark`),
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
    const prepared = await Promise.all(files.map((f) => compressShelfPhoto(f)));
    const fd = new FormData();
    prepared.forEach((f) => fd.append('files', f));
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

  /**
   * V028: 触发 Dify align(三段诊断) 后台任务。返回 202 立即,前端轮询 runtime.diagnoseStatus。
   * 不再 SSE 透传 — 关 tab/刷新页面任务仍在 API 进程跑。
   */
  triggerDiagnose: (scene: number, photoUrls: string[]) =>
    request<{ accepted: boolean }>(`/scenes/${scene}/ai/diagnose`, {
      method: 'POST', body: { photoUrls },
    }),

  /** V028: 触发 Dify selection(选品策略) 后台任务。前端轮询 runtime.strategyStatus。 */
  triggerStrategy: (scene: number) =>
    request<{ accepted: boolean }>(`/scenes/${scene}/ai/strategy`, { method: 'POST' }),

  /** V028: 触发 Dify virtual-shelf 后台任务。前端轮询 runtime.virtualStatus。 */
  triggerVirtualShelf: (scene: number) =>
    request<{ accepted: boolean }>(`/scenes/${scene}/ai/virtual-shelf`, { method: 'POST' }),
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
