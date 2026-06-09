/**
 * Shim：兼容原 poster repo 的 @/lib/poster-jobs.functions
 *
 * 原 repo 用 poster_jobs 表 + Supabase Realtime 实现异步生成队列。
 * 统一后端把同样的状态机做在 /posters/queue/* 路由上（见 posters.routes.ts）：
 *   enqueue → claim+process → list active → cancel batch → reset stuck → retry failed
 * 这里把老 snake_case JobRow / styleId / mode 的形状翻译过去，让上层 JobsContext
 * 不需要改一行。
 *
 * 决策点：
 * - photoBase64 直接当 sourcePhotoUrl（data URL）发，后端会原样转给 nano-banana
 * - storeId 不上行：后端从 session 读 currentStore
 * - status 五态合并：claimed/processing → processing；succeeded → done；failed/canceled → error
 *
 * Backend 路由签名见 apps/api/src/routes/posters.routes.ts。
 */
import type {
  PosterTemplate,
  PosterMode as BackendPosterMode,
} from '@myj/shared';

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export interface JobItemInput {
  photoBase64: string;
  copy: string;
  styleId: 'vibrant' | 'premium' | 'minimal' | 'custom';
  customStyle?: string | null;
  mode?: 'normal' | 'bg_only' | 'group';
  productImageUrl?: string | null;
  productImageUrls?: string[] | null;
  brandLabel?: string | null;
  storeId?: string | null;
  sku?: string | null;
  category?: string | null;
}

interface ServerFnInput<T> {
  data: T;
}

export interface JobRow {
  id: string;
  batch_id: string;
  status: JobStatus;
  result_image_url: string | null;
  error: string | null;
  position: number;
  params: { copy?: string; sku?: string | null } & Record<string, unknown>;
  created_at: string;
}

const BASE = '/api/v1';

// ---- helpers --------------------------------------------------------------

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

function mapModeToBackend(m: JobItemInput['mode']): BackendPosterMode {
  if (m === 'bg_only') return 'official_bg_only';
  if (m === 'group') return 'multi_product';
  return 'photo_compose';
}

function itemToBackendBody(it: JobItemInput) {
  const body: Record<string, unknown> = {
    template: it.styleId satisfies PosterTemplate,
    mode: mapModeToBackend(it.mode),
    copyText: it.copy,
  };
  if (it.photoBase64) body.sourcePhotoUrl = it.photoBase64;
  if (it.productImageUrl) body.productImageUrl = it.productImageUrl;
  if (it.productImageUrls?.length) body.officialImageUrls = it.productImageUrls;
  if (it.customStyle) body.customStyleDescription = it.customStyle;
  if (it.sku) body.skuCode = it.sku;
  if (it.category) body.categoryName = it.category;
  return body;
}

interface BackendJob {
  id: string;
  batchId: string;
  parentJobId: string | null;
  userId: string;
  storeId: string | null;
  template: PosterTemplate;
  mode: BackendPosterMode;
  copyText: string;
  skuCode: string | null;
  categoryName: string | null;
  status: 'queued' | 'claimed' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  posterImageUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  resetCount: number;
  createdAt: string;
  updatedAt: string;
}

function statusToFront(s: BackendJob['status']): JobStatus {
  if (s === 'succeeded') return 'done';
  if (s === 'failed' || s === 'canceled') return 'error';
  if (s === 'claimed' || s === 'processing') return 'processing';
  return 'queued';
}

function jobToRow(j: BackendJob, position = 0): JobRow {
  return {
    id: j.id,
    batch_id: j.batchId,
    status: statusToFront(j.status),
    result_image_url: j.posterImageUrl,
    error: j.errorMessage,
    position,
    params: {
      copy: j.copyText,
      sku: j.skuCode,
      template: j.template,
      mode: j.mode,
      categoryName: j.categoryName,
    },
    created_at: j.createdAt,
  };
}

// ---- public API -----------------------------------------------------------

export async function enqueuePosterJobs(
  input: ServerFnInput<{ items: JobItemInput[] }>,
): Promise<{ batchId: string; jobIds: string[] }> {
  const jobs = input.data.items.map(itemToBackendBody);
  return jsonFetch<{ batchId: string; jobIds: string[] }>(
    '/posters/queue/enqueue',
    { method: 'POST', body: JSON.stringify({ jobs }) },
  );
}

/**
 * 触发一个 worker：调后端 claim+process。
 * 后端是同步执行（OpenRouter 调用 ~30s），所以这个 Promise 完成 = 该 job 已 succeeded/failed。
 * 没有可认领的任务返回 { jobId: null, status: null }（404 → 静默）。
 */
export async function processPosterJob(
  input?: ServerFnInput<{ jobId?: string }>,
): Promise<{ jobId: string | null; status: JobStatus | null }> {
  const body = input?.data?.jobId ? { jobId: input.data.jobId } : {};
  try {
    const res = await jsonFetch<{ job: BackendJob }>(
      '/posters/queue/process',
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { jobId: res.job.id, status: statusToFront(res.job.status) };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('没有可认领')) return { jobId: null, status: null };
    throw err;
  }
}

export async function listMyActiveJobs(): Promise<{ jobs: JobRow[] }> {
  const res = await jsonFetch<{ jobs: BackendJob[] }>('/posters/queue/active');
  // 后端按 created_at DESC；前端 buildBatches 按 position 升序排，给个稳定 position 即可
  const jobs = res.jobs.map((j, i) => jobToRow(j, i));
  return { jobs };
}

export async function dismissBatch(
  input: ServerFnInput<{ batchId: string }>,
): Promise<{ ok: true }> {
  if (!input.data.batchId) return { ok: true };
  await jsonFetch(
    `/posters/queue/batch/${encodeURIComponent(input.data.batchId)}`,
    { method: 'DELETE' },
  );
  return { ok: true };
}

export async function resetStaleJob(
  input: ServerFnInput<{ jobId: string }>,
): Promise<{ ok: true }> {
  try {
    await jsonFetch(
      `/posters/queue/task/${encodeURIComponent(input.data.jobId)}/reset`,
      { method: 'POST' },
    );
  } catch (err) {
    // 后端会在"任务不在可重置状态"时 409；这里和原 repo 行为一致地静默处理
    const msg = (err as Error).message;
    if (!msg.includes('不在可重置状态')) throw err;
  }
  return { ok: true };
}

export async function requeuePosterJob(
  input: ServerFnInput<{
    jobId: string;
    styleId?: string;
    sourceDeleted?: boolean;
    batchId?: string;
    copy?: string;
    customStyle?: string | null;
    photoBase64?: string;
    [k: string]: unknown;
  }>,
): Promise<{ jobId: string; batchId?: string; sourceDeleted?: boolean }> {
  const d = input.data;
  const patch: Record<string, unknown> = {};
  if (d.styleId) patch.template = d.styleId;
  if (typeof d.copy === 'string') patch.copyText = d.copy;
  if (d.photoBase64) patch.sourcePhotoUrl = d.photoBase64;
  if (typeof d.customStyle === 'string') patch.customStyleDescription = d.customStyle;
  const res = await jsonFetch<{ batchId: string; newJobId: string }>(
    `/posters/queue/task/${encodeURIComponent(d.jobId)}/retry`,
    { method: 'POST', body: JSON.stringify(patch) },
  );
  return { jobId: res.newJobId, batchId: res.batchId, sourceDeleted: d.sourceDeleted };
}
