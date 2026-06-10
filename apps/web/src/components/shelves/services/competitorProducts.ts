/**
 * 竞品商品 shim —— 对接 /api/v1/master/competitors
 */
import { apiFetch } from '@/components/shelves/lib/api-client';

export interface CompetitorProductItem {
  channel: string;
  sku_name: string;
  spec: string;
  price: number | null;
}

interface BackendCompetitor {
  channelName?: string | null;
  productName?: string | null;
  spec?: string | null;
  latestPrice?: number | string | null;
}

export async function listCompetitorProductsByCategory(
  majorCategory: string,
): Promise<CompetitorProductItem[]> {
  const cat = (majorCategory || '').trim();
  if (!cat) return [];
  try {
    const res = await apiFetch(`/master/competitors?categoryPath=${encodeURIComponent(cat)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { competitors?: BackendCompetitor[] };
    return (data.competitors ?? []).map((r) => ({
      channel: r.channelName ?? '',
      sku_name: r.productName ?? '',
      spec: r.spec ?? '',
      price: r.latestPrice != null ? Number(r.latestPrice) : null,
    }));
  } catch {
    return [];
  }
}
