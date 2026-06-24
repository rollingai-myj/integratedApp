/**
 * Dashboard 数据客户端 — 4 个聚合接口的 fetch + 类型。
 *
 * 全部走 GET /api/v1/admin/dashboard/*,后端按窗口期 days 聚合。
 */
import { apiFetch } from './api';

export interface KpiBlock {
  value: number;
  prevValue: number;
  delta: number;
}

export interface DashboardKpis {
  activeStores: KpiBlock;
  adjustedSkus: KpiBlock;
  posterTasks: KpiBlock;
  priceChanges: KpiBlock;
}

export interface TrendPoint {
  date: string;       // YYYY-MM-DD
  added: number;
  removed: number;
}

export interface TopStore {
  storeId: string;
  storeCode: string;
  storeName: string;
  totalChanges: number;
  addedCount: number;
  removedCount: number;
}

export interface SceneRow {
  scene: number;
  sceneName: string;
  count: number;
}

export async function fetchDashboardKpis(days: number): Promise<DashboardKpis> {
  return apiFetch<DashboardKpis>(`/admin/dashboard/kpis?days=${days}`);
}

export async function fetchAdjustmentTrend(days: number): Promise<TrendPoint[]> {
  const res = await apiFetch<{ points: TrendPoint[] }>(`/admin/dashboard/trend?days=${days}`);
  return res.points;
}

export async function fetchTopActiveStores(days: number, limit = 5): Promise<TopStore[]> {
  const res = await apiFetch<{ stores: TopStore[] }>(
    `/admin/dashboard/top-stores?days=${days}&limit=${limit}`,
  );
  return res.stores;
}

export async function fetchSceneDistribution(days: number): Promise<SceneRow[]> {
  const res = await apiFetch<{ scenes: SceneRow[] }>(`/admin/dashboard/scenes?days=${days}`);
  return res.scenes;
}
