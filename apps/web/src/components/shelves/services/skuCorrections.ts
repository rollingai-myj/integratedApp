/**
 * SKU 勘误（shim）
 *
 * 后端 /shelves/errata 的 correction_kind enum = 'missed' | 'false_positive'（识别误差视角），
 * 与原 repo 的 'remove' | 'add'（选品决策视角）是两个语义空间。这里走 localStorage —
 * 选品流程内自循环，不进后端勘误库。后续要做超管审核时再加翻译层。
 */

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

const KEY = (storeId: string) => `sku_corrections_${storeId}`;

function readAll(storeId: string): SkuCorrection[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY(storeId));
    return raw ? (JSON.parse(raw) as SkuCorrection[]) : [];
  } catch {
    return [];
  }
}

function writeAll(storeId: string, rows: SkuCorrection[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY(storeId), JSON.stringify(rows));
  } catch (err) {
    console.warn('[shelves/skuCorrections.writeAll] failed', err);
  }
}

export async function listCorrectionsByStore(storeId: string): Promise<SkuCorrection[]> {
  if (!storeId) return [];
  return readAll(storeId);
}

export async function upsertCorrection(input: UpsertCorrectionInput): Promise<void> {
  if (!input.storeId || !input.skuCode) return;
  const all = readAll(input.storeId);
  const now = new Date().toISOString();
  const existingIdx = all.findIndex(
    (r) => r.sku_code === input.skuCode && r.correction_kind === input.correctionKind,
  );
  const row: SkuCorrection = {
    id: existingIdx >= 0 ? all[existingIdx].id : `${input.skuCode}-${input.correctionKind}-${Date.now()}`,
    store_id: input.storeId,
    sku_code: input.skuCode,
    sku_name: input.skuName,
    correction_kind: input.correctionKind,
    reason_code: input.reasonCode,
    reason_text: input.reasonText ?? '',
    shelf_id: input.shelfId ?? null,
    account: input.account ?? null,
    created_at: existingIdx >= 0 ? all[existingIdx].created_at : now,
    updated_at: now,
  };
  if (existingIdx >= 0) all[existingIdx] = row;
  else all.push(row);
  writeAll(input.storeId, all);
}
