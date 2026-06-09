/**
 * Shim：兼容原 poster repo 引用的 @/lib/promotions.functions
 *
 * 老 repo 这套是超管侧的促销批次管理（上传 / 列表 / 激活 / 删除 / 推荐）。
 * 整合后超管功能去 apps/admin（暂未实现），店长侧只需要"读当前生效批次 + 推荐"。
 *
 * 这里把店长真正会用的 `getPersonalizedPromotions` 实现成调统一后端的
 * `/promotions/recommend`（按近 30 天用户海报品类偏好排序）+ 重新整形成
 * 原 repo 期望的 `{ upload, categories }` 结构，poster-app 子树零修改。
 *
 * 其它超管 API（listUploads/activateUpload/deleteUpload）poster-app 店长流程
 * 不调，留空导出以满足 TS 解析即可。
 */
import type {
  ActivePromotionsResponse,
  ProductPromotion,
} from '@myj/shared';
import { mapCategoryToGroup } from '@/lib/categoryGroups';

const BASE = '/api/v1';

interface CategoryItem {
  sku: string;
  product_name: string;
  unit?: string | null;
  original_price?: number | null;
  category?: string | null;
  best_label?: string | null;
  best_qty?: number | null;
  best_total?: number | null;
  best_effective_price?: number | null;
  best_saving_percent?: number | null;
  display_text?: string | null;
  best_valid_from?: string | null;
  best_valid_to?: string | null;
  best_valid_dates?: string[] | null;
  is_group?: boolean;
}

export interface PersonalizedPromotionsResult {
  upload: { id: string; filename: string; created_at: string } | null;
  categories: Array<{ name: string; items: CategoryItem[] }>;
}

function rowToCategoryItem(p: ProductPromotion): CategoryItem {
  return {
    sku: p.skuCode,
    product_name: p.productName,
    unit: undefined,
    original_price: p.originalPrice ?? null,
    category: p.categoryName ?? null,
    best_label: p.bestLabel ?? null,
    best_qty: null,
    best_total: p.bestTotalPrice ?? null,
    best_effective_price: null,
    best_saving_percent: p.bestSavingPercent ?? null,
    display_text: p.displayText ?? null,
    best_valid_from: p.validFrom ?? null,
    best_valid_to: p.validTo ?? null,
    best_valid_dates: null,
  };
}

export async function getPersonalizedPromotions(): Promise<PersonalizedPromotionsResult> {
  try {
    // 优先走 /promotions/recommend（按个性化排序）；空 → fallback /promotions/active
    let products: ProductPromotion[] = [];
    let upload: { id: string; filename: string; created_at: string } | null = null;

    const recoRes = await fetch(`${BASE}/promotions/recommend`, { credentials: 'include' });
    if (recoRes.ok) {
      const body = (await recoRes.json()) as { products?: ProductPromotion[]; upload?: { id: string; fileName: string; createdAt: string } };
      products = body.products ?? [];
      if (body.upload) {
        upload = { id: body.upload.id, filename: body.upload.fileName, created_at: body.upload.createdAt };
      }
    }
    if (products.length === 0) {
      const actRes = await fetch(`${BASE}/promotions/active`, { credentials: 'include' });
      if (actRes.ok) {
        const body = (await actRes.json()) as ActivePromotionsResponse;
        products = body.products ?? [];
        if (body.upload) {
          upload = { id: body.upload.id, filename: body.upload.fileName, created_at: body.upload.createdAt };
        }
      }
    }

    // 按品类分组（mapCategoryToGroup 沿用老 repo 的归类规则）
    const byCategory = new Map<string, CategoryItem[]>();
    for (const p of products) {
      const item = rowToCategoryItem(p);
      const groupName = mapCategoryToGroup(item.category ?? '');
      if (!byCategory.has(groupName)) byCategory.set(groupName, []);
      byCategory.get(groupName)!.push(item);
    }

    const categories = Array.from(byCategory.entries()).map(([name, items]) => ({
      name,
      items,
    }));

    return { upload, categories };
  } catch (err) {
    console.error('[promotions shim] getPersonalizedPromotions failed:', err);
    return { upload: null, categories: [] };
  }
}

// 占位：超管侧 API，店长流程不调，仅保留 import 路径兼容
export async function listUploads(): Promise<{ uploads: [] }> {
  return { uploads: [] };
}
export async function activateUpload(): Promise<{ ok: true }> {
  return { ok: true };
}
export async function getActivePromotions(): Promise<PersonalizedPromotionsResult> {
  return getPersonalizedPromotions();
}
export async function deleteUpload(): Promise<{ ok: true }> {
  return { ok: true };
}
export async function setActiveUpload(): Promise<{ ok: true }> {
  return { ok: true };
}
