/**
 * 上传 / 解析 / 落 staging / 历史列表 / 详情
 *
 * 流程:
 *   1. multer 把文件读进 buffer(已在 route 层处理)
 *   2. parseCsv 把 buffer → string[][]
 *   3. 第一行当 headers,检查必需列都在
 *   4. 后续每行 parseRow → ok | errors
 *   5. 把成功行存到 staging_data,失败行的错误清单存到 parse_errors(最多 200 条)
 *   6. 写一行 upload_batches,status='staged'
 *
 * 不做的事(后续 PR):
 *   - 实际应用到业务表(hq_products / store_sku_snapshots / hq_promo_offers)
 *   - FK lookup(store_code → store_id 等)— 应用时再做
 *   - 回滚
 */
import { query, withTransaction } from '../../db/index.js';
import { AppError, ErrorCodes } from '../../lib/errors.js';
import { parseCsv } from './csv-parser.js';
import {
  parseRow,
  specOf,
  type RowError,
  type UploadKind,
} from './schemas.js';

const MAX_ROWS = 50_000;
const MAX_ERRORS_RETAINED = 200;

export type UploadStatus = 'staged' | 'applied' | 'failed' | 'rolled_back';

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

export interface UploadBatchDetail extends UploadBatchSummary {
  parseErrors: RowError[];
  /** 解析成功的行预览(最多前 20 条),完整数据存在 DB jsonb,这里不返还 */
  preview: Record<string, unknown>[];
  applySummary: Record<string, unknown>;
}

interface UploadBatchRow {
  id: string;
  kind: UploadKind;
  file_name: string;
  uploaded_by: string | null;
  uploaded_by_display: string | null;
  status: UploadStatus;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  parse_errors: RowError[];
  staging_data: Record<string, unknown>[];
  apply_summary: Record<string, unknown>;
  applied_at: string | null;
  created_at: string;
}

// =============================================================================
// 上传 → 解析 → 落 staging
// =============================================================================

export interface UploadResult {
  batchId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
}

export async function uploadAndStage(args: {
  kind: UploadKind;
  fileName: string;
  buffer: Buffer;
  uploadedBy: string;
}): Promise<UploadResult> {
  const text = args.buffer.toString('utf-8');
  const rows = parseCsv(text);

  if (rows.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '文件是空的,请检查后重新上传');
  }
  if (rows.length > MAX_ROWS + 1) {
    throw new AppError(
      400,
      ErrorCodes.BAD_REQUEST,
      `文件行数过多,单次最多 ${MAX_ROWS.toLocaleString()} 行,请拆分后再上传`,
    );
  }

  const headers = rows[0]!.map((h) => h.trim());
  const dataRows = rows.slice(1);

  // 验证表头:必填列是否齐全(allow 多列、缺非必填、可不同顺序)
  const spec = specOf(args.kind);
  const headerSet = new Set(headers);
  for (const col of spec.columns) {
    if (col.required && !headerSet.has(col.name)) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        `文件第一行缺少必填的列「${col.name}」,请下载模板对照后再上传`,
      );
    }
  }

  const staged: Record<string, unknown>[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // 表头算第 1 行
    const result = parseRow(args.kind, headers, dataRows[i]!, rowNumber);
    if (result.ok) {
      staged.push(result.data);
    } else {
      // 同一行多列错误都保留;只对总数封顶
      for (const e of result.errors) {
        if (errors.length < MAX_ERRORS_RETAINED) errors.push(e);
      }
    }
  }

  const totalRows = dataRows.length;
  const validRows = staged.length;
  const errorRows = totalRows - validRows;

  // 全部失败 → 状态 failed,staging_data 为空
  // 部分失败 / 全部成功 → 状态 staged
  const status: UploadStatus = validRows === 0 ? 'failed' : 'staged';

  const insertRes = await query<{ id: string }>(
    `INSERT INTO upload_batches
       (kind, file_name, uploaded_by, status, total_rows, valid_rows, error_rows,
        parse_errors, staging_data)
     VALUES ($1::upload_kind, $2, $3, $4::upload_status, $5, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING id`,
    [
      args.kind,
      args.fileName,
      args.uploadedBy,
      status,
      totalRows,
      validRows,
      errorRows,
      JSON.stringify(errors),
      JSON.stringify(staged),
    ],
  );

  return {
    batchId: insertRes.rows[0]!.id,
    totalRows,
    validRows,
    errorRows,
  };
}

// =============================================================================
// 列表 + 详情
// =============================================================================

export async function listBatches(kind: UploadKind, limit = 50): Promise<UploadBatchSummary[]> {
  const res = await query<{
    id: string;
    kind: UploadKind;
    file_name: string;
    uploaded_by: string | null;
    uploaded_by_display: string | null;
    status: UploadStatus;
    total_rows: number;
    valid_rows: number;
    error_rows: number;
    applied_at: string | null;
    created_at: string;
  }>(
    `SELECT b.id,
            b.kind,
            b.file_name,
            b.uploaded_by,
            u.display_name AS uploaded_by_display,
            b.status,
            b.total_rows, b.valid_rows, b.error_rows,
            b.applied_at::text AS applied_at,
            b.created_at::text AS created_at
       FROM upload_batches b
       LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE b.kind = $1::upload_kind
      ORDER BY b.created_at DESC
      LIMIT $2`,
    [kind, limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    fileName: r.file_name,
    uploadedBy: r.uploaded_by,
    uploadedByDisplay: r.uploaded_by_display,
    status: r.status,
    totalRows: r.total_rows,
    validRows: r.valid_rows,
    errorRows: r.error_rows,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
  }));
}

export async function getBatchDetail(id: string): Promise<UploadBatchDetail | null> {
  const res = await query<UploadBatchRow>(
    `SELECT b.id, b.kind, b.file_name,
            b.uploaded_by,
            u.display_name AS uploaded_by_display,
            b.status,
            b.total_rows, b.valid_rows, b.error_rows,
            b.parse_errors, b.staging_data, b.apply_summary,
            b.applied_at::text AS applied_at,
            b.created_at::text AS created_at
       FROM upload_batches b
       LEFT JOIN users u ON u.id = b.uploaded_by
      WHERE b.id = $1
      LIMIT 1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    fileName: r.file_name,
    uploadedBy: r.uploaded_by,
    uploadedByDisplay: r.uploaded_by_display,
    status: r.status,
    totalRows: r.total_rows,
    validRows: r.valid_rows,
    errorRows: r.error_rows,
    parseErrors: r.parse_errors,
    preview: r.staging_data.slice(0, 20),
    applySummary: r.apply_summary,
    appliedAt: r.applied_at,
    createdAt: r.created_at,
  };
}

// =============================================================================
// 删除 staged 批次(误传后清掉)
// =============================================================================

export async function deleteStagedBatch(id: string): Promise<void> {
  // 只允许删 staged / failed 状态;applied 状态不能删(数据已落业务表)
  await withTransaction(async (client) => {
    const r = await client.query<{ status: UploadStatus }>(
      `SELECT status FROM upload_batches WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (r.rows.length === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '该批次不存在');
    }
    const status = r.rows[0]!.status;
    if (status !== 'staged' && status !== 'failed') {
      throw new AppError(
        409,
        ErrorCodes.CONFLICT,
        '已生效的批次不能直接删除,如需撤销请先点「撤销」',
      );
    }
    await client.query(`DELETE FROM upload_batches WHERE id = $1`, [id]);
  });
}
