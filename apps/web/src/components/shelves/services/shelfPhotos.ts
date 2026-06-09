import { apiFetch } from "@/components/shelves/lib/api-client";

export async function fetchShelfPhotosByStore(storeId: string): Promise<Record<string, string>> {
  const res = await apiFetch(`/api/shelves/runtime?storeId=${encodeURIComponent(storeId)}`);
  const rows = (await res.json()) as { shelf_id: string; photo_url: string | null }[];
  const map: Record<string, string> = {};
  (rows || []).forEach((r) => { if (r.photo_url) map[r.shelf_id] = r.photo_url; });
  return map;
}
