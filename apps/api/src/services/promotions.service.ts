import { query, withTransaction } from '../db/index.js';
import type {
  PromoBatch, PromoBestResult, PromoMechanicParams,
  ActivePromotionsResponse, RecommendPromotionsResponse, UploadResult,
} from '@myj/shared';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { parseWorkbook } from './promo/parser/index.js';
import { computeBest, type PricerOffer } from './promo/pricer/stacking.js';

export async function uploadPromotion(
  input: { fileBuffer: Buffer; fileName: string; sourceFileUrl?: string; notes?: string },
  userId: string,
): Promise<UploadResult> {
  const parsed = parseWorkbook(input.fileBuffer);
  if (parsed.rawItems.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Excel 中无有效行');
  }

  const rowTotal: Record<string, number> = {};
  const parsedTotal: Record<string, number> = {};
  for (const r of parsed.rawItems) rowTotal[r.activityType] = (rowTotal[r.activityType] ?? 0) + 1;
  for (const o of parsed.offers) parsedTotal[o.activityType] = (parsedTotal[o.activityType] ?? 0) + 1;

  const windowStart = parsed.rawItems.reduce((d, r) => r.validFrom < d ? r.validFrom : d, parsed.rawItems[0]!.validFrom);
  const windowEnd   = parsed.rawItems.reduce((d, r) => r.validTo   > d ? r.validTo   : d, parsed.rawItems[0]!.validTo);

  return withTransaction(async (client) => {
    // 串行化并发上传 — 否则两个并发上传都看到对方还没插入的旧批次状态,
    // 各自 UPDATE 旧批次后都 INSERT 新批次,留下两条 is_voided=false 的鬼批
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('hq_promo_batches.upload'))`);

    // 上传 = 全量替换:新批次入库前先把其它未作废批次全部作废,
    // 同一时刻只有一份生效文件
    await client.query(
      `UPDATE hq_promo_batches SET is_voided = true, updated_at = now() WHERE is_voided = false`,
    );

    const bRes = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO hq_promo_batches
         (file_name, source_file_url, uploaded_by, activity_window_start, activity_window_end,
          parse_warnings, row_total, parsed_total, parsed_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb, now(), $9)
       RETURNING id, created_at`,
      [
        input.fileName, input.sourceFileUrl ?? null, userId,
        windowStart, windowEnd,
        JSON.stringify(parsed.warnings),
        JSON.stringify(rowTotal),
        JSON.stringify(parsedTotal),
        input.notes ?? null,
      ],
    );
    const batchId = bRes.rows[0]!.id;

    // 写 raw_items → 拿到 id 映射
    const rawIdBySheetRowNo = new Map<number, string>();
    for (const r of parsed.rawItems) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO hq_promo_raw_items
           (batch_id, activity_type, sheet_row_no, sku_code, sku_name_original, unit,
            original_price, raw_method_text, qty_required, promo_total_price,
            promo_group_code, category_code, category_name, valid_from, valid_to,
            fill_down_anchor_row)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          batchId, r.activityType, r.sheetRowNo, r.skuCode, r.skuNameOriginal, r.unit,
          r.originalPrice, r.rawMethodText, r.qtyRequired, r.promoTotalPrice,
          r.promoGroupCode, r.categoryCode, r.categoryName, r.validFrom, r.validTo,
          r.fillDownAnchorRow,
        ],
      );
      rawIdBySheetRowNo.set(r.sheetRowNo, res.rows[0]!.id);
    }

    // 写 offers
    for (const o of parsed.offers) {
      const rawId = rawIdBySheetRowNo.get(o.rawItemSheetRowNo)!;
      await client.query(
        `INSERT INTO hq_promo_offers
           (raw_item_id, batch_id, activity_type, sku_code, mechanic, mechanic_params,
            pool_label, original_price, valid_weekday_mask, valid_from, valid_to,
            is_stackable, parse_note)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
        [
          rawId, batchId, o.activityType, o.skuCode, o.mechanic, JSON.stringify(o.mechanicParams),
          o.poolLabel, o.originalPrice, o.validWeekdayMask, o.validFrom, o.validTo,
          o.isStackable, o.parseNote,
        ],
      );
    }

    const batch = await loadBatch(client, batchId);
    return { batch, warnings: parsed.warnings };
  });
}

interface BatchRow {
  id: string; file_name: string; source_file_url: string | null; uploaded_by: string | null;
  is_voided: boolean; activity_window_start: string | null; activity_window_end: string | null;
  parse_warnings: unknown; row_total: unknown; parsed_total: unknown; parsed_at: string | null;
  notes: string | null; created_at: string;
}
function mapBatch(r: BatchRow): PromoBatch {
  return {
    id: r.id, fileName: r.file_name, sourceFileUrl: r.source_file_url, uploadedBy: r.uploaded_by,
    isVoided: r.is_voided, activityWindowStart: r.activity_window_start, activityWindowEnd: r.activity_window_end,
    parseWarnings: (r.parse_warnings as PromoBatch['parseWarnings']) ?? [],
    rowTotal: (r.row_total as PromoBatch['rowTotal']) ?? ({} as PromoBatch['rowTotal']),
    parsedTotal: (r.parsed_total as PromoBatch['parsedTotal']) ?? ({} as PromoBatch['parsedTotal']),
    parsedAt: r.parsed_at, notes: r.notes, createdAt: r.created_at,
  };
}

async function loadBatch(client: { query: typeof query } | { query: (...a: unknown[]) => Promise<unknown> }, batchId: string): Promise<PromoBatch> {
  const r = await (client as { query: typeof query }).query<BatchRow>(
    `SELECT id, file_name, source_file_url, uploaded_by, is_voided,
            activity_window_start, activity_window_end, parse_warnings,
            row_total, parsed_total, parsed_at, notes, created_at
       FROM hq_promo_batches WHERE id = $1`,
    [batchId],
  );
  return mapBatch(r.rows[0]!);
}

export async function listBatches(limit = 50): Promise<PromoBatch[]> {
  const res = await query<BatchRow>(
    `SELECT id, file_name, source_file_url, uploaded_by, is_voided,
            activity_window_start, activity_window_end, parse_warnings,
            row_total, parsed_total, parsed_at, notes, created_at
       FROM hq_promo_batches ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 200)],
  );
  return res.rows.map(mapBatch);
}

