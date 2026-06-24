/**
 * Shim：兼容原 poster repo 的 @/lib/poster-jobs.functions
 *
 * 任务架构（后端 worker 上线后）：
 *   - 浏览器不再是 worker。enqueue 后由后端 api-worker 容器轮询 + 调 AI + 写结果。
 *   - 前端只 POST 入队 + 3s 轮询 /posters/tasks?status=recent（近 30 天，全状态）。
 *   - 任务队列 / 生成记录 都从这个 snapshot 计算 —— 关 tab/换设备/换浏览器都续。
 *
 * 映射：
 *   enqueue        → POST   /posters/tasks
 *   listRecent     → GET    /posters/tasks?scope=mine&status=recent&days=30
 *   dismiss(组)    → DELETE /posters/tasks/batch/:batchId
 *   requeue        → 反查 task → POST /posters/tasks（新任务，patch 业务字段）
 *
 * 状态合并：
 *   claimed/processing → processing
 *   succeeded → done
 *   failed/canceled → error
 *   queued → queued
 *
 * 旧的 processPosterJob / resetStaleJob 已下线 —— 后端 worker 接管，
 * 卡死走 store_poster_generations.claim_expires_at + 服务端自动 reclaim。
 */
import type {
  PosterTemplate,
  PosterMode as BackendPosterMode,
  PosterTask,
  PosterGeneration,
  PosterGenerationStatus,
  CreatePosterTasksRequest,
  CreatePosterTasksResponse,
  ListPosterTasksResponse,
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
  /** 活动类型 raw 枚举,worker 用来挑右下角二维码 */
  baseActivityType?: string | null;
  addonActivityType?: string | null;
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

function itemToTaskCreate(it: JobItemInput): CreatePosterTasksRequest['tasks'][number] {
  const extras: Record<string, unknown> = {};
  if (it.productImageUrls?.length) extras.productImageUrls = it.productImageUrls;
  if (it.brandLabel) extras.brandLabel = it.brandLabel;
  if (it.baseActivityType) extras.baseActivityType = it.baseActivityType;
  if (it.addonActivityType) extras.addonActivityType = it.addonActivityType;
  return {
    template: it.styleId satisfies PosterTemplate,
    mode: mapModeToBackend(it.mode),
    copyText: it.copy,
    sourcePhotoUrl: it.photoBase64 || undefined,
    productImageUrl: it.productImageUrl ?? undefined,
    customStyleDescription: it.customStyle ?? undefined,
    skuCode: it.sku ?? undefined,
    categoryName: it.category ?? undefined,
    extras: Object.keys(extras).length ? extras : undefined,
  };
}

function statusToFront(s: PosterGenerationStatus): JobStatus {
  if (s === 'succeeded') return 'done';
  if (s === 'failed' || s === 'canceled') return 'error';
  if (s === 'claimed' || s === 'processing') return 'processing';
  return 'queued';
}

/** 把 task + 它的最近 generation 适配成老 JobRow 形状（前端 JobsContext 用） */
function taskToRow(task: PosterTask, position = 0): JobRow {
  const gen = task.latestGeneration;
  return {
    id: gen?.id ?? task.id,  // jobId 优先用 generationId（process/reset/retry 都按它走）
    batch_id: task.batchId,
    status: gen ? statusToFront(gen.status) : 'queued',
    result_image_url: gen?.posterImageUrl ?? null,
    error: gen?.errorMessage ?? null,
    position,
    params: {
      copy: task.copyText,
      sku: task.products[0]?.skuCode ?? null,
      template: task.template,
      mode: task.mode,
      categoryName: null,
      // 销量跟踪需要按门店过滤(避免 A 店做的 SKU 用 B 店销量曲线)
      storeId: task.storeId,
    },
    created_at: gen?.createdAt ?? task.createdAt,
  };
}

function generationToRow(
  generation: PosterGeneration,
  taskId: string,
  batchId: string,
  position = 0,
): JobRow {
  return {
    id: generation.id,
    batch_id: batchId,
    status: statusToFront(generation.status),
    result_image_url: generation.posterImageUrl,
    error: generation.errorMessage,
    position,
    params: {
      copy: '',                       // 单条 generation 视角看不到 task.copyText
      sku: null,
      taskId,
    },
    created_at: generation.createdAt,
  };
}

// ---- public API -----------------------------------------------------------

export async function enqueuePosterJobs(
  input: ServerFnInput<{ items: JobItemInput[] }>,
): Promise<{ batchId: string; jobIds: string[] }> {
  const tasks = input.data.items.map(itemToTaskCreate);
  const res = await jsonFetch<CreatePosterTasksResponse>('/posters/tasks', {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
  return {
    batchId: res.batchId,
    jobIds: res.tasks.map((t) => t.latestGeneration?.id ?? t.id),
  };
}

/**
 * 拉近 30 天我的所有任务(全状态):队列常驻 / 生成记录 / 历史回放都用它。
 * 后端 worker 接管 AI 执行 -> 前端不再调 claim。
 */
export async function listMyRecentJobs(days = 30): Promise<{ jobs: JobRow[] }> {
  const res = await jsonFetch<ListPosterTasksResponse>(
    `/posters/tasks?scope=mine&status=recent&days=${days}`,
  );
  const jobs = res.tasks.map((t, i) => taskToRow(t, i));
  return { jobs };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function dismissBatch(
  input: ServerFnInput<{ batchId: string }>,
): Promise<{ ok: true }> {
  const id = input.data.batchId;
  if (!id || !UUID_RE.test(id)) return { ok: true };
  await jsonFetch(
    `/posters/tasks/batch/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return { ok: true };
}

/**
 * 老语义 requeue = "改一些参数后重新入队，得到新 jobId"。
 * 新模型按"换文案/换图 = 新任务"原则——建新 task。
 */
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

  // 1) 反查老 task
  const ref = await jsonFetch<{
    generation: PosterGeneration;
    taskId: string;
    batchId: string;
  }>(`/posters/generations/${encodeURIComponent(d.jobId)}`);
  const taskDetail = await jsonFetch<{ task: PosterTask }>(
    `/posters/tasks/${encodeURIComponent(ref.taskId)}`,
  );
  const oldTask = taskDetail.task;

  // 2) merge：以老 task 为底，patch 覆盖
  const newTask: CreatePosterTasksRequest['tasks'][number] = {
    template: (d.styleId as PosterTemplate | undefined) ?? oldTask.template,
    mode: oldTask.mode,
    copyText: typeof d.copy === 'string' ? d.copy : oldTask.copyText,
    sourcePhotoUrl: d.photoBase64 ?? oldTask.sourcePhotoUrl ?? undefined,
    productImageUrl: oldTask.productImageUrl ?? undefined,
    customStyleDescription:
      typeof d.customStyle === 'string'
        ? d.customStyle
        : oldTask.customStyleDescription ?? undefined,
    skuCode: oldTask.products[0]?.skuCode ?? undefined,
  };
  if (oldTask.mode === 'multi_product') {
    newTask.products = oldTask.products.map((p) => ({
      skuCode: p.skuCode,
      displayOrder: p.displayOrder,
    }));
  }

  // 3) 建新任务（独立 batch）
  const created = await jsonFetch<CreatePosterTasksResponse>('/posters/tasks', {
    method: 'POST',
    body: JSON.stringify({ tasks: [newTask] }),
  });
  const newGenerationId = created.tasks[0]?.latestGeneration?.id;
  if (!newGenerationId) throw new Error('requeue 后未拿到新 generation id');
  return {
    jobId: newGenerationId,
    batchId: created.batchId,
    sourceDeleted: d.sourceDeleted,
  };
}

// 保留 generationToRow 给可能直接构造老 JobRow 的代码用
export const __internal_generationToRow = generationToRow;
