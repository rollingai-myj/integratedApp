/**
 * SKU 勘误（V026 之后真正接 backend）
 *
 * 维度：原 repo 是"选品决策勘误"语义（店长说"不应撤场"或"应该上架"）—— 即
 * scope='decision'，kind='remove'/'add'。和后端原有的 scope='detection'
 * （识别误差）共用 sku_corrections 表，由 V026 加的 correction_scope 列区分。
 *
 * Backend：
 *   GET  /api/v1/shelves/errata?scope=decision           → 当前店全部决策勘误
 *   POST /api/v1/shelves/errata { correctionScope, correctionKind, ... }
 *
 * shelfCode 翻译："pos-{N}-i" 直接当 shelf_code 上送；"pos-{N}" 场景级 → 后端
 * resolveShelfId 找不到时 shelf_id 留 null，记录仍能落库（关联到 store 维度）。
 */
import { apiFetch } from '@/components/shelves/lib/api-client';

export type CorrectionKind = 'remove' | 'add';
export type CorrectionReasonCode =
  | 'stopped_purchase'
  | 'vip_preferred'
  | 'started_purchase'
  | 'verified_low_sales'
  | 'other';

export interface SkuCorrection {
  id: string;
  store_id: string;
  sku_code: string;
  sku_name: string;
  correction_kind: CorrectionKind;
  reason_code: CorrectionReasonCode;
  reason_text: string;
  shelf_id: string | null;
  account: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertCorrectionInput {
  storeId: string;
  skuCode: string;
  skuName: string;
  correctionKind: CorrectionKind;
  reasonCode: CorrectionReasonCode;
  reasonText?: string;
  shelfId?: string | null;
  account?: string | null;
}

interface BackendCorrection {
  id: string;
  storeId: string;
  shelfId: string | null;
  productId: string | null;
  skuCode: string;
  correctionScope: 'detection' | 'decision';
  correctionKind: 'missed' | 'false_positive' | 'remove' | 'add';
  reasonCode: string;
  reasonText: string | null;
  evidenceImageUrl: string | null;
  submittedBy: string | null;
  submittedAt: string;
  resolvedAt: string | null;
}

function isDecisionKind(k: string): k is CorrectionKind {
  return k === 'remove' || k === 'add';
}

export async function listCorrectionsByStore(_storeCode: string): Promise<SkuCorrection[]> {
  try {
    const res = await apiFetch('/shelves/errata?scope=decision');
    if (!res.ok) return [];
    const data = (await res.json()) as { corrections?: BackendCorrection[] };
    return (data.corrections ?? [])
      .filter((c) => isDecisionKind(c.correctionKind))
      .map((c) => ({
        id: c.id,
        store_id: c.storeId,
        sku_code: c.skuCode,
        // backend 不存 sku_name；后端可后续 join dim_product。临时显示 sku_code
        sku_name: c.skuCode,
        correction_kind: c.correctionKind as CorrectionKind,
        reason_code: (c.reasonCode as CorrectionReasonCode) ?? 'other',
        reason_text: c.reasonText ?? '',
        shelf_id: c.shelfId,
        account: c.submittedBy,
        created_at: c.submittedAt,
        updated_at: c.submittedAt,
      }));
  } catch (err) {
    console.warn('[shelves/skuCorrections.list] failed', err);
    return [];
  }
}

export async function upsertCorrection(input: UpsertCorrectionInput): Promise<void> {
  if (!input.storeId || !input.skuCode) return;
  const res = await apiFetch('/shelves/errata', {
    method: 'POST',
    body: JSON.stringify({
      shelfCode: input.shelfId ?? undefined,
      skuCode: input.skuCode,
      correctionScope: 'decision',
      correctionKind: input.correctionKind,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText ?? input.skuName,
    }),
  });
  if (!res.ok) throw new Error(`upsertCorrection failed: ${await res.text()}`);
}
