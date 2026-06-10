import { apiFetch } from "@/components/shelves/lib/api-client";

let _coordCache: Record<string, string> = {};
let _addressCache: Record<string, string> = {};

export async function loadStoreCoordinates(): Promise<void> {
  try {
    const res = await apiFetch('/api/skus/stores');
    const stores: { store_id: string; coordinates?: string; address?: string }[] = await res.json();
    const coordMap: Record<string, string> = {};
    const addrMap: Record<string, string> = {};
    for (const s of stores) {
      const numId = String(s.store_id).replace(/\D/g, '');
      if (s.coordinates) coordMap[numId] = s.coordinates;
      if (s.address) addrMap[s.store_id] = s.address;
    }
    _coordCache = coordMap;
    _addressCache = addrMap;
  } catch {
    // keep empty
  }
}

export function getStoreCoordinates(storeId: string): string | undefined {
  if (!storeId) return undefined;
  return _coordCache[String(storeId).replace(/\D/g, "")];
}

export function getStoreDbAddress(storeId: string): string | undefined {
  if (!storeId) return undefined;
  return _addressCache[storeId] || undefined;
}
