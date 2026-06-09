import { apiFetch } from "@/components/shelves/lib/api-client";

export type ShelfHistoryActionType =
  | "upload_photo"
  | "diagnose"
  | "optimize_selection"
  | "apply_strategy"
  | "generate_layout";

export const ACTION_LABEL_CN: Record<ShelfHistoryActionType, string> = {
  upload_photo: "上传图片",
  diagnose: "货架诊断",
  optimize_selection: "优化选品",
  apply_strategy: "应用策略",
  generate_layout: "生成示意图",
};

export function normalizeActionType(a: string | null | undefined): ShelfHistoryActionType {
  switch (a) {
    case "upload_photo": case "reupload": return "upload_photo";
    case "diagnose": case "re_diagnose": return "diagnose";
    case "optimize_selection": return "optimize_selection";
    case "apply_strategy": case "optimize": case "re_optimize": return "apply_strategy";
    case "generate_layout": case "re_generate_layout": return "generate_layout";
    default:
      if (a === "示意图完成") return "generate_layout";
      if (a === "优化完成") return "apply_strategy";
      if (a === "诊断完成") return "diagnose";
      if (a === "已上传") return "upload_photo";
      return "diagnose";
  }
}

export interface ShelfPhotoHistoryRow {
  id: string; store_id: string; shelf_id: string;
  photo_url: string | null; aligned_products: any;
  aligned_sub_categories: string[] | null; diagnosis_data: any;
  strategies: any; virtual_shelf_layout: any;
  action_type: string | null; status: string | null;
  applied_strategy_name: string | null; created_at: string;
}

function pickAppliedName(strategies: any): string | null {
  if (!Array.isArray(strategies)) return null;
  const applied = strategies.find((s: any) => s?.applied);
  return applied?.name || applied?.title || null;
}

export async function recordShelfHistory(
  storeId: string,
  shelfId: string,
  actionType: ShelfHistoryActionType,
): Promise<void> {
  const res = await apiFetch(
    `/api/shelves/runtime?storeId=${encodeURIComponent(storeId)}&shelfId=${encodeURIComponent(shelfId)}`
  );
  const state = await res.json() as any;
  if (!state) return;

  const label = ACTION_LABEL_CN[actionType];
  const applied_strategy_name = pickAppliedName(state.strategies);

  const histRes = await apiFetch(
    `/api/shelves/history?storeId=${encodeURIComponent(storeId)}&shelfId=${encodeURIComponent(shelfId)}`
  );
  const history = (await histRes.json()) as ShelfPhotoHistoryRow[];
  const latest = history[0] ?? null;

  if (latest && latest.action_type === actionType) {
    const same =
      latest.photo_url === state.photo_url &&
      JSON.stringify(latest.diagnosis_data ?? null) === JSON.stringify(state.diagnosis_data ?? null) &&
      JSON.stringify((latest as any).strategies ?? null) === JSON.stringify(state.strategies ?? null) &&
      JSON.stringify((latest as any).virtual_shelf_layout ?? null) === JSON.stringify(state.virtual_shelf_layout ?? null);
    if (same) return;
  }

  await apiFetch('/api/shelves/history', {
    method: 'POST',
    body: JSON.stringify({
      store_id: storeId, shelf_id: shelfId,
      photo_url: state.photo_url,
      aligned_products: state.aligned_products,
      aligned_sub_categories: state.aligned_sub_categories ?? [],
      diagnosis_data: state.diagnosis_data,
      strategies: state.strategies ?? null,
      virtual_shelf_layout: state.virtual_shelf_layout ?? null,
      action_type: actionType, status: label, applied_strategy_name,
    }),
  });

  try {
    const { logUsage } = await import("./usageLogs");
    await logUsage({ storeId, shelfId, actionType, actionLabel: label });
  } catch (e) {
    console.warn("[history] usage log failed", e);
  }
}

export async function hasPriorAction(
  _storeId: string, _shelfId: string, _baseActions: string[],
): Promise<boolean> { return false; }

export async function archiveShelfStateToHistory(storeId: string, shelfId: string): Promise<void> {
  const res = await apiFetch(
    `/api/shelves/runtime?storeId=${encodeURIComponent(storeId)}&shelfId=${encodeURIComponent(shelfId)}`
  );
  const state = await res.json() as { photo_url?: string } | null;
  if (!state?.photo_url) return;
  await recordShelfHistory(storeId, shelfId, "upload_photo");
}

export async function fetchShelfHistory(storeId: string, shelfId: string): Promise<ShelfPhotoHistoryRow[]> {
  const res = await apiFetch(
    `/api/shelves/history?storeId=${encodeURIComponent(storeId)}&shelfId=${encodeURIComponent(shelfId)}`
  );
  return ((await res.json()) || []) as ShelfPhotoHistoryRow[];
}
