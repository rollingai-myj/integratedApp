/**
 * 数据上传 API 客户端 — 3 个 kind 共用同一组接口。
 */
import { ApiError, apiFetch } from './api';

export type UploadKind = 'promotions' | 'products' | 'snapshots';

export type UploadStatus = 'staged' | 'applied' | 'failed' | 'rolled_back';

export interface ColumnDef {
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'integer' | 'date' | 'enum';
  enumValues?: string[];
  description: string;
  sample: string;
}

export interface ColumnSpec {
  kind: UploadKind;
  label: string;
  description: string;
  columns: ColumnDef[];
}

export interface UploadBatchSummary {
  id: string;
  kind: UploadKind;
  fileName: string;
  uploadedBy: string | null;
  uploadedByDisplay: string | null;
  status: UploadStatus;
  totalRows: number;
  validRows: number;
  errorRows: number;
  appliedAt: string | null;
  createdAt: string;
}

export interface RowError {
  row: number;
  col?: string;
  msg: string;
  raw?: string[];
}

export interface UploadBatchDetail extends UploadBatchSummary {
  parseErrors: RowError[];
  preview: Record<string, unknown>[];
  applySummary: Record<string, unknown>;
}

export interface UploadResult {
  batchId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
}

export async function fetchSpecs(): Promise<ColumnSpec[]> {
  const res = await apiFetch<{ specs: ColumnSpec[] }>('/admin/uploads/specs');
  return res.specs;
}

export function templateUrl(kind: UploadKind): string {
  return `/api/v1/admin/uploads/${kind}/template`;
}

/** 上传 CSV — multipart/form-data,字段名固定 'file' */
export async function uploadCsv(kind: UploadKind, file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  // 注意:multipart 不能用 apiFetch 默认的 Content-Type: application/json
  const res = await fetch(`/api/v1/admin/uploads/${kind}`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | null = null;
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } };
      if (body.error?.message) msg = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch { /* keep msg */ }
    throw new ApiError(msg, res.status, code);
  }
  return await res.json() as UploadResult;
}

export async function fetchBatches(kind: UploadKind): Promise<UploadBatchSummary[]> {
  const res = await apiFetch<{ batches: UploadBatchSummary[] }>(
    `/admin/uploads/${kind}/batches`,
  );
  return res.batches;
}

export async function fetchBatchDetail(id: string): Promise<UploadBatchDetail> {
  return apiFetch<UploadBatchDetail>(`/admin/uploads/batches/${encodeURIComponent(id)}`);
}

export async function deleteBatch(id: string): Promise<void> {
  await apiFetch<void>(`/admin/uploads/batches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface ApplySummary {
  inserted: number;
  updated: number;
  skipped: number;
  skipReasons: Array<{ row: number; reason: string }>;
}

export interface RollbackResult {
  reverted: number;
  warnings: string[];
}

export async function applyBatch(id: string): Promise<ApplySummary> {
  return apiFetch<ApplySummary>(
    `/admin/uploads/batches/${encodeURIComponent(id)}/apply`,
    { method: 'POST' },
  );
}

export async function rollbackBatchApi(id: string): Promise<RollbackResult> {
  return apiFetch<RollbackResult>(
    `/admin/uploads/batches/${encodeURIComponent(id)}/rollback`,
    { method: 'POST' },
  );
}

export const STATUS_LABEL: Record<UploadStatus, string> = {
  staged: '已暂存',
  applied: '已应用',
  failed: '校验失败',
  rolled_back: '已回滚',
};