interface OfferRow {
  id: string; batch_id: string; activity_type: string; sku_code: string;
  mechanic: string; mechanic_params: PromoMechanicParams; pool_label: string | null;
  original_price: string; is_stackable: boolean;
  valid_from: string; valid_to: string; valid_weekday_mask: number;
}
interface ProductCtxRow { sku_code: string; product_name: string; unit: string | null; category_name: string | null; }

interface RawCtxRow { sku_code: string; sku_name_original: string; unit: string | null; category_name: string | null; }

interface PromoDataset {
  batches: PromoBatch[];
  offersBySku: Map<string, OfferRow[]>;
  ctx: Map<string, ProductCtxRow>;
  rawCtx: Map<string, RawCtxRow>;
}

async function fetchPromoDataset(): Promise<PromoDataset> {
  const batches = await listBatches();
  const offersRes = await query<OfferRow>(
    `SELECT id, batch_id, activity_type, sku_code, mechanic, mechanic_params,
            pool_label, original_price, is_stackable,
            to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
            to_char(valid_to,   'YYYY-MM-DD') AS valid_to,
            valid_weekday_mask
       FROM v_active_offers`,
  );
  if (offersRes.rows.length === 0) {
    return { batches, offersBySku: new Map(), ctx: new Map(), rawCtx: new Map() };
  }

  const skuCodes = Array.from(new Set(offersRes.rows.map((r) => r.sku_code)));
  // 主数据(hq_products + hq_categories) — 命中即权威
  const ctxRes = await query<ProductCtxRow>(
    `SELECT p.sku_code, p.product_name, p.unit, c.category_name
       FROM hq_products p
  LEFT JOIN hq_categories c ON c.id = p.category_id
      WHERE p.sku_code = ANY($1)`,
    [skuCodes],
  );
  const ctx = new Map(ctxRes.rows.map((r) => [r.sku_code, r]));
  // 兜底:本次上传里的档案行 — 不要按 category_name IS NOT NULL 过滤,否则
  // tuesday_member/brand_coupon sheet 那些不带"大类"列的 SKU 名字会丢,
  // 退到光秃秃的 sku_code 显示。这里两步:
  //   1) 取每个 SKU 最近一条有 sku_name_original 的行,做 name/unit 兜底
  //   2) 再叠一层"最近一条 category_name 非空"的行,做 category 兜底(category 可以缺,name 不能缺)
  const rawNameRes = await query<RawCtxRow>(
    `SELECT DISTINCT ON (sku_code) sku_code, sku_name_original, unit, category_name
       FROM hq_promo_raw_items
      WHERE sku_code = ANY($1) AND sku_name_original IS NOT NULL
   ORDER BY sku_code, created_at DESC`,
    [skuCodes],
  );
  const rawCtx = new Map(rawNameRes.rows.map((r) => [r.sku_code, r]));
  const rawCatRes = await query<{ sku_code: string; category_name: string }>(
    `SELECT DISTINCT ON (sku_code) sku_code, category_name
       FROM hq_promo_raw_items
      WHERE sku_code = ANY($1) AND category_name IS NOT NULL
   ORDER BY sku_code, created_at DESC`,
    [skuCodes],
  );
  for (const r of rawCatRes.rows) {
    const existing = rawCtx.get(r.sku_code);
    if (existing && !existing.category_name) existing.category_name = r.category_name;
  }

  const offersBySku = new Map<string, OfferRow[]>();
  for (const o of offersRes.rows) {
    if (!offersBySku.has(o.sku_code)) offersBySku.set(o.sku_code, []);
    offersBySku.get(o.sku_code)!.push(o);
  }
  return { batches, offersBySku, ctx, rawCtx };
}

