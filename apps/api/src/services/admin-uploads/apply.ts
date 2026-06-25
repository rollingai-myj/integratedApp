/**
 * 把已暂存(status='staged')的批次落到业务表,并记录 before_snapshot 供回滚。
 *
 * 分 kind 派发:
 *   - products  → upsert hq_products(category_name → category_id lookup)
 *   - snapshots → INSERT ON CONFLICT DO NOTHING(store_code / sku_code lookup)
 *   - promotions → 不支持(沿用原 xlsx 工作流)
 *
 * 整批事务;事务内 SELECT...FOR UPDATE 锁住 batch 行,避免并发 apply。
 *
 * rollback 的形状记在 before_snapshot,详见 V037 migration 注释。
 */
import { AppError, ErrorCodes } from '../../lib/errors.js';
import { withTransaction } from '../../db/index.js';
import type { PoolClient } from 'pg';
import type { UploadKind } from './schemas.js';

export type RollbackKind = 'inserted' | 'updated';

export interface RollbackEntry {
  kind: RollbackKind;
  table: 'hq_products' | 'store_sku_snapshots' | 'stores';
  /** 业务唯一键(回滚时用 WHERE) */
  key: Record<string, unknown>;
  /** kind='updated' 时,被覆盖前的字段值 */
  before?: Record<string, unknown>;
}

export interface ApplySummary {
  inserted: number;
  updated: number;
  skipped: number;
  /** 跳过的原因清单(每条带 row index + reason),前 100 条 */
  skipReasons: Array<{ row: number; reason: string }>;
}

/** apply 模式:upsert = 新增+覆盖更新;insert_only = 只新增,重复的归入 skipped */
export type ApplyMode = 'upsert' | 'insert_only';

export interface ConflictPreview {
  /** 本批可生效行数 */
  totalRows: number;
  /** 不重复 → 全新插入 */
  toInsertCount: number;
  /** 已存在 → 覆盖更新(insert_only 模式下会跳过) */
  toUpdateCount: number;
  /** 重复行的简要清单(前 50 条),给弹窗展示 */
  conflicts: Array<{ key: string; label: string }>;
}

const MAX_SKIP_REASONS = 100;

const STATUS_LABEL_CN: Record<string, string> = {
  staged: '待生效',
  applied: '已生效',
  failed: '格式错误',
  rolled_back: '已撤销',
};

// =============================================================================
// 冲突预览(给前端 apply 前弹窗确认用)
// =============================================================================

const PREVIEW_LIMIT = 50;

export async function previewBatchConflicts(batchId: string): Promise<ConflictPreview> {
  const { query } = await import('../../db/index.js');
  const r = await query<{
    kind: UploadKind;
    status: string;
    staging_data: Record<string, unknown>[];
  }>(
    `SELECT kind, status, staging_data FROM upload_batches WHERE id = $1`,
    [batchId],
  );
  if (r.rows.length === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '该批次不存在');
  }
  const { kind, status, staging_data: staging } = r.rows[0]!;
  if (status !== 'staged') {
    throw new AppError(409, ErrorCodes.CONFLICT, '只有「待生效」状态的批次能预览冲突');
  }
  if (staging.length === 0) {
    return { totalRows: 0, toInsertCount: 0, toUpdateCount: 0, conflicts: [] };
  }

  switch (kind) {
    case 'products': {
      const skuCodes = staging.map((s) => s.sku_code as string);
      const res = await query<{ sku_code: string; product_name: string }>(
        `SELECT sku_code, product_name FROM hq_products WHERE sku_code = ANY($1)`,
        [skuCodes],
      );
      const existingMap = new Map(res.rows.map((r) => [r.sku_code, r.product_name]));
      const conflicts: Array<{ key: string; label: string }> = [];
      let toUpdate = 0;
      for (const row of staging) {
        const code = row.sku_code as string;
        const oldName = existingMap.get(code);
        if (oldName !== undefined) {
          toUpdate++;
          if (conflicts.length < PREVIEW_LIMIT) {
            conflicts.push({ key: code, label: oldName });
          }
        }
      }
      return {
        totalRows: staging.length,
        toInsertCount: staging.length - toUpdate,
        toUpdateCount: toUpdate,
        conflicts,
      };
    }
    case 'stores': {
      const codes = staging.map((s) => s.store_code as string);
      const res = await query<{ store_code: string; store_name: string }>(
        `SELECT store_code, store_name FROM stores
          WHERE store_code = ANY($1) AND deleted_at IS NULL`,
        [codes],
      );
      const existingMap = new Map(res.rows.map((r) => [r.store_code, r.store_name]));
      const conflicts: Array<{ key: string; label: string }> = [];
      let toUpdate = 0;
      for (const row of staging) {
        const code = row.store_code as string;
        const oldName = existingMap.get(code);
        if (oldName !== undefined) {
          toUpdate++;
          if (conflicts.length < PREVIEW_LIMIT) {
            conflicts.push({ key: code, label: oldName });
          }
        }
      }
      return {
        totalRows: staging.length,
        toInsertCount: staging.length - toUpdate,
        toUpdateCount: toUpdate,
        conflicts,
      };
    }
    case 'snapshots':
      // snapshots 用 INSERT ON CONFLICT DO NOTHING,冲突就是跳过、不存在"覆盖"语义,
      // 不弹冲突确认窗(前端走默认 apply 路径)
      return {
        totalRows: staging.length,
        toInsertCount: staging.length,
        toUpdateCount: 0,
        conflicts: [],
      };
    default:
      throw new AppError(400, ErrorCodes.BAD_REQUEST, `不支持的类型: ${kind}`);
  }
}

