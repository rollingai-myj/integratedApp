import { apiFetch } from "@/components/shelves/lib/api-client";
import { QueryClient } from "@tanstack/react-query";

export interface ShelfRuntimeState {
  id: string;
  store_id: string;
  shelf_id: string;
  reset_version: number;
  photo_url: string | null;
  aligned_products: any;
  aligned_sub_categories: string[];
  diagnosis_data: any;
  strategies: any;
  updated_at: string;
}

export async function resetShelvesFullly(
  storeId: string,
  shelfIds: string[],
  queryClient?: QueryClient
) {
  for (const shelfId of shelfIds) {
    await apiFetch(`/api/shelves/runtime?storeId=${encodeURIComponent(storeId)}&shelfId=${encodeURIComponent(shelfId)}`, { method: 'DELETE' });
    if (queryClient) {
      queryClient.removeQueries({ queryKey: ["shelf_runtime_state", storeId, shelfId] });
      queryClient.removeQueries({ queryKey: ["shelf_photo", storeId, shelfId] });
      queryClient.removeQueries({ queryKey: ["shelf_alignment", storeId, shelfId] });
      queryClient.removeQueries({ queryKey: ["shelf_diagnosis", storeId, shelfId] });
      queryClient.removeQueries({ queryKey: ["shelf_strategies", storeId, shelfId] });
    }
  }
  if (queryClient) {
    queryClient.invalidateQueries({ queryKey: ["shelf_alignment_results_all", storeId] });
    queryClient.invalidateQueries({ queryKey: ["all_shelf_strategies", storeId] });
  }
}

export async function resetShelfDerived(
  storeId: string,
  shelfId: string,
  queryClient?: QueryClient
) {
  await apiFetch('/api/shelves/runtime/upsert', {
    method: 'POST',
    body: JSON.stringify({
      store_id: storeId,
      shelf_id: shelfId,
      reset_version: 1,
      aligned_products: null,
      aligned_sub_categories: [],
      diagnosis_data: null,
      strategies: null,
      virtual_shelf_layout: null,
    }),
  });

  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(`vsl:${storeId}:${shelfId}`);
    }
  } catch {}

  if (queryClient) {
    queryClient.removeQueries({ queryKey: ["shelf_runtime_state", storeId, shelfId] });
    queryClient.removeQueries({ queryKey: ["shelf_alignment", storeId, shelfId] });
    queryClient.removeQueries({ queryKey: ["shelf_diagnosis", storeId, shelfId] });
    queryClient.removeQueries({ queryKey: ["shelf_strategies", storeId, shelfId] });
    queryClient.invalidateQueries({ queryKey: ["shelf_alignment_results_all", storeId] });
    queryClient.invalidateQueries({ queryKey: ["all_shelf_strategies", storeId] });
  }

  return 1;
}

export async function getResetVersion(_storeId: string, _shelfId: string): Promise<number> {
  return 1;
}

export async function writeIfVersionMatches(
  storeId: string,
  shelfId: string,
  _expectedVersion: number,
  updates: Partial<Pick<ShelfRuntimeState, "photo_url" | "aligned_products" | "aligned_sub_categories" | "diagnosis_data" | "strategies">> & { virtual_shelf_layout?: any }
): Promise<boolean> {
  await apiFetch('/api/shelves/runtime/upsert', {
    method: 'POST',
    body: JSON.stringify({
      store_id: storeId,
      shelf_id: shelfId,
      ...updates,
      updated_at: new Date().toISOString(),
    }),
  });
  return true;
}

export async function upsertShelfPhoto(
  storeId: string,
  shelfId: string,
  photoUrl: string,
  queryClient?: QueryClient
): Promise<number> {
  const newVersion = await resetShelfDerived(storeId, shelfId, queryClient);

  await apiFetch('/api/shelves/runtime/upsert', {
    method: 'POST',
    body: JSON.stringify({
      store_id: storeId,
      shelf_id: shelfId,
      photo_url: photoUrl,
      reset_version: newVersion,
    }),
  });

  await apiFetch('/api/shelves/photos/upsert', {
    method: 'POST',
    body: JSON.stringify({ shelf_id: shelfId, photo_url: photoUrl, store_id: storeId }),
  });

  if (queryClient) {
    queryClient.setQueryData(["shelf_photo", storeId, shelfId], photoUrl);
    queryClient.invalidateQueries({ queryKey: ["shelf_runtime_state", storeId, shelfId] });
  }

  return newVersion;
}

export async function readShelfState(storeId: string, shelfId: string): Promise<ShelfRuntimeState | null> {
  const res = await apiFetch(
    `/api/shelves/runtime?storeId=${encodeURIComponent(storeId)}&shelfId=${encodeURIComponent(shelfId)}`
  );
  return (await res.json()) as ShelfRuntimeState | null;
}