/**
 * 把 dataset 里的 offers 算成最优档结果集。
 * - mode = 'stack' (默认): 全部 activity_type 都参与,允许叠 add-on
 * - mode = 'memberOnly': 解析时就过滤掉 member_price 以外的 offer 行,
 *   等于"只把会员价那部分喂给 computeBest";非 member_price base 的 SKU 直接跳过
 *
 * 注:这两条路是独立计算的,不是同一个 best 上的字段切换。
 */
function buildResultsFromDataset(data: PromoDataset, mode: 'stack' | 'memberOnly'): PromoBestResult[] {
  const { offersBySku, ctx, rawCtx } = data;
  const results: PromoBestResult[] = [];
  for (const [sku, allRows] of offersBySku) {
    const rows = mode === 'memberOnly'
      ? allRows.filter((r) => r.activity_type === 'member_price')
      : allRows;
    if (rows.length === 0) continue;
    const pricerOffers: PricerOffer[] = rows.map((r) => ({
      activityType: r.activity_type as PricerOffer['activityType'],
      mechanic: r.mechanic as PricerOffer['mechanic'],
      mechanicParams: r.mechanic_params,
      originalPrice: parseFloat(r.original_price),
      poolLabel: r.pool_label,
      isStackable: r.is_stackable,
      validWeekdayMask: r.valid_weekday_mask,
    }));
    const best = computeBest(pricerOffers, {});
    if (!best) continue;
    const baseOffer = pricerOffers[best.baseIdx]!;
    const addonOffer = best.addonIdx != null ? pricerOffers[best.addonIdx]! : null;
    const baseRow = rows[best.baseIdx]!;
    const addonRow = best.addonIdx != null ? rows[best.addonIdx]! : null;
    // 组合有效期 = base × addon 的日期交集 + mask 按位与
    const validFrom = addonRow && addonRow.valid_from > baseRow.valid_from ? addonRow.valid_from : baseRow.valid_from;
    const validTo   = addonRow && addonRow.valid_to   < baseRow.valid_to   ? addonRow.valid_to   : baseRow.valid_to;
    const validWeekdayMask = baseRow.valid_weekday_mask & (addonRow?.valid_weekday_mask ?? 0x7F);
    const c = ctx.get(sku);
    const raw = rawCtx.get(sku);
    results.push({
      skuCode: sku,
      productName: c?.product_name ?? raw?.sku_name_original ?? sku,
      unit: c?.unit ?? raw?.unit ?? null,
      // 优先 Excel 大类(粗粒度,跟前端 CATEGORY_GROUP_MAP 一一对应);
      // 缺 大类 列(brand_coupon sheet)才回落到 hq_categories(细粒度,常 fall to 其他)
      categoryName: raw?.category_name ?? c?.category_name ?? null,
      originalPrice: baseOffer.originalPrice,
      baseOfferId: baseRow.id,
      baseActivityType: baseOffer.activityType,
      addonActivityType: addonOffer?.activityType ?? null,
      addonOfferId: addonRow?.id ?? null,
      addonPoolLabel: addonOffer?.poolLabel ?? null,
      addonMechanicParams: addonOffer?.mechanicParams ?? null,
      bestUnitPrice: best.unitPrice,
      bestBundleTotal: best.bundleTotal,
      bestQty: best.qty,
      bestSavingPercent: best.savingPercent,
      validFrom,
      validTo,
      validWeekdayMask,
      poolLabel: baseOffer.poolLabel,
      poolSize: null,
    });
  }
  results.sort((a, b) => b.bestSavingPercent - a.bestSavingPercent);
  return results;
}

