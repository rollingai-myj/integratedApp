/**
 * Dashboard 聚合查询(admin-web 用)
 *
 * 4 个端点的数据源 — 都用窗口期参数 days,默认 30:
 *   - getDashboardKpis     → 4 张 KPI 卡片 + 上一窗口的环比
 *   - getAdjustmentTrend   → 按天聚合调改 added/removed
 *   - getTopActiveStores   → 调改活跃度 Top N(SKU 总数)
 *   - getSceneDistribution → 按场景维度的调改 SKU 占比
 *
 * 所有查询从 `store_assortment_changes` / `store_poster_tasks` /
 * `store_price_changes` 三张事件表聚合;窗口期用 `effective_date` 而非
 * `created_at`(后者是入库时间,前者是业务生效日)— 但海报 / 价格变更
 * 没有 effective_date,统一用 created_at。
 */
import { query } from '../db/index.js';

// =============================================================================
// 1) KPI 4 张卡片
// =============================================================================

export interface DashboardKpis {
  /** 活跃门店:在窗口期内至少有一条调改的门店数 */
  activeStores: { value: number; prevValue: number; delta: number };
  /** 调改 SKU 总数(条数,不去重) */
  adjustedSkus: { value: number; prevValue: number; delta: number };
  /** 海报生成总量 */
  posterTasks: { value: number; prevValue: number; delta: number };
  /** 价格调整次数 */
  priceChanges: { value: number; prevValue: number; delta: number };
}

export async function getDashboardKpis(days: number): Promise<DashboardKpis> {
  // 4 个指标 × 两个窗口(本期 + 上一期)= 8 个 count,用一条 SQL 出
  // 注:海报 + 价格变更没有 effective_date,统一用 created_at;调改用 effective_date
  const res = await query<{
    active_stores_cur: string; active_stores_prev: string;
    sku_cur: string;          sku_prev: string;
    posters_cur: string;      posters_prev: string;
    prices_cur: string;       prices_prev: string;
  }>(
    `WITH params AS (
       SELECT
         ($1::int                 || ' days')::interval AS d,
         (($1::int * 2)::text     || ' days')::interval AS d2
     )
     SELECT
       (SELECT count(DISTINCT store_id)::text FROM store_assortment_changes, params
          WHERE effective_date >= (CURRENT_DATE - d))                                AS active_stores_cur,
       (SELECT count(DISTINCT store_id)::text FROM store_assortment_changes, params
          WHERE effective_date >= (CURRENT_DATE - d2)
            AND effective_date <  (CURRENT_DATE - d))                                AS active_stores_prev,
       (SELECT count(*)::text FROM store_assortment_changes, params
          WHERE effective_date >= (CURRENT_DATE - d))                                AS sku_cur,
       (SELECT count(*)::text FROM store_assortment_changes, params
          WHERE effective_date >= (CURRENT_DATE - d2)
            AND effective_date <  (CURRENT_DATE - d))                                AS sku_prev,
       (SELECT count(*)::text FROM store_poster_tasks, params
          WHERE created_at >= (now() - d))                                           AS posters_cur,
       (SELECT count(*)::text FROM store_poster_tasks, params
          WHERE created_at >= (now() - d2)
            AND created_at <  (now() - d))                                           AS posters_prev,
       (SELECT count(*)::text FROM store_price_changes, params
          WHERE created_at >= (now() - d))                                           AS prices_cur,
       (SELECT count(*)::text FROM store_price_changes, params
          WHERE created_at >= (now() - d2)
            AND created_at <  (now() - d))                                           AS prices_prev`,
    [days],
  );
  const r = res.rows[0]!;
  const pack = (cur: string, prev: string) => {
    const v = Number(cur);
    const p = Number(prev);
    return { value: v, prevValue: p, delta: v - p };
  };
  return {
    activeStores: pack(r.active_stores_cur, r.active_stores_prev),
    adjustedSkus: pack(r.sku_cur, r.sku_prev),
    posterTasks: pack(r.posters_cur, r.posters_prev),
    priceChanges: pack(r.prices_cur, r.prices_prev),
  };
}

