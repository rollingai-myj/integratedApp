/**
 * 调改记录 API 客户端 — list / detail / CSV 下载。
 */
import { apiFetch } from './api';

export type ChangeAction = 'add' | 'remove';

export type ChangeReason =
  | 'ai_recommend_core'
  | 'ai_recommend_innovation'
  | 'low_sales'
  | 'competitor_replace'
  | 'shelf_space_limit'
  | 'manual_keep'
  | 'manual_remove'
  | 'other';

export const REASON_LABEL: Record<ChangeReason, string> = {
  ai_recommend_core: 'AI 推荐核心',
  ai_recommend_innovation: 'AI 推荐创新',
  low_sales: '销量低',
  competitor_replace: '竞品替代',
  shelf_space_limit: '货架限制',
  manual_keep: '人工保留',
  manual_remove: '人工下架',
  other: '其他',
};

export interface ChangeRow {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  skuCode: string;
  productName: string | null;
  brand: string | null;
  scene: number;
  sceneName: string | null;
  action: ChangeAction;
  reasonCode: ChangeReason;
  reasonText: string | null;
  effectiveDate: string;
  createdAt: string;
  createdByDisplay: string | null;
  adjustmentId: string | null;
  hasAiDiagnosis: boolean;
}

export interface ChangeDetail extends ChangeRow {
  aiDiagnosis: unknown;
  adjustment: {
    id: string;
    summaryText: string | null;
    addedCount: number;
    removedCount: number;
    triggeredAt: string;
    triggeredByDisplay: string | null;
  } | null;
}

export interface ChangesFilters {
  storeId?: string;
  scene?: number;
  action?: ChangeAction;
  from?: string;
  to?: string;
  search?: string;
  sortBy?: 'created_at' | 'effective_date';
  sortDir?: 'asc' | 'desc';
}

export interface ListChangesResult {
  items: ChangeRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface StoreOption {
  storeId: string;
  storeCode: string;
  storeName: string;
}

export interface SceneOption {
  scene: number;
  sceneName: string;
}

function buildQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const q = usp.toString();
  return q ? `?${q}` : '';
}

export async function fetchChanges(
  filters: ChangesFilters,
  page: number,
  pageSize: number,
): Promise<ListChangesResult> {
  return apiFetch<ListChangesResult>(
    `/admin/changes${buildQuery({ ...filters, page, pageSize })}`,
  );
}

export async function fetchChangeDetail(id: string): Promise<ChangeDetail> {
  return apiFetch<ChangeDetail>(`/admin/changes/${encodeURIComponent(id)}`);
}

export async function fetchStoreOptions(): Promise<StoreOption[]> {
  const res = await apiFetch<{ stores: StoreOption[] }>('/admin/changes-filters/stores');
  return res.stores;
}

export async function fetchSceneOptions(): Promise<SceneOption[]> {
  const res = await apiFetch<{ scenes: SceneOption[] }>('/admin/changes-filters/scenes');
  return res.scenes;
}

/** CSV 导出:浏览器直接走 <a> 跳到一个带筛选参数的 URL,后端发 attachment */
export function changesCsvUrl(filters: ChangesFilters): string {
  return `/api/v1/admin/changes.csv${buildQuery({ ...filters })}`;
}
