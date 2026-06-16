/**
 * 价盘业务层（V027 起：产品定位重塑）
 *
 * 本 app 是"模拟器 + 销售分析"工具，不接入门店 POS，不写门店真实价。
 * 用户在工具里"模拟调价"算出目标价后须手动去经营系统调，下一周 snapshot 导入自然反映。
 *
 * 表归属：
 *   store_sku_snapshots      门店周快照（V027 起 retail_price 是唯一价格列，**价盘曲线/调价历史/涨跌对比唯一来源**）
 *   hq_products              商品主数据；wholesale_price JOIN 进 SKU 头部（成本线/利润计算）
 *   store_price_changes      表保留不删，但 V027 起读写路径均废弃；端点函数保留作孤儿
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ---- 价格曲线（V027：snapshot 单源） ----------------------------------------

export interface PriceCurvePoint {
  snapshotDate: string;            // YYYY-MM-DD
  retailPrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
}

export interface PriceCurveSku {
  skuCode: string;
  productName: string | null;
  /** 批发价（来自 hq_products，全期同值），用于成本/利润计算 */
  wholesalePrice: number | null;
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

  const params: unknown[] = [args.storeId];
  const filters: string[] = ['s.store_id = $1'];
  if (args.skuCodes && args.skuCodes.length > 0) {
    params.push(args.skuCodes);
    filters.push(`s.sku_code = ANY($${params.length}::text[])`);
  }
  params.push(days);
  filters.push(
    `s.snapshot_date >= CURRENT_DATE - ($${params.length}::int * INTERVAL '1 day')`,
  );

  // V027：snapshot 单源；hq_products JOIN 一次取 wholesale_price 进 SKU 头部
  const res = await query<{
    sku_code: string;
    product_name: string | null;
    wholesale_price: string | null;
    snapshot_date: string | Date;
    retail_price: string | null;
    sales_qty_30d: number | null;
    sales_amount_30d: string | null;
    gross_margin_30d: string | null;
  }>(
    `SELECT s.sku_code, p.product_name, p.wholesale_price,
            s.snapshot_date, s.retail_price,
            s.sales_qty_30d, s.sales_amount_30d, s.gross_margin_30d
       FROM store_sku_snapshots s
  LEFT JOIN hq_products p ON p.id = s.product_id AND p.deleted_at IS NULL
      WHERE ${filters.join(' AND ')}
   ORDER BY s.sku_code, s.snapshot_date`,
    params,
  );

  const bySku = new Map<string, PriceCurveSku>();
  for (const r of res.rows) {
    let entry = bySku.get(r.sku_code);
    if (!entry) {
      entry = {
        skuCode: r.sku_code,
        productName: r.product_name,
        wholesalePrice: r.wholesale_price != null ? Number(r.wholesale_price) : null,
        points: [],
      };
      bySku.set(r.sku_code, entry);
    }
    entry.points.push({
      snapshotDate: ymd(r.snapshot_date),
      retailPrice: r.retail_price != null ? Number(r.retail_price) : null,
      salesQty30d: r.sales_qty_30d,
      salesAmount30d: r.sales_amount_30d != null ? Number(r.sales_amount_30d) : null,
      grossMargin30d: r.gross_margin_30d != null ? Number(r.gross_margin_30d) : null,
    });
  }
  return Array.from(bySku.values());
}

// ---- 历史端点保留作孤儿 -----------------------------------------------------
// V027：表 store_price_changes 不再被前端读/写。下面三个函数保留：
//   - submitPriceChange / listPriceChanges：如果路由被外部脚本调用，仍可工作
//   - 前端 V027 起完全不调用这些端点；详见 [docs/database-schema.md] § store_price_changes

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

  // V027：缺省 oldPrice 直接 NULL（不再回查 snapshot.retail_price，避免给孤儿端点徒增依赖）
  const oldPrice = input.oldPrice;

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