export async function listActivePromotions(): Promise<ActivePromotionsResponse> {
  const data = await fetchPromoDataset();
  return {
    batches: data.batches,
    results: buildResultsFromDataset(data, 'stack'),
    resultsMemberOnly: buildResultsFromDataset(data, 'memberOnly'),
  };
}

export async function recommendForUser(userId: string): Promise<RecommendPromotionsResponse> {
  const data = await fetchPromoDataset();
  const stack = buildResultsFromDataset(data, 'stack');
  const memberOnly = buildResultsFromDataset(data, 'memberOnly');
  if (stack.length === 0 && memberOnly.length === 0) {
    return { batches: data.batches, results: stack, resultsMemberOnly: memberOnly };
  }
  const usedRes = await query<{ category_name: string; cnt: number }>(
    `SELECT c.category_name, COUNT(*)::int AS cnt
       FROM store_poster_tasks t
       JOIN store_poster_task_products tp ON tp.task_id = t.id
       JOIN hq_products p ON p.id = tp.product_id
       LEFT JOIN hq_categories c ON c.id = p.category_id
      WHERE t.user_id = $1 AND c.category_name IS NOT NULL
        AND t.created_at >= now() - INTERVAL '30 days'
   GROUP BY c.category_name`,
    [userId],
  );
  const rank = new Map(usedRes.rows.map((r) => [r.category_name, r.cnt]));
  const rerank = (rs: PromoBestResult[]) => [...rs].sort((a, b) => {
    const ra = rank.get(a.categoryName ?? '') ?? 0;
    const rb = rank.get(b.categoryName ?? '') ?? 0;
    if (ra !== rb) return rb - ra;
    return b.bestSavingPercent - a.bestSavingPercent;
  });
  return {
    batches: data.batches,
    results: rerank(stack),
    resultsMemberOnly: rerank(memberOnly),
  };
}

export async function setBatchVoided(batchId: string, voided: boolean): Promise<PromoBatch> {
  const res = await query<BatchRow>(
    `UPDATE hq_promo_batches SET is_voided = $1, updated_at = now()
      WHERE id = $2
   RETURNING id, file_name, source_file_url, uploaded_by, is_voided,
             activity_window_start, activity_window_end, parse_warnings,
             row_total, parsed_total, parsed_at, notes, created_at`,
    [voided, batchId],
  );
  if (res.rows.length === 0) throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
  return mapBatch(res.rows[0]!);
}

export async function deleteBatch(batchId: string): Promise<{ deleted: boolean }> {
  const res = await query(`DELETE FROM hq_promo_batches WHERE id = $1`, [batchId]);
  return { deleted: (res.rowCount ?? 0) > 0 };
}
