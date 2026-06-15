/**
 * 价盘业务层
 *
 * 表归属（refactor 后）：
 *   store_price_changes      调价流水（**调价数据唯一归属**）
 *   store_sku_snapshots      门店周快照（只接受 erp_sync / manual 导入，调价绝不写）
 *   hq_products              商品主数据
 *
 * 关键决策（refactor-plan）：调价**只写流水，不写快照**。
 *   - 销量/销售额"效果"= 前后两期 snapshot 对比（time-series 真实变化）
 *   - 价格曲线 = snapshots 取价格点 + price_changes 取调价点，前端合并去重
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ---- 价格曲线 ------------------------------------------------------------

/**
 * 字段命名同 @myj/shared.PriceCurvePoint（snapshotDate / source / priceChangeId）。
 * `source` 取值约定：
 *   - 'snapshot' = 来自 store_sku_snapshots（带销量数据）
 *   - 'change'   = 来自 store_price_changes（无销量数据）
 */
export interface PriceCurvePoint {
  snapshotDate: string;            // YYYY-MM-DD
  retailPrice: number | null;
  originalPrice: number | null;
  wholesalePrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
  source: 'snapshot' | 'change';
  priceChangeId: string | null;
}

export interface PriceCurveSku {
  skuCode: string;
  productName: string | null;
  points: PriceCurvePoint[];
}

