/**
 * Shim：兼容原 poster repo 的 @/lib/poster-jobs.functions
 *
 * 原 repo 用 poster_jobs 表实现异步生成队列（批量入队 → 后台认领 → 回填结果）。
 * 我们统一后端已有 /posters/queue/* 接口；本 A2 阶段 UI 暂时让队列流程"空跑"
 * （不入队、不显示活跃任务），等后续 PR 把队列 UI 完整接通后再回来接线。
 *
 * 类型形状（snake_case）必须与 components/posters/JobsContext 期望一致。
 */

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

export async function enqueuePosterJobs(
  _input: ServerFnInput<{ items: JobItemInput[] }>,
): Promise<{ batchId: string; jobIds: string[] }> {
  return { batchId: '', jobIds: [] };
}

export async function processPosterJob(
  _input?: ServerFnInput<{ jobId?: string }>,
): Promise<{ jobId: string | null; status: JobStatus | null }> {
  return { jobId: null, status: null };
}

export async function listMyActiveJobs(): Promise<{ jobs: JobRow[] }> {
  return { jobs: [] };
}

export async function dismissBatch(
  _input: ServerFnInput<{ batchId: string }>,
): Promise<{ ok: true }> {
  return { ok: true };
}

export async function resetStaleJob(
  _input: ServerFnInput<{ jobId: string }>,
): Promise<{ ok: true }> {
  return { ok: true };
}

export async function requeuePosterJob(
  _input: ServerFnInput<{
    jobId: string;
    styleId?: string;
    sourceDeleted?: boolean;
    batchId?: string;
    [k: string]: unknown;
  }>,
): Promise<{ jobId: string; batchId?: string; sourceDeleted?: boolean }> {
  return { jobId: '' };
}
