import { useEffect, useState } from "react";
import { loadPromoSkuSet, isPromoSku } from "@/components/shelves/services/promoSkus";
import { padSkuCode } from "@/components/shelves/lib/skuCode";

let sharedSet: Set<string> | null = null;
const listeners = new Set<(s: Set<string>) => void>();

function ensureLoaded() {
  if (sharedSet) return;
  loadPromoSkuSet().then((s) => {
    sharedSet = s;
    listeners.forEach((l) => l(s));
  });
}

export function usePromoSkuSet(): Set<string> | null {
  const [set, setSet] = useState<Set<string> | null>(sharedSet);
  useEffect(() => {
    if (sharedSet) {
      setSet(sharedSet);
      return;
    }
    const cb = (s: Set<string>) => setSet(s);
    listeners.add(cb);
    ensureLoaded();
    return () => { listeners.delete(cb); };
  }, []);
  return set;
}

export function useIsPromoSku(skuCode: string | null | undefined): boolean {
  const set = usePromoSkuSet();
  if (!set || !skuCode) return false;
  return set.has(padSkuCode(skuCode));
}

export { isPromoSku };
