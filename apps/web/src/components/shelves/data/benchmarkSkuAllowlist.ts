import { apiFetch } from "@/components/shelves/lib/api-client";

// Flat set of allowlisted sku_codes; major_category is derived from sku data itself
let cache: Set<string> | null = null;

export async function loadBenchmarkAllowlist(): Promise<void> {
  if (cache) return;
  try {
    const res = await apiFetch('/api/skus/benchmark-allowlist');
    const entries: { sku_code: string }[] = await res.json();
    cache = new Set(entries.map(e => String(e.sku_code).trim()));
  } catch {
    cache = new Set();
  }
}

/** Returns the flat set of allowlisted SKU codes, or null if the allowlist is empty/not loaded. */
export const getBenchmarkAllowlistSet = (): Set<string> | null => {
  return cache && cache.size > 0 ? cache : null;
};
