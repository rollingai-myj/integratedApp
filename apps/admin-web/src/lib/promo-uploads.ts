/**
 * 活动数据(promo)xlsx 上传客户端 — 接现有 promo 工作流。
 *
 * 跟 admin-uploads(products/snapshots)是两套独立体系:
 *   - promo 用 hq_promo_batches / hq_promo_raw_items / hq_promo_offers,xlsx parser
 *     拆 5 个 sheet → 库内联表;每次上传会把所有未作废批次置为 voided(全量替换)
 *   - admin-uploads 用 upload_batches(staging → apply),CSV 一表一上传
 */
import { ApiError, apiFetch } from './api';

export interface PromoBatch {
  id: string;
  fileName: string;
  uploadedBy: string | null;
  isVoided: boolean;
  activityWindowStart: string | null;
  activityWindowEnd: string | null;
  parseWarnings: Array<{ sheet: string; row: number; reason: string }>;
  rowTotal: Record<string, number>;
  parsedTotal: Record<string, number>;
  parsedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface RawPromoBatch {
  id: string;
  fileName?: string;
  file_name?: string;
  uploadedBy?: string | null;
  uploaded_by?: string | null;
  isVoided?: boolean;
  is_voided?: boolean;
  activityWindowStart?: string | null;
  activity_window_start?: string | null;
  activityWindowEnd?: string | null;
  activity_window_end?: string | null;
  parseWarnings?: Array<{ sheet: string; row: number; reason: string }>;
  parse_warnings?: Array<{ sheet: string; row: number; reason: string }>;
  rowTotal?: Record<string, number>;
  row_total?: Record<string, number>;
  parsedTotal?: Record<string, number>;
  parsed_total?: Record<string, number>;
  parsedAt?: string | null;
  parsed_at?: string | null;
  notes?: string | null;
  createdAt?: string;
  created_at?: string;
}

function normalize(b: RawPromoBatch): PromoBatch {
  return {
    id: b.id,
    fileName: b.fileName ?? b.file_name ?? '',
    uploadedBy: b.uploadedBy ?? b.uploaded_by ?? null,
    isVoided: b.isVoided ?? b.is_voided ?? false,
    activityWindowStart: b.activityWindowStart ?? b.activity_window_start ?? null,
    activityWindowEnd: b.activityWindowEnd ?? b.activity_window_end ?? null,
    parseWarnings: b.parseWarnings ?? b.parse_warnings ?? [],
    rowTotal: b.rowTotal ?? b.row_total ?? {},
    parsedTotal: b.parsedTotal ?? b.parsed_total ?? {},
    parsedAt: b.parsedAt ?? b.parsed_at ?? null,
    notes: b.notes ?? null,
    createdAt: b.createdAt ?? b.created_at ?? '',
  };
}

export async function uploadPromoXlsx(file: File): Promise<{ batch: PromoBatch; warnings: PromoBatch['parseWarnings'] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/v1/promotions/batches:upload', {
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
  const body = await res.json() as { batch: RawPromoBatch; warnings?: PromoBatch['parseWarnings'] };
  return {
    batch: normalize(body.batch),
    warnings: body.warnings ?? body.batch.parseWarnings ?? body.batch.parse_warnings ?? [],
  };
}

export async function fetchPromoBatches(): Promise<PromoBatch[]> {
  const res = await apiFetch<{ batches: RawPromoBatch[] }>('/promotions/batches');
  return res.batches.map(normalize);
}

export async function voidPromoBatch(batchId: string): Promise<void> {
  await apiFetch<unknown>(`/promotions/batches/${encodeURIComponent(batchId)}/void`, { method: 'POST' });
}

export async function unvoidPromoBatch(batchId: string): Promise<void> {
  await apiFetch<unknown>(`/promotions/batches/${encodeURIComponent(batchId)}/unvoid`, { method: 'POST' });
}

export async function deletePromoBatch(batchId: string): Promise<void> {
  await apiFetch<unknown>(`/promotions/batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' });
}
