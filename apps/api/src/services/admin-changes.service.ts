/**
 * 调改记录查询(admin-web 的「调改记录」表格用)。
 *
 * 数据源:`store_assortment_changes`,join `stores` / `hq_products` /
 * `hq_categories`(scene → name)。
 *
 * 支持:
 *   - 筛选:storeId / scene / action / from / to / search (sku_code 或 product_name)
 *   - 排序:created_at(默认倒序)、effective_date
 *   - 分页:limit + offset
 *
 * 同时输出 totalCount 给前端分页器用。
 */
import { query } from '../db/index.js';

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
  effectiveDate: string;       // YYYY-MM-DD
  createdAt: string;
  createdByDisplay: string | null;
  /** 关联调整批次 id;前端展开行时再发详情接口拉 ai_diagnosis 等大字段 */
  adjustmentId: string | null;
  /** ai_diagnosis 缩略(text 化的 key 列表),完整内容在详情接口 */
  hasAiDiagnosis: boolean;
}

export interface ListChangesArgs {
  storeId?: string;
  scene?: number;
  action?: ChangeAction;
  /** YYYY-MM-DD,按 effective_date 过滤 */
  from?: string;
  to?: string;
  /** 模糊匹配 sku_code 或 product_name */
  search?: string;
  limit: number;
  offset: number;
  sortBy?: 'created_at' | 'effective_date';
  sortDir?: 'asc' | 'desc';
}

export interface ListChangesResult {
  items: ChangeRow[];
  totalCount: number;
}