// =============================================================================
// 入口
// =============================================================================

export async function applyBatch(args: {
  batchId: string;
  appliedBy: string;
  /** 默认 'upsert':新增 + 覆盖更新;'insert_only':只新增,重复 store_code/sku_code 归入 skipped */
  mode?: ApplyMode;
}): Promise<ApplySummary> {
  const mode: ApplyMode = args.mode ?? 'upsert';
  return withTransaction(async (client) => {
    // 锁 batch 行,避免并发 apply
    const r = await client.query<{
      kind: UploadKind;
      status: string;
      staging_data: Record<string, unknown>[];
    }>(
      `SELECT kind, status, staging_data
         FROM upload_batches
        WHERE id = $1
        FOR UPDATE`,
      [args.batchId],
    );
    if (r.rows.length === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '该批次不存在');
    }
    const { kind, status, staging_data: staging } = r.rows[0]!;
    if (status !== 'staged') {
      throw new AppError(409, ErrorCodes.CONFLICT, `该批次当前状态为「${STATUS_LABEL_CN[status] ?? status}」,不能再次生效`);
    }
    if (staging.length === 0) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, '本批次没有可生效的数据');
    }

    let summary: ApplySummary;
    let beforeSnapshot: RollbackEntry[];

    switch (kind) {
      case 'products':
        ({ summary, beforeSnapshot } = await applyProducts(client, staging, args.appliedBy, mode));
        break;
      case 'snapshots':
        // snapshots 不存在"覆盖"语义,mode 对它无效
        ({ summary, beforeSnapshot } = await applySnapshots(client, staging, args.appliedBy));
        break;
      case 'stores':
        ({ summary, beforeSnapshot } = await applyStores(client, staging, mode));
        break;
      default:
        throw new AppError(400, ErrorCodes.BAD_REQUEST, `unknown kind: ${kind}`);
    }

    await client.query(
      `UPDATE upload_batches
          SET status='applied',
              applied_at=now(),
              applied_by=$2,
              apply_summary=$3::jsonb,
              before_snapshot=$4::jsonb,
              updated_at=now()
        WHERE id=$1`,
      [
        args.batchId,
        args.appliedBy,
        JSON.stringify(summary),
        JSON.stringify(beforeSnapshot),
      ],
    );

    return summary;
  });
}

// =============================================================================
// products
// =============================================================================

