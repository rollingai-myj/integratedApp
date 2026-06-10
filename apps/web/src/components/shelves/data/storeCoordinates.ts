/**
 * 门店经纬度 / 地址缓存
 *
 * 选品的"周边商圈洞察"（useEnvironmentInsight）和"调研问卷生成"（useShelfQuestions）
 * 都需要门店的高德 GCJ02 坐标去调 v5 around 拉周边 POI。原 skuSelection repo 走
 * `/api/skus/stores` 拿；整合 app 没那个端点，统一从 `/portal/stores` 取——后者本来
 * 就是登录后拉的"当前用户可访问的门店"，扩字段把 lat/lng/address 一起带回来，
 * 一次请求建好全店 cache。
 *
 * 使用方式：进入 shelves 模块时 AppShell 调一次 `loadStoreCoordinates()` 装 cache，
 * 之后 `getStoreCoordinates(storeId)` 同步返回 `"lng,lat"` 字符串（高德 v5 input 格式）。
 */
import { apiFetch } from "@/components/shelves/lib/api-client";
import type { StoreRef } from "@myj/shared";

let _coordCache: Record<string, string> = {};
let _addressCache: Record<string, string> = {};

/** 把 store_code 里的非数字剥掉（"粤32156" → "32156"）作为缓存 key */
function stripNonDigit(s: string): string {
  return String(s).replace(/\D/g, "");
}

export async function loadStoreCoordinates(): Promise<void> {
  try {
    const res = await apiFetch('/portal/stores');
    if (!res.ok) return;
    const data = (await res.json()) as { stores?: StoreRef[] };
    const coordMap: Record<string, string> = {};
    const addrMap: Record<string, string> = {};
    for (const s of data.stores ?? []) {
      const key = stripNonDigit(s.code);
      if (!key) continue;
      // 高德 v5 input 字段是 "lng,lat"（先经后纬）
      if (s.longitude != null && s.latitude != null) {
        coordMap[key] = `${s.longitude},${s.latitude}`;
      }
      if (s.address) addrMap[s.code] = s.address;
    }
    _coordCache = coordMap;
    _addressCache = addrMap;
  } catch {
    // 静默失败：下游 getStoreCoordinates 返回 undefined，调用方会抛"门店未配置经纬度"
    // 把错误暴露给用户而不是在这里假装成功（决策 D11 同款：失败要露出）
  }
}

export function getStoreCoordinates(storeId: string): string | undefined {
  if (!storeId) return undefined;
  return _coordCache[stripNonDigit(storeId)];
}

export function getStoreDbAddress(storeId: string): string | undefined {
  if (!storeId) return undefined;
  return _addressCache[storeId] || undefined;
}