export async function listChanges(args: ListChangesArgs): Promise<ListChangesResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.storeId) {
    params.push(args.storeId);
    where.push(`c.store_id = $${params.length}`);
  }
  if (typeof args.scene === 'number') {
    params.push(args.scene);
    where.push(`c.scene = $${params.length}`);
  }
  if (args.action) {
    params.push(args.action);
    where.push(`c.action = $${params.length}::assortment_action`);
  }
  if (args.from) {
    params.push(args.from);
    where.push(`c.effective_date >= $${params.length}::date`);
  }
  if (args.to) {
    params.push(args.to);
    where.push(`c.effective_date <= $${params.length}::date`);
  }
  if (args.search && args.search.trim()) {
    const q = `%${args.search.trim()}%`;
    params.push(q);
    where.push(`(c.sku_code ILIKE $${params.length} OR p.product_name ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = args.sortBy === 'effective_date' ? 'c.effective_date' : 'c.created_at';
  const sortDir = args.sortDir === 'asc' ? 'ASC' : 'DESC';

  // 总数(同条件,不分页)
  const countRes = await query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM store_assortment_changes c
       LEFT JOIN hq_products p ON p.id = c.product_id
      ${whereSql}`,
    params,
  );
  const totalCount = Number(countRes.rows[0]?.count ?? 0);

  // 列表 — 多 push 两个参数,limit / offset 紧跟 where 之后
  params.push(args.limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(args.offset);
  const offsetPlaceholder = `$${params.length}`;

  const listRes = await query<{
    id: string;
    store_id: string;
    store_code: string;
    store_name: string;
    sku_code: string;
    product_name: string | null;
    brand: string | null;
    scene: number;
    scene_name: string | null;
    action: ChangeAction;
    reason_code: ChangeReason;
    reason_text: string | null;
    effective_date: string;
    created_at: string;
    created_by_display: string | null;
    adjustment_id: string | null;
    has_ai_diagnosis: boolean;
  }>(
    `SELECT c.id,
            c.store_id, s.store_code, s.store_name,
            c.sku_code, p.product_name, p.brand,
            c.scene, hc.category_name AS scene_name,
            c.action, c.reason_code, c.reason_text,
            c.effective_date::text AS effective_date,
            c.created_at::text     AS created_at,
            c.created_by_display,
            c.adjustment_id,
            (c.ai_diagnosis IS NOT NULL AND c.ai_diagnosis::text <> '{}') AS has_ai_diagnosis
       FROM store_assortment_changes c
       JOIN stores s        ON s.id = c.store_id
       LEFT JOIN hq_products p ON p.id = c.product_id
       LEFT JOIN hq_categories hc ON hc.scene = c.scene AND hc.level = 0
      ${whereSql}
      ORDER BY ${sortCol} ${sortDir}, c.id ${sortDir}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    params,
  );

  return {
    totalCount,
    items: listRes.rows.map((r) => ({
      id: r.id,
      storeId: r.store_id,
      storeCode: r.store_code,
      storeName: r.store_name,
      skuCode: r.sku_code,
      productName: r.product_name,
      brand: r.brand,
      scene: r.scene,
      sceneName: r.scene_name,
      action: r.action,
      reasonCode: r.reason_code,
      reasonText: r.reason_text,
      effectiveDate: r.effective_date,
      createdAt: r.created_at,
      createdByDisplay: r.created_by_display,
      adjustmentId: r.adjustment_id,
      hasAiDiagnosis: r.has_ai_diagnosis,
    })),
  };
}

// =============================================================================
// 详情接口:给前端「行展开」时拉 ai_diagnosis 完整 JSON 用
// =============================================================================

export interface ChangeDetail extends ChangeRow {
  aiDiagnosis: unknown;
  /** 关联调整批次摘要(如果有 adjustment_id) */
  adjustment: {
    id: string;
    summaryText: string | null;
    addedCount: number;
    removedCount: number;
    triggeredAt: string;
    triggeredByDisplay: string | null;
  } | null;
}

export async function getChangeDetail(id: string): Promise<ChangeDetail | null> {
  const res = await query<{
    id: string;
    store_id: string;
    store_code: string;
    store_name: string;
    sku_code: string;
    product_name: string | null;
    brand: string | null;
    scene: number;
    scene_name: string | null;
    action: ChangeAction;
    reason_code: ChangeReason;
    reason_text: string | null;
    effective_date: string;
    created_at: string;
    created_by_display: string | null;
    adjustment_id: string | null;
    ai_diagnosis: unknown;
    adj_id: string | null;
    adj_summary: string | null;
    adj_added: number | null;
    adj_removed: number | null;
    adj_triggered_at: string | null;
    adj_triggered_by: string | null;
  }>(
    `SELECT c.id,
            c.store_id, s.store_code, s.store_name,
            c.sku_code, p.product_name, p.brand,
            c.scene, hc.category_name AS scene_name,
            c.action, c.reason_code, c.reason_text,
            c.effective_date::text AS effective_date,
            c.created_at::text     AS created_at,
            c.created_by_display,
            c.adjustment_id,
            c.ai_diagnosis,
            a.id           AS adj_id,
            a.summary_text AS adj_summary,
            a.added_count  AS adj_added,
            a.removed_count AS adj_removed,
            a.triggered_at::text AS adj_triggered_at,
            a.triggered_by_display AS adj_triggered_by
       FROM store_assortment_changes c
       JOIN stores s ON s.id = c.store_id
       LEFT JOIN hq_products p ON p.id = c.product_id
       LEFT JOIN hq_categories hc ON hc.scene = c.scene AND hc.level = 0
       LEFT JOIN store_scene_adjustments a ON a.id = c.adjustment_id
      WHERE c.id = $1
      LIMIT 1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    storeId: r.store_id,
    storeCode: r.store_code,
    storeName: r.store_name,
    skuCode: r.sku_code,
    productName: r.product_name,
    brand: r.brand,
    scene: r.scene,
    sceneName: r.scene_name,
    action: r.action,
    reasonCode: r.reason_code,
    reasonText: r.reason_text,
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
    createdByDisplay: r.created_by_display,
    adjustmentId: r.adjustment_id,
    hasAiDiagnosis: r.ai_diagnosis !== null && JSON.stringify(r.ai_diagnosis) !== '{}',
    aiDiagnosis: r.ai_diagnosis,
    adjustment: r.adj_id ? {
      id: r.adj_id,
      summaryText: r.adj_summary,
      addedCount: r.adj_added ?? 0,
      removedCount: r.adj_removed ?? 0,
      triggeredAt: r.adj_triggered_at ?? '',
      triggeredByDisplay: r.adj_triggered_by,
    } : null,
  };
}

// =============================================================================
// 筛选用辅助数据(下拉选项)
// =============================================================================

export interface StoreOption {
  storeId: string;
  storeCode: string;
  storeName: string;
}

export interface SceneOption {
  scene: number;
  sceneName: string;
}

export async function listStoreOptions(): Promise<StoreOption[]> {
  const res = await query<{ id: string; store_code: string; store_name: string }>(
    `SELECT id, store_code, store_name
       FROM stores
      WHERE status = 'active'
      ORDER BY store_code`,
  );
  return res.rows.map((r) => ({
    storeId: r.id,
    storeCode: r.store_code,
    storeName: r.store_name,
  }));
}

export async function listSceneOptions(): Promise<SceneOption[]> {
  const res = await query<{ scene: number; category_name: string }>(
    `SELECT scene, category_name
       FROM hq_categories
      WHERE level = 0 AND scene IS NOT NULL
      ORDER BY scene`,
  );
  return res.rows.map((r) => ({
    scene: r.scene,
    sceneName: r.category_name,
  }));
}

// =============================================================================
// CSV 导出 — 拼好 CSV 字符串直接回响应,不用 stream
// =============================================================================

export async function exportChangesCsv(args: Omit<ListChangesArgs, 'limit' | 'offset'>): Promise<string> {
  // 复用 listChanges,但给一个大 limit(导出场景下不分页)
  const { items } = await listChanges({ ...args, limit: 10_000, offset: 0 });
  const header = [
    '时间', '门店编号', '门店', 'SKU', '商品名', '品牌',
    '场景', '动作', '原因', '原因说明', '生效日期', '操作人',
  ];
  const lines: string[] = [header.join(',')];
  for (const it of items) {
    lines.push([
      csvCell(it.createdAt),
      csvCell(it.storeCode),
      csvCell(it.storeName),
      csvCell(it.skuCode),
      csvCell(it.productName ?? ''),
      csvCell(it.brand ?? ''),
      csvCell(it.sceneName ?? `场景${it.scene}`),
      csvCell(it.action === 'add' ? '上架' : '下架'),
      csvCell(REASON_LABEL[it.reasonCode] ?? it.reasonCode),
      csvCell(it.reasonText ?? ''),
      csvCell(it.effectiveDate),
      csvCell(it.createdByDisplay ?? ''),
    ].join(','));
  }
  // BOM,Excel 直接打开识别 UTF-8 不乱码
  return '﻿' + lines.join('\n');
}

export const REASON_LABEL: Record<ChangeReason, string> = {
  ai_recommend_core: 'AI 推荐核心',
  ai_recommend_innovation: 'AI 推荐创新',
  low_sales: '销量低',
  competitor_replace: '竞品替代',
  shelf_space_limit: '货架空间限制',
  manual_keep: '人工保留',
  manual_remove: '人工下架',
  other: '其他',
};

function csvCell(v: string): string {
  // 含逗号 / 引号 / 换行 → 加双引号 + 内部双引号转义
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