interface ProductRow {
  sku_code: string;
  product_name: string;
  brand: string | null;
  series: string | null;
  spec: string | null;
  unit: string | null;
  category_name: string;
  barcode: string | null;
  status: 'active' | 'delisted' | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  shelf_life_days: number | null;
  allocation_unit: number | null;
  wholesale_price: number | null;
  suggested_retail_price: number | null;
  market_min_price: number | null;
  market_min_price_source: string | null;
  tags: string | null;
  is_new_product: boolean | null;
  is_private_label: boolean | null;
  is_returnable: boolean | null;
  is_whitelisted: boolean | null;
  introduced_at: string | null;
}

/** hq_products 中可被 CSV 上传字段覆盖的列(供 before_snapshot SELECT 用) */
const PRODUCT_UPDATABLE_COLS = [
  'product_name', 'brand', 'series', 'spec', 'unit', 'category_id', 'barcode',
  'status',
  'length_cm', 'width_cm', 'height_cm', 'shelf_life_days', 'allocation_unit',
  'wholesale_price', 'suggested_retail_price',
  'market_min_price', 'market_min_price_source',
  'tags',
  'is_new_product', 'is_private_label', 'is_returnable', 'is_whitelisted',
  'introduced_at',
] as const;

async function applyProducts(
  client: PoolClient,
  staging: Record<string, unknown>[],
  _appliedBy: string,
  mode: ApplyMode,
): Promise<{ summary: ApplySummary; beforeSnapshot: RollbackEntry[] }> {
  // 1) category_name → id 全量 lookup
  //    要求是叶子节点(level > 0,即不是 scene 根),用 category_name 唯一查找。
  //    重名怎么办?数据库没有强 unique 约束,实际多个叶子可能重名(如多个场景下都有「酒」),
  //    这里取第一条;如果命中多条,后续可加排序规则。
  const names = Array.from(new Set(staging.map((r) => r.category_name as string)));
  const catRes = await client.query<{ id: string; category_name: string }>(
    `SELECT DISTINCT ON (category_name) id, category_name
       FROM hq_categories
      WHERE category_name = ANY($1) AND level > 0
      ORDER BY category_name, level DESC`,
    [names],
  );
  const categoryMap = new Map(catRes.rows.map((r) => [r.category_name, r.id]));

  // 2) 已有 sku 一次性查 before-snapshot,避免循环里 N 次往返
  const skuCodes = staging.map((r) => r.sku_code as string);
  const existingRes = await client.query<{
    sku_code: string;
    product_name: string;
    brand: string | null;
    series: string | null;
    spec: string | null;
    unit: string | null;
    category_id: string;
    barcode: string | null;
    status: 'active' | 'delisted';
    length_cm: string | null;
    width_cm: string | null;
    height_cm: string | null;
    shelf_life_days: number | null;
    allocation_unit: number | null;
    wholesale_price: string | null;
    suggested_retail_price: string | null;
    market_min_price: string | null;
    market_min_price_source: string | null;
    tags: string[];
    is_new_product: boolean;
    is_private_label: boolean;
    is_returnable: boolean | null;
    is_whitelisted: boolean;
    introduced_at: string | null;
  }>(
    `SELECT sku_code, product_name, brand, series, spec, unit, category_id, barcode,
            status,
            length_cm, width_cm, height_cm, shelf_life_days, allocation_unit,
            wholesale_price, suggested_retail_price,
            market_min_price, market_min_price_source,
            tags,
            is_new_product, is_private_label, is_returnable, is_whitelisted,
            introduced_at::text AS introduced_at
       FROM hq_products
      WHERE sku_code = ANY($1)`,
    [skuCodes],
  );
  const existingMap = new Map(existingRes.rows.map((r) => [r.sku_code, r]));

  const summary: ApplySummary = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };
  const beforeSnapshot: RollbackEntry[] = [];

  for (let i = 0; i < staging.length; i++) {
    const row = staging[i] as unknown as ProductRow;
    const categoryId = categoryMap.get(row.category_name);
    if (!categoryId) {
      summary.skipped++;
      if (summary.skipReasons.length < MAX_SKIP_REASONS) {
        summary.skipReasons.push({
          row: i + 2,
          reason: `商品品类「${row.category_name}」在系统中找不到,请检查是否拼写错误,或先到品类管理添加`,
        });
      }
      continue;
    }
    // tags: CSV 是逗号分隔字符串,DB 是 text[]。
    // null = 用户没填这一列 → UPDATE 时走 COALESCE 不改;INSERT 时默认空数组
    const tagsArr: string[] | null = row.tags
      ? row.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : null;

    // 22 个可上传字段的"本次 CSV 值",顺序对应下面 SQL 参数 $3..$24
    // (UPDATE 用 COALESCE($n, old);留空 = 保留原值,而不是清空)
    const cells = [
      row.product_name,            // $3
      row.brand,                   // $4
      row.series,                  // $5
      row.spec,                    // $6
      row.unit,                    // $7
      row.barcode,                 // $8
      row.status,                  // $9   ('active' | 'delisted' | null)
      row.length_cm,               // $10
      row.width_cm,                // $11
      row.height_cm,               // $12
      row.shelf_life_days,         // $13
      row.allocation_unit,         // $14
      row.wholesale_price,         // $15
      row.suggested_retail_price,  // $16
      row.market_min_price,        // $17
      row.market_min_price_source, // $18
      tagsArr,                     // $19
      row.is_new_product,          // $20
      row.is_private_label,        // $21
      row.is_returnable,           // $22
      row.is_whitelisted,          // $23
      row.introduced_at,           // $24
    ];

    const existing = existingMap.get(row.sku_code);
    if (existing && mode === 'insert_only') {
      // 用户选了"仅新增,跳过重复"
      summary.skipped++;
      if (summary.skipReasons.length < MAX_SKIP_REASONS) {
        summary.skipReasons.push({
          row: i + 2,
          reason: `商品编码「${row.sku_code}」已存在,按用户选择跳过(不覆盖)`,
        });
      }
      continue;
    }
    if (existing) {
      // UPDATE — 记录 before_snapshot 全部字段,再用 COALESCE("留空 = 不改")
      beforeSnapshot.push({
        kind: 'updated',
        table: 'hq_products',
        key: { sku_code: row.sku_code },
        before: {
          product_name: existing.product_name,
          brand: existing.brand,
          series: existing.series,
          spec: existing.spec,
          unit: existing.unit,
          category_id: existing.category_id,
          barcode: existing.barcode,
          status: existing.status,
          length_cm: existing.length_cm,
          width_cm: existing.width_cm,
          height_cm: existing.height_cm,
          shelf_life_days: existing.shelf_life_days,
          allocation_unit: existing.allocation_unit,
          wholesale_price: existing.wholesale_price,
          suggested_retail_price: existing.suggested_retail_price,
          market_min_price: existing.market_min_price,
          market_min_price_source: existing.market_min_price_source,
          tags: existing.tags,
          is_new_product: existing.is_new_product,
          is_private_label: existing.is_private_label,
          is_returnable: existing.is_returnable,
          is_whitelisted: existing.is_whitelisted,
          introduced_at: existing.introduced_at,
        },
      });
      await client.query(
        `UPDATE hq_products
            SET product_name            = COALESCE($3,  product_name),
                brand                   = COALESCE($4,  brand),
                series                  = COALESCE($5,  series),
                spec                    = COALESCE($6,  spec),
                unit                    = COALESCE($7,  unit),
                category_id             = $2,
                barcode                 = COALESCE($8,  barcode),
                status                  = COALESCE($9::product_status,  status),
                length_cm               = COALESCE($10, length_cm),
                width_cm                = COALESCE($11, width_cm),
                height_cm               = COALESCE($12, height_cm),
                shelf_life_days         = COALESCE($13, shelf_life_days),
                allocation_unit         = COALESCE($14, allocation_unit),
                wholesale_price         = COALESCE($15, wholesale_price),
                suggested_retail_price  = COALESCE($16, suggested_retail_price),
                market_min_price        = COALESCE($17, market_min_price),
                market_min_price_source = COALESCE($18, market_min_price_source),
                tags                    = COALESCE($19, tags),
                is_new_product          = COALESCE($20, is_new_product),
                is_private_label        = COALESCE($21, is_private_label),
                is_returnable           = COALESCE($22, is_returnable),
                is_whitelisted          = COALESCE($23, is_whitelisted),
                introduced_at           = COALESCE($24::date, introduced_at),
                updated_at = now()
          WHERE sku_code = $1`,
        [row.sku_code, categoryId, ...cells],
      );
      summary.updated++;
    } else {
      // INSERT — NOT NULL 列(status / is_new_product / is_private_label /
      // is_whitelisted / tags)CSV 留空时让 PG 走 DEFAULT
      await client.query(
        `INSERT INTO hq_products
           (sku_code, product_name, brand, series, spec, unit, category_id, barcode,
            status,
            length_cm, width_cm, height_cm, shelf_life_days, allocation_unit,
            wholesale_price, suggested_retail_price,
            market_min_price, market_min_price_source,
            tags,
            is_new_product, is_private_label, is_returnable, is_whitelisted,
            introduced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 COALESCE($9::product_status, 'active'::product_status),
                 $10, $11, $12, $13, $14,
                 $15, $16,
                 $17, $18,
                 COALESCE($19, '{}'::text[]),
                 COALESCE($20, false), COALESCE($21, false), $22, COALESCE($23, false),
                 $24::date)`,
        [
          row.sku_code,
          row.product_name,
          row.brand,
          row.series,
          row.spec,
          row.unit,
          categoryId,
          row.barcode,
          row.status,
          row.length_cm, row.width_cm, row.height_cm,
          row.shelf_life_days, row.allocation_unit,
          row.wholesale_price, row.suggested_retail_price,
          row.market_min_price, row.market_min_price_source,
          tagsArr,
          row.is_new_product, row.is_private_label, row.is_returnable, row.is_whitelisted,
          row.introduced_at,
        ],
      );
      beforeSnapshot.push({
        kind: 'inserted',
        table: 'hq_products',
        key: { sku_code: row.sku_code },
      });
      summary.inserted++;
    }
  }

  return { summary, beforeSnapshot };
}

