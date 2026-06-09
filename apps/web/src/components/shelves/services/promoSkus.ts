import { apiFetch } from '@/components/shelves/lib/api-client';
import { padSkuCode } from '@/components/shelves/lib/skuCode';

let cache: Promise<Set<string>> | null = null;

export function loadPromoSkuSet(): Promise<Set<string>> {
  if (cache) return cache;
  cache = (async () => {
    const set = new Set<string>();
    try {
      const res = await apiFetch('/master/promotion-skus');
      const data = (await res.json()) as { skus?: string[] };
      for (const code of data.skus ?? []) set.add(padSkuCode(code));
    } catch (e) {
      console.warn('[shelves/promoSkus] load failed', e);
      cache = null;
    }
    return set;
  })();
  return cache;
}

export function resetPromoSkuCache(): void {
  cache = null;
}

export function isPromoSku(set: Set<string> | null | undefined, skuCode: string): boolean {
  if (!set) return false;
  return set.has(padSkuCode(skuCode));
}
