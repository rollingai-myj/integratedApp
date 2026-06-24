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
  table: 'hq_products' | 'store_sku_snapshots';
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

const MAX_SKIP_REASONS = 100;

// =============================================================================
// 入口
// =============================================================================

export async function applyBatch(args: {
  batchId: string;
  appliedBy: string;
}): Promise<ApplySummary> {
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
      throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    }
    const { kind, status, staging_data: staging } = r.rows[0]!;
    if (status !== 'staged') {
      throw new AppError(409, ErrorCodes.CONFLICT, `批次状态为 ${status},不能应用`);
    }
    if (staging.length === 0) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, '暂存为空,无可应用数据');
    }

    let summary: ApplySummary;
    let beforeSnapshot: RollbackEntry[];

    switch (kind) {
      case 'products':
        ({ summary, beforeSnapshot } = await applyProducts(client, staging, args.appliedBy));
        break;
      case 'snapshots':
        ({ summary, beforeSnapshot } = await applySnapshots(client, staging, args.appliedBy));
        break;
      case 'promotions':
        throw new AppError(
          400,
          ErrorCodes.BAD_REQUEST,
          'promotions 暂未支持直接应用,请走 xlsx 工作流',
        );
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
  spec: string | null;
  unit: string | null;
  category_name: string;
  wholesale_price: number | null;
  suggested_retail_price: number | null;
  barcode: string | null;
  tags: string | null;
}

/** hq_products 中可被 CSV 上传字段覆盖的列(供 before_snapshot SELECT 用) */
const PRODUCT_UPDATABLE_COLS = [
  'product_name', 'brand', 'spec', 'unit', 'category_id',
  'wholesale_price', 'suggested_retail_price', 'barcode', 'tags',
] as const;

async function applyProducts(
  client: PoolClient,
  staging: Record<string, unknown>[],
  _appliedBy: string,
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
    spec: string | null;
    unit: string | null;
    category_id: string;
    wholesale_price: string | null;
    suggested_retail_price: string | null;
    barcode: string | null;
    tags: string[];
  }>(
    `SELECT sku_code, product_name, brand, spec, unit, category_id,
            wholesale_price, suggested_retail_price, barcode, tags
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
          reason: `category_name 「${row.category_name}」未在 hq_categories 中找到`,
        });
      }
      continue;
    }
    // tags: CSV 是逗号分隔字符串,DB 是 text[]
    const tagsArr: string[] = row.tags
      ? row.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const existing = existingMap.get(row.sku_code);
    if (existing) {
      // UPDATE
      beforeSnapshot.push({
        kind: 'updated',
        table: 'hq_products',
        key: { sku_code: row.sku_code },
        before: {
          product_name: existing.product_name,
          brand: existing.brand,
          spec: existing.spec,
          unit: existing.unit,
          category_id: existing.category_id,
          wholesale_price: existing.wholesale_price,
          suggested_retail_price: existing.suggested_retail_price,
          barcode: existing.barcode,
          tags: existing.tags,
        },
      });
      await client.query(
        `UPDATE hq_products
            SET product_name = $2,
                brand = $3,
                spec = $4,
                unit = $5,
                category_id = $6,
                wholesale_price = $7,
                suggested_retail_price = $8,
                barcode = $9,
                tags = $10,
                updated_at = now()
          WHERE sku_code = $1`,
        [
          row.sku_code,
          row.product_name,
          row.brand,
          row.spec,
          row.unit,
          categoryId,
          row.wholesale_price,
          row.suggested_retail_price,
          row.barcode,
          tagsArr,
        ],
      );
      summary.updated++;
    } else {
      // INSERT — 这里 status 默认 'active',is_new_product 默认 false
      await client.query(
        `INSERT INTO hq_products
           (sku_code, product_name, brand, spec, unit, category_id,
            wholesale_price, suggested_retail_price, barcode, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.sku_code,
          row.product_name,
          row.brand,
          row.spec,
          row.unit,
          categoryId,
          row.wholesale_price,
          row.suggested_retail_price,
          row.barcode,
          tagsArr,
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
          ? `store_code 「${row.store_code}」未在 stores 中找到`
          : `sku_code 「${row.sku_code}」未在 hq_products 中找到`;
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
          reason: `同店同 SKU 同日期(${row.snapshot_date},source=manual)已存在`,
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
      throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    }
    const { status, before_snapshot: snapshot } = r.rows[0]!;
    if (status !== 'applied') {
      throw new AppError(409, ErrorCodes.CONFLICT, `批次状态为 ${status},不能回滚`);
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
        warnings.push(`回滚条目失败:${(err as Error).message}`);
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