// =============================================================================
// snapshots
// =============================================================================

interface SnapshotRow {
  store_code: string;
  sku_code: string;
  snapshot_date: string;
  retail_price: number | null;
  sales_qty_30d: number | null;
  sales_realamt_30d: number | null;
  sales_qty_90d: number | null;
  sales_realamt_90d: number | null;
  stock_qty: number | null;
}

async function applySnapshots(
  client: PoolClient,
  staging: Record<string, unknown>[],
  appliedBy: string,
): Promise<{ summary: ApplySummary; beforeSnapshot: RollbackEntry[] }> {
  // 1) store_code → id
  const storeCodes = Array.from(new Set(staging.map((r) => r.store_code as string)));
  const storeRes = await client.query<{ id: string; store_code: string }>(
    `SELECT id, store_code FROM stores WHERE store_code = ANY($1)`,
    [storeCodes],
  );
  const storeMap = new Map(storeRes.rows.map((r) => [r.store_code, r.id]));

  // 2) sku_code → product_id
  const skuCodes = Array.from(new Set(staging.map((r) => r.sku_code as string)));
  const prodRes = await client.query<{ id: string; sku_code: string }>(
    `SELECT id, sku_code FROM hq_products WHERE sku_code = ANY($1)`,
    [skuCodes],
  );
  const productMap = new Map(prodRes.rows.map((r) => [r.sku_code, r.id]));

  const summary: ApplySummary = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };
  const beforeSnapshot: RollbackEntry[] = [];

  for (let i = 0; i < staging.length; i++) {
    const row = staging[i] as unknown as SnapshotRow;
    const storeId = storeMap.get(row.store_code);
    const productId = productMap.get(row.sku_code);
    if (!storeId || !productId) {
      summary.skipped++;
      if (summary.skipReasons.length < MAX_SKIP_REASONS) {
        const reason = !storeId
          ? `门店编号「${row.store_code}」在系统中找不到`
          : `商品编码「${row.sku_code}」在系统中找不到,请先上传产品主数据`;
        summary.skipReasons.push({ row: i + 2, reason });
      }
      continue;
    }

    // ON CONFLICT DO NOTHING:同店同 SKU 同日期同 source('manual') 已存在 → 跳过
    // 这是有意的:避免误覆盖。要更新就先 rollback 旧批次。
    const insertRes = await client.query<{ id: string }>(
      `INSERT INTO store_sku_snapshots
         (store_id, product_id, sku_code, snapshot_date,
          retail_price, sales_qty_30d, sales_realamt_30d, sales_qty_90d, sales_realamt_90d,
          stock_qty, source, imported_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, 'manual', $11)
       ON CONFLICT (store_id, product_id, snapshot_date, source) DO NOTHING
       RETURNING id`,
      [
        storeId, productId, row.sku_code, row.snapshot_date,
        row.retail_price, row.sales_qty_30d, row.sales_realamt_30d, row.sales_qty_90d, row.sales_realamt_90d,
        row.stock_qty, appliedBy,
      ],
    );

    if (insertRes.rows.length === 0) {
      // 冲突,跳过
      summary.skipped++;
      if (summary.skipReasons.length < MAX_SKIP_REASONS) {
        summary.skipReasons.push({
          row: i + 2,
          reason: `该门店该商品 ${row.snapshot_date} 的数据已存在,本次跳过(若要覆盖请先撤销旧批次)`,
        });
      }
      continue;
    }

    beforeSnapshot.push({
      kind: 'inserted',
      table: 'store_sku_snapshots',
      key: { id: insertRes.rows[0]!.id },
    });
    summary.inserted++;
  }

  return { summary, beforeSnapshot };
}

