/**
 * Shim：兼容原 poster repo 的 @/lib/poster-jobs.functions
 *
 * Phase 5 数据层切换：
 * 旧的 /posters/queue/* 路径已下线；统一后端走 task/generation 模型。
 * 这里把老 JobRow / batch / enqueue / process / reset / retry 形状映射到新 API：
 *   enqueue   → POST /posters/tasks          （建一批任务，每条返回 task + generation #1=queued）
 *   process   → POST /posters/generations:claim { generationId? }  （精确认领 + 同步执行）
 *   listActive→ GET  /posters/tasks?scope=mine&status=active        （含 latestGeneration）
 *   dismiss   → DELETE /posters/tasks/batch/:batchId
 *   reset     → 反查 task → POST /posters/tasks/:taskId/generations  （新 attempt 替代 reset）
 *   requeue   → 反查 task → POST /posters/tasks                     （新任务，patch 业务字段）
 *
 * 状态合并：
 *   claimed/processing → processing
 *   succeeded → done
 *   failed/canceled → error
 *   queued → queued
 *
 * 上层 JobsContext / screens 零修改。
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
 * 触发一个 worker：调后端 claim+process。
 * 后端是同步执行（OpenRouter 调用 ~30s），所以这个 Promise 完成 = 该 job 已 succeeded/failed。
 * 不传 jobId = worker 模式（认领下一条）；带 jobId = 精确认领（shim 同步语义）。
 * 没有可认领的任务时后端 204 → 返回 { jobId: null, status: null }。
 */
export async function processPosterJob(
  input?: ServerFnInput<{ jobId?: string }>,
): Promise<{ jobId: string | null; status: JobStatus | null }> {
  const body = input?.data?.jobId ? { generationId: input.data.jobId } : {};
  const res = await jsonFetch<{ generation: PosterGeneration } | undefined>(
    '/posters/generations:claim',
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res?.generation) return { jobId: null, status: null };
  return {
    jobId: res.generation.id,
    status: statusToFront(res.generation.status),
  };
}

export async function listMyActiveJobs(): Promise<{ jobs: JobRow[] }> {
  const res = await jsonFetch<ListPosterTasksResponse>(
    '/posters/tasks?scope=mine&status=active',
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
 * 老语义 reset = "卡死的 job 重回 queued"。
 * 新模型用新 attempt 替代（实际比 reset 更彻底）。
 */
export async function resetStaleJob(
  input: ServerFnInput<{ jobId: string }>,
): Promise<{ ok: true }> {
  const generationId = input.data.jobId;
  if (!UUID_RE.test(generationId)) return { ok: true };
  try {
    const ref = await jsonFetch<{
      generation: PosterGeneration;
      taskId: string;
      batchId: string;
    }>(`/posters/generations/${encodeURIComponent(generationId)}`);
    // 只对真卡住的状态做 regenerate；succeeded / queued 直接 noop
    if (ref.generation.status === 'claimed' || ref.generation.status === 'processing') {
      await jsonFetch(
        `/posters/tasks/${encodeURIComponent(ref.taskId)}/generations`,
        { method: 'POST' },
      );
    }
  } catch (err) {
    const msg = (err as Error).message;
    // 404 / 已结束态：静默
    if (!msg.includes('不在可重置状态') && !msg.includes('不存在')) throw err;
  }
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
