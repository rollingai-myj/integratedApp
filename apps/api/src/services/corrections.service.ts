/**
 * SKU 勘误反馈业务层
 *
 * V026 之后支持两个 scope：
 *   - 'detection'：识别勘误（漏检 / 误检），kind = missed | false_positive
 *   - 'decision'：选品决策勘误（不应撤场 / 不应上架），kind = remove | add
 *
 * 强制：scope 与 kind 必须配对，DB 层有 CHECK 约束；service 层提前校验返回
 * 400 而非让 DB 抛 23514。
 */
import { AppError, ErrorCodes } from '../lib/errors.js';
import { query } from '../db/index.js';

export type CorrectionScope = 'detection' | 'decision';
export type DetectionKind = 'missed' | 'false_positive';
export type DecisionKind = 'remove' | 'add';
export type CorrectionKind = DetectionKind | DecisionKind;

const DETECTION_REASONS = ['obstruction', 'low_resolution', 'new_sku', 'similar_packaging', 'other'] as const;
const DECISION_REASONS = ['stopped_purchase', 'vip_preferred', 'started_purchase', 'verified_low_sales', 'other'] as const;

export interface CorrectionRow {
  id: string;
  storeId: string;
  shelfId: string | null;
  productId: string | null;
  skuCode: string;
  correctionScope: CorrectionScope;
  correctionKind: CorrectionKind;
  reasonCode: string;
  reasonText: string | null;
  evidenceImageUrl: string | null;
  submittedBy: string | null;
  submittedAt: string;
  resolvedAt: string | null;
}

export async function listCorrections(
  storeId: string,
  args: { onlyPending?: boolean; scope?: CorrectionScope; skuCode?: string } = {},
): Promise<CorrectionRow[]> {
  const params: unknown[] = [storeId];
  const filters: string[] = ['store_id = $1'];
  if (args.onlyPending) filters.push('resolved_at IS NULL');
  if (args.scope) {
    params.push(args.scope);
    filters.push(`correction_scope = $${params.length}::sku_correction_scope`);
  }
  if (args.skuCode) {
    params.push(args.skuCode);
    filters.push(`sku_code = $${params.length}`);
  }
  const res = await query<{
    id: string;
    store_id: string;
    shelf_id: string | null;
    product_id: string | null;
    sku_code: string;
    correction_scope: CorrectionScope;
    correction_kind: CorrectionKind;
    reason_code: string;
    reason_text: string | null;
    evidence_image_url: string | null;
    submitted_by: string | null;
    submitted_at: string;
    resolved_at: string | null;
  }>(
    `SELECT id, store_id, shelf_id, product_id, sku_code, correction_scope, correction_kind,
            reason_code, reason_text, evidence_image_url, submitted_by,
            submitted_at, resolved_at
       FROM sku_corrections
      WHERE ${filters.join(' AND ')}
   ORDER BY submitted_at DESC`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    shelfId: r.shelf_id,
    productId: r.product_id,
    skuCode: r.sku_code,
    correctionScope: r.correction_scope,
    correctionKind: r.correction_kind,
    reasonCode: r.reason_code,
    reasonText: r.reason_text,
    evidenceImageUrl: r.evidence_image_url,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    resolvedAt: r.resolved_at,
  }));
}

export interface SubmitCorrectionInput {
  shelfCode?: string;
  skuCode: string;
  correctionScope?: CorrectionScope;  // 默认 'detection'（向后兼容）
  correctionKind: CorrectionKind;
  reasonCode?: string;
  reasonText?: string;
  evidenceImageUrl?: string;
}

export async function submitCorrection(
  storeId: string,
  input: SubmitCorrectionInput,
  userId: string,
): Promise<{ id: string }> {
  const scope: CorrectionScope = input.correctionScope ?? 'detection';
  // 强校验：scope 与 kind 必须配对
  if (scope === 'detection' && !['missed', 'false_positive'].includes(input.correctionKind)) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST,
      `scope=detection 时 correctionKind 只能是 missed/false_positive，传入 ${input.correctionKind}`);
  }
  if (scope === 'decision' && !['remove', 'add'].includes(input.correctionKind)) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST,
      `scope=decision 时 correctionKind 只能是 remove/add，传入 ${input.correctionKind}`);
  }

  let shelfId: string | null = null;
  if (input.shelfCode) {
    const cfg = await query<{ id: string }>(
      `SELECT id FROM store_shelf_config WHERE store_id = $1 AND shelf_code = $2 AND deleted_at IS NULL LIMIT 1`,
      [storeId, input.shelfCode],
    );
    shelfId = cfg.rows[0]?.id ?? null;
  }
  const prod = await query<{ id: string }>(
    `SELECT id FROM dim_product WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.skuCode],
  );
  const productId = prod.rows[0]?.id ?? null;
  const allowedReasons: readonly string[] =
    scope === 'detection' ? DETECTION_REASONS : DECISION_REASONS;
  const validReason = allowedReasons.includes(input.reasonCode ?? '') ? input.reasonCode : 'other';

  const res = await query<{ id: string }>(
    `INSERT INTO sku_corrections
       (store_id, shelf_id, product_id, sku_code, correction_scope, correction_kind, reason_code,
        reason_text, evidence_image_url, submitted_by)
     VALUES ($1, $2, $3, $4, $5::sku_correction_scope, $6::sku_correction_kind,
             $7::sku_correction_reason, $8, $9, $10)
     RETURNING id`,
    [
      storeId,
      shelfId,
      productId,
      input.skuCode,
      scope,
      input.correctionKind,
      validReason,
      input.reasonText ?? null,
      input.evidenceImageUrl ?? null,
      userId,
    ],
  );
  return { id: res.rows[0]!.id };
}