// =============================================================================
// stores
// =============================================================================

interface StoreRow {
  store_code: string;
  store_name: string;
  province: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  opened_at: string | null;
  status: 'active' | 'disabled' | null;
  is_project_store: boolean | null;
  store_area_sqm: number | null;
  poi_category: string | null;
}

async function applyStores(
  client: PoolClient,
  staging: Record<string, unknown>[],
  mode: ApplyMode,
): Promise<{ summary: ApplySummary; beforeSnapshot: RollbackEntry[] }> {
  // 已有 store_code 一次性查 before-snapshot
  const codes = staging.map((r) => r.store_code as string);
  const existingRes = await client.query<{
    store_code: string;
    store_name: string;
    province: string | null;
    city: string | null;
    address: string | null;
    latitude: string | null;
    longitude: string | null;
    opened_at: string | null;
    status: 'active' | 'disabled';
    is_project_store: boolean;
    store_area_sqm: string | null;
    poi_category: string | null;
  }>(
    `SELECT store_code, store_name, province, city, address,
            latitude, longitude,
            opened_at::text AS opened_at,
            status, is_project_store, store_area_sqm, poi_category
       FROM stores
      WHERE store_code = ANY($1)
        AND deleted_at IS NULL`,
    [codes],
  );
  const existingMap = new Map(existingRes.rows.map((r) => [r.store_code, r]));

  const summary: ApplySummary = { inserted: 0, updated: 0, skipped: 0, skipReasons: [] };
  const beforeSnapshot: RollbackEntry[] = [];

  for (let i = 0; i < staging.length; i++) {
    const row = staging[i] as unknown as StoreRow;

    const cells = [
      row.store_name,        // $2
      row.province,          // $3
      row.city,              // $4
      row.address,           // $5
      row.latitude,          // $6
      row.longitude,         // $7
      row.opened_at,         // $8
      row.status,            // $9
      row.is_project_store,  // $10
      row.store_area_sqm,    // $11
      row.poi_category,      // $12
    ];

    const existing = existingMap.get(row.store_code);
    if (existing && mode === 'insert_only') {
      summary.skipped++;
      if (summary.skipReasons.length < MAX_SKIP_REASONS) {
        summary.skipReasons.push({
          row: i + 2,
          reason: `门店编号「${row.store_code}」已存在,按用户选择跳过(不覆盖)`,
        });
      }
      continue;
    }
    if (existing) {
      beforeSnapshot.push({
        kind: 'updated',
        table: 'stores',
        key: { store_code: row.store_code },
        before: {
          store_name: existing.store_name,
          province: existing.province,
          city: existing.city,
          address: existing.address,
          latitude: existing.latitude,
          longitude: existing.longitude,
          opened_at: existing.opened_at,
          status: existing.status,
          is_project_store: existing.is_project_store,
          store_area_sqm: existing.store_area_sqm,
          poi_category: existing.poi_category,
        },
      });
      await client.query(
        `UPDATE stores
            SET store_name       = COALESCE($2,  store_name),
                province         = COALESCE($3,  province),
                city             = COALESCE($4,  city),
                address          = COALESCE($5,  address),
                latitude         = COALESCE($6,  latitude),
                longitude        = COALESCE($7,  longitude),
                opened_at        = COALESCE($8::date, opened_at),
                status           = COALESCE($9::user_status, status),
                is_project_store = COALESCE($10, is_project_store),
                store_area_sqm   = COALESCE($11, store_area_sqm),
                poi_category     = COALESCE($12, poi_category),
                updated_at       = now()
          WHERE store_code = $1`,
        [row.store_code, ...cells],
      );
      summary.updated++;
    } else {
      // INSERT — NOT NULL 列(status / is_project_store)CSV 留空时走 DEFAULT
      await client.query(
        `INSERT INTO stores
           (store_code, store_name, province, city, address,
            latitude, longitude, opened_at,
            status, is_project_store, store_area_sqm, poi_category)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $7, $8::date,
                 COALESCE($9::user_status, 'active'::user_status),
                 COALESCE($10, false),
                 $11, $12)`,
        [row.store_code, ...cells],
      );
      beforeSnapshot.push({
        kind: 'inserted',
        table: 'stores',
        key: { store_code: row.store_code },
      });
      summary.inserted++;
    }
  }

  return { summary, beforeSnapshot };
}

