/**
 * 价盘管理业务层（决策 D3 落地：调价时同时写 ops_store_price_change + fact_store_sku_weekly）
 *
 * 表：
 *   ops_store_price_change   调价流水（每次调价 1 行）
 *   fact_store_sku_weekly    销售/价格快照（D3：调价时插一行 source='price_change'）
 *
 * 注：商品列表（含价格）和竞品价已在 master.service.ts 实现（合并 SK-C1+PR-A1、SK-C3+PR-A3）。
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { difyService } from './dify.service.js';

// ---- 价格曲线 ------------------------------------------------------------

export interface PriceCurvePoint {
  snapshotDate: string;
  retailPrice: number | null;
  originalPrice: number | null;
  wholesalePrice: number | null;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  grossMargin30d: number | null;
  source: string;
  priceChangeId: string | null;
}

export interface PriceCurveSku {
  skuCode: string;
  productName: string | null;
  points: PriceCurvePoint[];
}

export async function getPriceCurve(args: {
  storeId: string;
  skuCodes?: string[];
  /** 取最近多少天的快照（默认 365 天） */
  daysBack?: number;
}): Promise<PriceCurveSku[]> {
  const params: unknown[] = [args.storeId];
  const filters: string[] = ['f.store_id = $1'];

  if (args.skuCodes && args.skuCodes.length > 0) {
    params.push(args.skuCodes);
    filters.push(`f.sku_code = ANY($${params.length}::text[])`);
  }

  const days = Math.min(args.daysBack ?? 365, 1825); // 最多 5 年
  params.push(days);
  filters.push(
    `f.snapshot_date >= CURRENT_DATE - ($${params.length}::int * INTERVAL '1 day')`,
  );

  const res = await query<{
    sku_code: string;
    product_name: string | null;
    snapshot_date: string;
    retail_price: number | null;
    original_price: number | null;
    wholesale_price: number | null;
    sales_qty_30d: number | null;
    sales_amount_30d: number | null;
    gross_margin_30d: number | null;
    source: string;
    price_change_id: string | null;
  }>(
    `SELECT f.sku_code, p.product_name, f.snapshot_date, f.retail_price, f.original_price,
            f.wholesale_price, f.sales_qty_30d, f.sales_amount_30d, f.gross_margin_30d,
            f.source, f.price_change_id
       FROM fact_store_sku_weekly f
  LEFT JOIN dim_product p ON p.id = f.product_id AND p.deleted_at IS NULL
      WHERE ${filters.join(' AND ')}
   ORDER BY f.sku_code, f.snapshot_date, f.created_at`,
    params,
  );

  const bySku = new Map<string, PriceCurveSku>();
  for (const r of res.rows) {
    let entry = bySku.get(r.sku_code);
    if (!entry) {
      entry = { skuCode: r.sku_code, productName: r.product_name, points: [] };
      bySku.set(r.sku_code, entry);
    }
    entry.points.push({
      snapshotDate: r.snapshot_date,
      retailPrice: r.retail_price,
      originalPrice: r.original_price,
      wholesalePrice: r.wholesale_price,
      salesQty30d: r.sales_qty_30d,
      salesAmount30d: r.sales_amount_30d,
      grossMargin30d: r.gross_margin_30d,
      source: r.source,
      priceChangeId: r.price_change_id,
    });
  }

  return Array.from(bySku.values());
}

// ---- 调价（决策 D3 两步写入） -------------------------------------------

export interface SubmitPriceChangeInput {
  skuCode: string;
  newPrice: number;
  oldPrice?: number;
  source?: 'manual' | 'ai_suggest' | 'rule_engine';
  aiAdvice?: Record<string, unknown>;
  aiModel?: string;
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
  source: 'manual' | 'ai_suggest' | 'rule_engine';
  effectiveDate: string;
  createdAt: string;
}

