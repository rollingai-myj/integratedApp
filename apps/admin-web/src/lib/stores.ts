/**
 * 门店档案 API 客户端 — 列表 / 详情 / 编辑(给 /stores 页用)
 *
 * 注意跟 admin-uploads 那套是分开的:这个走 /admin/stores 直连业务表,
 * 单店实时编辑;CSV 批量上传走 /admin/uploads/stores 的 staging 流程。
 */
import { apiFetch } from './api';

export type StoreStatus = 'active' | 'disabled';

export interface StoreDetail {
  id: string;
  storeCode: string;
  storeName: string;
  province: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openedAt: string | null;
  status: StoreStatus;
  isProjectStore: boolean;
  storeAreaSqm: number | null;
  poiCategory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListStoresParams {
  search?: string;
  status?: StoreStatus;
  page?: number;
  pageSize?: number;
}

export interface ListStoresResult {
  rows: StoreDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StorePatch {
  storeCode?: string;
  storeName?: string;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openedAt?: string | null;
  status?: StoreStatus;
  isProjectStore?: boolean;
  storeAreaSqm?: number | null;
  poiCategory?: string | null;
}

export interface CreateStoreInput {
  storeCode: string;
  storeName: string;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openedAt?: string | null;
  status?: StoreStatus;
  isProjectStore?: boolean;
  storeAreaSqm?: number | null;
  poiCategory?: string | null;
}

function buildQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export async function fetchStores(params: ListStoresParams = {}): Promise<ListStoresResult> {
  return apiFetch<ListStoresResult>(`/admin/stores${buildQuery({ ...params })}`);
}

export async function patchStore(id: string, patch: StorePatch): Promise<StoreDetail> {
  return apiFetch<StoreDetail>(`/admin/stores/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function createStore(input: CreateStoreInput): Promise<StoreDetail> {
  return apiFetch<StoreDetail>(`/admin/stores`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteStore(id: string): Promise<void> {
  await apiFetch<void>(`/admin/stores/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  active: '在用',
  disabled: '已停用',
};
