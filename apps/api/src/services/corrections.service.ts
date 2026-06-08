/**
 * SKU 勘误反馈业务层
 */
import { query } from '../db/index.js';

export interface CorrectionRow {
  id: string;
  storeId: string;
  shelfId: string | null;
  productId: string | null;
  skuCode: string;
  correctionKind: 'missed' | 'false_positive';
  reasonCode: string;
  reasonText: string | null;
  evidenceImageUrl: string | null;
  submittedBy: string | null;
  submittedAt: string;
  resolvedAt: string | null;
}

export async function listCorrections(
  storeId: string,
  args: { onlyPending?: boolean } = {},
): Promise<CorrectionRow[]> {
  const params: unknown[] = [storeId];
  const filters: string[] = ['store_id = $1'];
  if (args.onlyPending) {
    filters.push('resolved_at IS NULL');
  }
  const res = await query<{
    id: string;
    store_id: string;
    shelf_id: string | null;
    product_id: string | null;
    sku_code: string;
    correction_kind: 'missed' | 'false_positive';
    reason_code: string;
    reason_text: string | null;
    evidence_image_url: string | null;
    submitted_by: string | null;
    submitted_at: string;
    resolved_at: string | null;
  }>(
    `SELECT id, store_id, shelf_id, product_id, sku_code, correction_kind,
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
  correctionKind: 'missed' | 'false_positive';
  reasonCode?: string;
  reasonText?: string;
  evidenceImageUrl?: string;
}

export async function submitCorrection(
  storeId: string,
  input: SubmitCorrectionInput,
  userId: string,
): Promise<{ id: string }> {
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
  const validReason = [
    'obstruction',
    'low_resolution',
    'new_sku',
    'similar_packaging',
    'other',
  ].includes(input.reasonCode ?? '')
    ? input.reasonCode
    : 'other';

  const res = await query<{ id: string }>(
    `INSERT INTO sku_corrections
       (store_id, shelf_id, product_id, sku_code, correction_kind, reason_code,
        reason_text, evidence_image_url, submitted_by)
     VALUES ($1, $2, $3, $4, $5::sku_correction_kind, $6::sku_correction_reason,
             $7, $8, $9)
     RETURNING id`,
    [
      storeId,
      shelfId,
      productId,
      input.skuCode,
      input.correctionKind,
      validReason,
      input.reasonText ?? null,
      input.evidenceImageUrl ?? null,
      userId,
    ],
  );
  return { id: res.rows[0]!.id };
}