// =============================================================================
// rollback
// =============================================================================

export interface RollbackResult {
  reverted: number;
  /** 来不及还原的(因为之后的状态变化导致条件不再唯一)— 给前端展示 */
  warnings: string[];
}

export async function rollbackBatch(batchId: string): Promise<RollbackResult> {
  return withTransaction(async (client) => {
    const r = await client.query<{
      kind: UploadKind;
      status: string;
      before_snapshot: RollbackEntry[];
    }>(
      `SELECT kind, status, before_snapshot
         FROM upload_batches
        WHERE id = $1
        FOR UPDATE`,
      [batchId],
    );
    if (r.rows.length === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '该批次不存在');
    }
    const { status, before_snapshot: snapshot } = r.rows[0]!;
    if (status !== 'applied') {
      throw new AppError(409, ErrorCodes.CONFLICT, `该批次当前状态为「${STATUS_LABEL_CN[status] ?? status}」,不能撤销`);
    }

    const warnings: string[] = [];
    let reverted = 0;

    for (const entry of snapshot) {
      try {
        if (entry.kind === 'inserted') {
          // DELETE
          const cols = Object.keys(entry.key);
          if (cols.length === 0) continue;
          const whereParts = cols.map((c, i) => `${c} = $${i + 1}`);
          const values = cols.map((c) => entry.key[c]);
          await client.query(
            `DELETE FROM ${entry.table} WHERE ${whereParts.join(' AND ')}`,
            values,
          );
          reverted++;
        } else if (entry.kind === 'updated' && entry.before) {
          // UPDATE 还原
          const cols = Object.keys(entry.key);
          const beforeCols = Object.keys(entry.before);
          if (cols.length === 0 || beforeCols.length === 0) continue;
          const setParts = beforeCols.map((c, i) => `${c} = $${i + 1}`);
          const values: unknown[] = beforeCols.map((c) => entry.before![c]);
          const whereParts = cols.map((c, i) => `${c} = $${beforeCols.length + i + 1}`);
          for (const c of cols) values.push(entry.key[c]);
          await client.query(
            `UPDATE ${entry.table} SET ${setParts.join(', ')}, updated_at = now()
              WHERE ${whereParts.join(' AND ')}`,
            values,
          );
          reverted++;
        }
      } catch (err) {
        warnings.push(`撤销其中一条时出错:${(err as Error).message}`);
      }
    }

    await client.query(
      `UPDATE upload_batches
          SET status='rolled_back',
              updated_at = now()
        WHERE id = $1`,
      [batchId],
    );

    return { reverted, warnings };
  });
}