function ymd(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getPriceCurve(args: {
  storeId: string;
  skuCodes?: string[];
  /** 最近多少天，默认 365 天，最多 5 年 */
  daysBack?: number;
}): Promise<PriceCurveSku[]> {
  const days = Math.min(args.daysBack ?? 365, 1825);

  const snapParams: unknown[] = [args.storeId];
  const snapFilters: string[] = ['s.store_id = $1'];
  if (args.skuCodes && args.skuCodes.length > 0) {
    snapParams.push(args.skuCodes);
    snapFilters.push(`s.sku_code = ANY($${snapParams.length}::text[])`);
  }
  snapParams.push(days);
  snapFilters.push(
    `s.snapshot_date >= CURRENT_DATE - ($${snapParams.length}::int * INTERVAL '1 day')`,
  );

  const snapRes = await query<{
    sku_code: string;
    product_name: string;
    snapshot_date: string | Date;
    retail_price: string | null;
    original_price: string | null;
    wholesale_price: string | null;
    sales_qty_30d: number | null;
    sales_amount_30d: string | null;
    gross_margin_30d: string | null;
  }>(
    `SELECT s.sku_code, p.product_name, s.snapshot_date,
            s.retail_price, s.original_price, s.wholesale_price,
            s.sales_qty_30d, s.sales_amount_30d, s.gross_margin_30d
       FROM store_sku_snapshots s
  LEFT JOIN hq_products p ON p.id = s.product_id AND p.deleted_at IS NULL
      WHERE ${snapFilters.join(' AND ')}
   ORDER BY s.sku_code, s.snapshot_date`,
    snapParams,
  );

  const changeParams: unknown[] = [args.storeId];
  const changeFilters: string[] = ['c.store_id = $1'];
  if (args.skuCodes && args.skuCodes.length > 0) {
    changeParams.push(args.skuCodes);
    changeFilters.push(`c.sku_code = ANY($${changeParams.length}::text[])`);
  }
  changeParams.push(days);
  changeFilters.push(
    `c.effective_date >= CURRENT_DATE - ($${changeParams.length}::int * INTERVAL '1 day')`,
  );

  const changeRes = await query<{
    id: string;
    sku_code: string;
    product_name: string;
    effective_date: string | Date;
    new_price: string;
  }>(
    `SELECT c.id, c.sku_code, p.product_name, c.effective_date, c.new_price
       FROM store_price_changes c
  LEFT JOIN hq_products p ON p.id = c.product_id AND p.deleted_at IS NULL
      WHERE ${changeFilters.join(' AND ')}
   ORDER BY c.sku_code, c.effective_date, c.created_at`,
    changeParams,
  );

  const bySku = new Map<string, PriceCurveSku>();
  const ensure = (skuCode: string, productName: string | null): PriceCurveSku => {
    let entry = bySku.get(skuCode);
    if (!entry) {
      entry = { skuCode, productName, points: [] };
      bySku.set(skuCode, entry);
    } else if (entry.productName == null && productName) {
      entry.productName = productName;
    }
    return entry;
  };

  for (const r of snapRes.rows) {
    const entry = ensure(r.sku_code, r.product_name);
    entry.points.push({
      snapshotDate: ymd(r.snapshot_date),
      retailPrice: r.retail_price != null ? Number(r.retail_price) : null,
      originalPrice: r.original_price != null ? Number(r.original_price) : null,
      wholesalePrice: r.wholesale_price != null ? Number(r.wholesale_price) : null,
      salesQty30d: r.sales_qty_30d,
      salesAmount30d: r.sales_amount_30d != null ? Number(r.sales_amount_30d) : null,
      grossMargin30d: r.gross_margin_30d != null ? Number(r.gross_margin_30d) : null,
      source: 'snapshot',
      priceChangeId: null,
    });
  }
  for (const r of changeRes.rows) {
    const entry = ensure(r.sku_code, r.product_name);
    entry.points.push({
      snapshotDate: ymd(r.effective_date),
      retailPrice: Number(r.new_price),
      originalPrice: null,
      wholesalePrice: null,
      salesQty30d: null,
      salesAmount30d: null,
      grossMargin30d: null,
      source: 'change',
      priceChangeId: r.id,
    });
  }
  for (const sku of bySku.values()) {
    sku.points.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }
  return Array.from(bySku.values());
}

// ---- 调价（**只写流水**） ------------------------------------------------

export interface SubmitPriceChangeInput {
  skuCode: string;
  newPrice: number;
  oldPrice?: number;
  source?: 'manual' | 'rule_engine';
  effectiveDate?: string;
  note?: string;
}

export interface PriceChangeRecord {
  id: string;
  storeId: string;
  productId: string;
  skuCode: string;
  oldPrice: number | null;
  newPrice: number;
  source: 'manual' | 'rule_engine';
  effectiveDate: string;
  changedBy: string | null;
  changedByDisplay: string | null;
  note: string | null;
  createdAt: string;
}

export async function submitPriceChange(
  storeId: string,
  input: SubmitPriceChangeInput,
  userId: string,
  userDisplayName: string,
): Promise<PriceChangeRecord> {
  const prod = await query<{ id: string }>(
    `SELECT id FROM hq_products WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.skuCode],
  );
  const productId = prod.rows[0]?.id;
  if (!productId) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, `SKU ${input.skuCode} 不存在`);
  }

  // 缺省 oldPrice：取最近一次快照的 retail_price 作回退
  let oldPrice = input.oldPrice;
  if (oldPrice == null) {
    const latest = await query<{ retail_price: string | null }>(
      `SELECT retail_price FROM store_sku_snapshots
        WHERE store_id = $1 AND product_id = $2
     ORDER BY snapshot_date DESC LIMIT 1`,
      [storeId, productId],
    );
    const v = latest.rows[0]?.retail_price;
    oldPrice = v != null ? Number(v) : undefined;
  }

  // **只写 store_price_changes**，绝不动 store_sku_snapshots
  return withTransaction(async (client) => {
    const ins = await client.query<{
      id: string;
      effective_date: string | Date;
      created_at: string;
    }>(
      `INSERT INTO store_price_changes
         (store_id, product_id, sku_code, old_price, new_price, source,
          effective_date, changed_by, changed_by_display, note)
       VALUES ($1, $2, $3, $4, $5, $6::price_change_source,
               COALESCE($7::date, CURRENT_DATE),
               $8, $9, $10)
       RETURNING id, effective_date, created_at`,
      [
        storeId, productId, input.skuCode,
        oldPrice ?? null, input.newPrice,
        input.source ?? 'manual',
        input.effectiveDate ?? null,
        userId, userDisplayName,
        input.note ?? null,
      ],
    );
    const row = ins.rows[0]!;
    return {
      id: row.id,
      storeId,
      productId,
      skuCode: input.skuCode,
      oldPrice: oldPrice ?? null,
      newPrice: input.newPrice,
      source: input.source ?? 'manual',
      effectiveDate: ymd(row.effective_date),
      changedBy: userId,
      changedByDisplay: userDisplayName,
      note: input.note ?? null,
      createdAt: typeof row.created_at === 'string' ? row.created_at : (row.created_at as Date).toISOString(),
    };
  });
}

export async function listPriceChanges(args: {
  storeId: string;
  skuCode?: string;
  limit?: number;
}): Promise<PriceChangeRecord[]> {
  const params: unknown[] = [args.storeId];
  const filters: string[] = ['store_id = $1'];
  if (args.skuCode) {
    params.push(args.skuCode);
    filters.push(`sku_code = $${params.length}`);
  }
  params.push(Math.min(args.limit ?? 200, 1000));
  const res = await query<{
    id: string;
    store_id: string;
    product_id: string;
    sku_code: string;
    old_price: string | null;
    new_price: string;
    source: 'manual' | 'rule_engine';
    effective_date: string | Date;
    changed_by: string | null;
    changed_by_display: string | null;
    note: string | null;
    created_at: string;
  }>(
    `SELECT id, store_id, product_id, sku_code, old_price, new_price,
            source, effective_date, changed_by, changed_by_display, note, created_at
       FROM store_price_changes
      WHERE ${filters.join(' AND ')}
   ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    storeId: r.store_id,
    productId: r.product_id,
    skuCode: r.sku_code,
    oldPrice: r.old_price != null ? Number(r.old_price) : null,
    newPrice: Number(r.new_price),
    source: r.source,
    effectiveDate: ymd(r.effective_date),
    changedBy: r.changed_by,
    changedByDisplay: r.changed_by_display,
    note: r.note,
    createdAt: r.created_at,
  }));
}