// =============================================================================
// 2) 调改趋势(按天聚合 added / removed)
// =============================================================================

export interface AdjustmentTrendPoint {
  date: string;   // YYYY-MM-DD
  added: number;
  removed: number;
}

export async function getAdjustmentTrend(days: number): Promise<AdjustmentTrendPoint[]> {
  // 用 generate_series 把所有日期补齐(没数据的天填 0,前端折线图才不会断)
  const res = await query<{ d: string; added: string; removed: string }>(
    `WITH days AS (
       SELECT generate_series(
         (CURRENT_DATE - ($1::int - 1))::date,
         CURRENT_DATE::date,
         '1 day'::interval
       )::date AS d
     )
     SELECT d::text AS d,
            COALESCE(SUM(CASE WHEN c.action = 'add'    THEN 1 ELSE 0 END), 0)::text AS added,
            COALESCE(SUM(CASE WHEN c.action = 'remove' THEN 1 ELSE 0 END), 0)::text AS removed
       FROM days
       LEFT JOIN store_assortment_changes c
         ON c.effective_date = days.d
      GROUP BY days.d
      ORDER BY days.d`,
    [days],
  );
  return res.rows.map((r) => ({
    date: r.d,
    added: Number(r.added),
    removed: Number(r.removed),
  }));
}

// =============================================================================
// 3) Top N 活跃门店(按调改 SKU 数排序)
// =============================================================================

export interface TopActiveStore {
  storeId: string;
  storeCode: string;
  storeName: string;
  totalChanges: number;
  addedCount: number;
  removedCount: number;
}

export async function getTopActiveStores(
  days: number,
  limit: number,
): Promise<TopActiveStore[]> {
  const res = await query<{
    store_id: string;
    store_code: string;
    store_name: string;
    total_changes: string;
    added_count: string;
    removed_count: string;
  }>(
    `SELECT s.id AS store_id, s.store_code, s.store_name,
            count(*)::text                                                AS total_changes,
            SUM(CASE WHEN c.action = 'add'    THEN 1 ELSE 0 END)::text   AS added_count,
            SUM(CASE WHEN c.action = 'remove' THEN 1 ELSE 0 END)::text   AS removed_count
       FROM store_assortment_changes c
       JOIN stores s ON s.id = c.store_id
      WHERE c.effective_date >= (CURRENT_DATE - $1::int)
        AND s.status = 'active'
      GROUP BY s.id, s.store_code, s.store_name
      ORDER BY count(*) DESC, s.store_name
      LIMIT $2`,
    [days, limit],
  );
  return res.rows.map((r) => ({
    storeId: r.store_id,
    storeCode: r.store_code,
    storeName: r.store_name,
    totalChanges: Number(r.total_changes),
    addedCount: Number(r.added_count),
    removedCount: Number(r.removed_count),
  }));
}

// =============================================================================
// 4) 场景分布(调改 SKU 在各场景下的占比)
// =============================================================================

export interface SceneDistributionRow {
  scene: number;
  sceneName: string;
  count: number;
}

export async function getSceneDistribution(days: number): Promise<SceneDistributionRow[]> {
  // scene -> name 走 join,hq_categories.scene 是 UNIQUE(对 level=0 行),1:1 拿名字。
  // 不 hardcode 表格,避免 schema 加场景时遗漏。
  const res = await query<{ scene: number; scene_name: string | null; cnt: string }>(
    `SELECT c.scene,
            hc.category_name AS scene_name,
            count(*)::text   AS cnt
       FROM store_assortment_changes c
       LEFT JOIN hq_categories hc ON hc.scene = c.scene AND hc.level = 0
      WHERE c.effective_date >= (CURRENT_DATE - $1::int)
      GROUP BY c.scene, hc.category_name
      ORDER BY count(*) DESC`,
    [days],
  );
  return res.rows.map((r) => ({
    scene: r.scene,
    sceneName: r.scene_name ?? `场景 ${r.scene}`,
    count: Number(r.cnt),
  }));
}