export async function submitPriceChange(
  storeId: string,
  input: SubmitPriceChangeInput,
  userId: string,
  userDisplayName: string,
): Promise<PriceChangeRecord> {
  // 解析 product_id
  const prod = await query<{ id: string }>(
    `SELECT id FROM dim_product WHERE sku_code = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.skuCode],
  );
  const productId = prod.rows[0]?.id;
  if (!productId) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, `SKU ${input.skuCode} 不存在`);
  }

  // 取最近一次 retail_price 作为 old_price 回退值
  let oldPrice = input.oldPrice;
  if (oldPrice == null) {
    const latest = await query<{ retail_price: number | null }>(
      `SELECT retail_price FROM fact_store_sku_weekly
        WHERE store_id = $1 AND product_id = $2
     ORDER BY snapshot_date DESC, created_at DESC LIMIT 1`,
      [storeId, productId],
    );
    oldPrice = latest.rows[0]?.retail_price ?? undefined;
  }

  return withTransaction(async (client) => {
    // 1) 写 ops_store_price_change
    const ins = await client.query<{ id: string; created_at: string; effective_date: string }>(
      `INSERT INTO ops_store_price_change
         (store_id, product_id, sku_code, old_price, new_price, source,
          ai_advice, ai_model, effective_date, operator_user_id, operator_display, note)
       VALUES ($1, $2, $3, $4, $5, $6::price_change_source,
               $7::jsonb, $8, COALESCE($9, CURRENT_DATE), $10, $11, $12)
       RETURNING id, created_at, effective_date`,
      [
        storeId,
        productId,
        input.skuCode,
        oldPrice ?? null,
        input.newPrice,
        input.source ?? 'manual',
        JSON.stringify(input.aiAdvice ?? {}),
        input.aiModel ?? null,
        input.effectiveDate ?? null,
        userId,
        userDisplayName,
        input.note ?? null,
      ],
    );
    const row = ins.rows[0]!;

    // 2) 决策 D3：同时往 fact_store_sku_weekly 插一行 source='price_change'
    //    snapshot_date 用 effective_date；如同一天已有 source='price_change' 则更新 retail_price
    await client.query(
      `INSERT INTO fact_store_sku_weekly
         (store_id, product_id, sku_code, snapshot_date, retail_price, source, price_change_id)
       VALUES ($1, $2, $3, $4, $5, 'price_change', $6)
       ON CONFLICT (store_id, product_id, snapshot_date, source) DO UPDATE
         SET retail_price = EXCLUDED.retail_price,
             price_change_id = EXCLUDED.price_change_id`,
      [storeId, productId, input.skuCode, row.effective_date, input.newPrice, row.id],
    );

    return {
      id: row.id,
      storeId,
      productId,
      skuCode: input.skuCode,
      oldPrice: oldPrice ?? null,
      newPrice: input.newPrice,
      source: input.source ?? 'manual',
      effectiveDate: row.effective_date,
      createdAt: row.created_at,
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
    old_price: number | null;
    new_price: number;
    source: 'manual' | 'ai_suggest' | 'rule_engine';
    effective_date: string;
    created_at: string;
  }>(
    `SELECT id, store_id, product_id, sku_code, old_price, new_price,
            source, effective_date, created_at
       FROM ops_store_price_change
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
    oldPrice: r.old_price,
    newPrice: r.new_price,
    source: r.source,
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
  }));
}

// ---- AI 诊断（PR-B1，走统一 AI 网关） ------------------------------------

export interface DiagnoseSkuInput {
  skuCode: string;
  currentPrice: number;
  wholesalePrice?: number;
  salesQty30d?: number;
  grossMargin30d?: number;
  competitorPrices?: Array<{ channel: string; price: number }>;
}

export interface DiagnoseSkuResult {
  skuCode: string;
  suggestion: 'up' | 'down' | 'hold' | 'unknown';
  suggestedPrice: number | null;
  reasoning: string;
  confidence: number;
  source: string;
}

export async function diagnoseBatch(
  storeId: string,
  skus: DiagnoseSkuInput[],
  userId: string,
): Promise<DiagnoseSkuResult[]> {
  if (skus.length === 0) return [];

  // 调一次 Dify price-diagnose workflow，把整批 SKU 作为 inputs.skus 传过去
  // Dify 端可以批处理或逐条；返回格式假设为 { results: [{ sku_code, suggestion, ... }] }
  const outputs = await difyService.invoke(
    'price-diagnose',
    { store_id: storeId, skus },
    { userId },
  );

  const results = Array.isArray(outputs.results) ? outputs.results : [];
  const byCode = new Map<string, DiagnoseSkuResult>();

  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, unknown>;
    const skuCode = typeof obj.sku_code === 'string' ? obj.sku_code : '';
    if (!skuCode) continue;
    const suggestion = ['up', 'down', 'hold'].includes(String(obj.suggestion))
      ? (obj.suggestion as DiagnoseSkuResult['suggestion'])
      : 'unknown';
    byCode.set(skuCode, {
      skuCode,
      suggestion,
      suggestedPrice:
        typeof obj.suggested_price === 'number' ? obj.suggested_price : null,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
      source: typeof obj.source === 'string' ? obj.source : 'dify',
    });
  }

  // 保留请求顺序，缺的 SKU 填 unknown
  return skus.map((s) => byCode.get(s.skuCode) ?? {
    skuCode: s.skuCode,
    suggestion: 'unknown',
    suggestedPrice: null,
    reasoning: 'AI 未返回该 SKU 诊断',
    confidence: 0,
    source: 'dify',
  });
}
