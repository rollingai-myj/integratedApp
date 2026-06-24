/**
 * Shim:单张海报生成的「同步外壳」
 *
 * 后端 api-worker 上线后:
 *   1) POST /posters/tasks 建一个 1-element 批次,拿到 task + generation #1 (queued)
 *   2) 不再 client claim —— 那会跟后端 worker 抢同一行,首发者赢、对方拿空。
 *      改成轮询 GET /posters/tasks/:taskId,等 worker 把 generation 推到
 *      succeeded/failed,前端再读取结果。
 *
 * 上层 PosterApp 仍是 await 风格,只是阻塞从「同步 HTTP 长连」变成「轮询」。
 */
import type {
  CreatePosterTasksRequest,
  CreatePosterTasksResponse,
  GetPosterTaskResponse,
} from '@myj/shared';

export type PosterStyleId = 'vibrant' | 'premium' | 'minimal' | 'custom';

export interface PosterResult {
  imageUrl: string;
  modelUsed: string;
  promptUsed: string;
  /** 后端 generation id —— 给「添加到收藏」用 */
  generationId: string;
}

const POLL_INTERVAL_MS = 1500;
/** 单张生成最长等 90s:Corelays gpt-image-2 一般 30s 内出,留 3x buffer */
const POLL_TIMEOUT_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  /** 活动类型 raw 枚举,后端用来挑右下角二维码 */
  baseActivityType?: string | null;
  addonActivityType?: string | null;
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
  const extras: Record<string, unknown> = {};
  if (d.baseActivityType) extras.baseActivityType = d.baseActivityType;
  if (d.addonActivityType) extras.addonActivityType = d.addonActivityType;
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
        extras: Object.keys(extras).length ? extras : undefined,
      },
    ],
  };
  const create = await jsonFetch<CreatePosterTasksResponse>('/posters/tasks', {
    method: 'POST',
    body: JSON.stringify(createBody),
  });
  const task = create.tasks[0];
  if (!task) throw new Error('建任务失败');
  const taskId = task.id;

  // 2) 轮询任务详情,等 backend api-worker 把它跑完。
  //    不再 client claim —— 跟 worker 抢同一行,首发者赢,另一边拿空。
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const detail = await jsonFetch<GetPosterTaskResponse>(
      `/posters/tasks/${encodeURIComponent(taskId)}`,
      { method: 'GET' },
    );
    // 用 generations[].attempt_no 最大的那一条作为"最新一次尝试"
    const latest = detail.generations.length
      ? detail.generations.reduce((a, b) => (b.attemptNo > a.attemptNo ? b : a))
      : null;
    if (!latest) continue;
    if (latest.status === 'succeeded' && latest.posterImageUrl) {
      return {
        imageUrl: latest.posterImageUrl,
        modelUsed: latest.aiModel ?? '',
        promptUsed: '',
        generationId: latest.id,
      };
    }
    if (latest.status === 'failed' || latest.status === 'canceled') {
      throw new Error(latest.errorMessage ?? `生成失败:${latest.status}`);
    }
    // queued / claimed / processing → 继续等
  }
  throw new Error('生成超时(>90s),请稍后到「生成记录」查看');
}
