/**
 * 促销批次业务层
 *
 * 表：
 *   promotion_uploads    Excel 批次（is_active 全局唯一一条）
 *   product_promotions   批次内单品
 *   promotion_groups     可混搭组（同 mix_group_code 聚合）
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export interface PromotionUpload {
  id: string;
  fileName: string;
  sourceFileUrl: string | null;
  rowTotal: number;
  productCount: number;
  groupCount: number;
  isActive: boolean;
  activatedAt: string | null;
  parseWarnings: unknown[];
  notes: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ProductPromotion {
  id: string;
  uploadId: string;
  rowIndex: number;
  skuCode: string;
  productName: string;
  unit: string | null;
  categoryName: string | null;
  originalPrice: number | null;
  bestLabel: string | null;
  bestRequiredQty: number | null;
  bestTotalPrice: number | null;
  bestEffectiveUnitPrice: number | null;
  bestSavingPercent: number | null;
  allOptions: unknown[];
  validFrom: string | null;
  validTo: string | null;
  validDates: string[] | null;
  mixGroupCode: string | null;
  displayText: string | null;
}

export interface PromotionGroupRow {
  id: string;
  uploadId: string;
  mixGroupCode: string;
  displayName: string | null;
  categoryName: string | null;
  skuCodes: string[];
  productCount: number;
  bestLabel: string | null;
  bestTotalPrice: number | null;
  bestSavingPercent: number | null;
  representativeImageUrl: string | null;
}

// ---- 上传 + 解析（PO-E1） -----------------------------------------------

export interface UploadPromotionInput {
  fileName: string;
  sourceFileUrl?: string;
  notes?: string;
  rows: Array<{
    rowIndex: number;
    skuCode: string;
    productName: string;
    unit?: string;
    categoryName?: string;
    originalPrice?: number;
    bestLabel?: string;
    bestRequiredQty?: number;
    bestTotalPrice?: number;
    bestEffectiveUnitPrice?: number;
    bestSavingPercent?: number;
    allOptions?: unknown[];
    validFrom?: string;
    validTo?: string;
    validDates?: string[];
    mixGroupCode?: string;
    displayText?: string;
  }>;
  /** 上传后是否立即激活（替换当前 active） */
  activate?: boolean;
}

export interface UploadResult {
  upload: PromotionUpload;
  productCount: number;
  groupCount: number;
  warnings: string[];
}

export async function uploadPromotion(
  input: UploadPromotionInput,
  userId: string,
): Promise<UploadResult> {
  const warnings: string[] = [];
  if (input.rows.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, 'rows 不能为空');
  }

  return withTransaction(async (client) => {
    // 1) 写 promotion_uploads
    const upRes = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO promotion_uploads
         (file_name, source_file_url, uploaded_by, row_total, notes, parse_warnings)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, created_at`,
      [
        input.fileName,
        input.sourceFileUrl ?? null,
        userId,
        input.rows.length,
        input.notes ?? null,
        JSON.stringify(warnings),
      ],
    );
    const uploadId = upRes.rows[0]!.id;
    const createdAt = upRes.rows[0]!.created_at;

    // 2) 批量写 product_promotions
    let productCount = 0;
    for (const r of input.rows) {
      try {
        await client.query(
          `INSERT INTO product_promotions
             (upload_id, row_index, sku_code, product_name, unit, category_name,
              original_price, best_label, best_required_qty, best_total_price,
              best_effective_unit_price, best_saving_percent, all_options,
              valid_from, valid_to, valid_dates, mix_group_code, display_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
                   $14, $15, $16::date[], $17, $18)`,
          [
            uploadId,
            r.rowIndex,
            r.skuCode,
            r.productName,
            r.unit ?? null,
            r.categoryName ?? null,
            r.originalPrice ?? null,
            r.bestLabel ?? null,
            r.bestRequiredQty ?? null,
            r.bestTotalPrice ?? null,
            r.bestEffectiveUnitPrice ?? null,
            r.bestSavingPercent ?? null,
            JSON.stringify(r.allOptions ?? []),
            r.validFrom ?? null,
            r.validTo ?? null,
            r.validDates ?? null,
            r.mixGroupCode ?? null,
            r.displayText ?? null,
          ],
        );
        productCount++;
      } catch (err) {
        warnings.push(`row ${r.rowIndex} 入库失败: ${(err as Error).message}`);
      }
    }

    // 3) 聚合 promotion_groups（按 mix_group_code）
    const groupRes = await client.query<{
      mix_group_code: string;
      sku_codes: string[];
      category_name: string | null;
      best_label: string | null;
      best_total_price: number | null;
      best_saving_percent: number | null;
      product_count: number;
    }>(
      `SELECT mix_group_code,
              array_agg(sku_code ORDER BY row_index) AS sku_codes,
              (array_agg(category_name) FILTER (WHERE category_name IS NOT NULL))[1] AS category_name,
              (array_agg(best_label ORDER BY best_saving_percent DESC NULLS LAST))[1] AS best_label,
              MIN(best_total_price) AS best_total_price,
              MAX(best_saving_percent) AS best_saving_percent,
              COUNT(*)::int AS product_count
         FROM product_promotions
        WHERE upload_id = $1 AND mix_group_code IS NOT NULL
     GROUP BY mix_group_code`,
      [uploadId],
    );
    for (const g of groupRes.rows) {
      await client.query(
        `INSERT INTO promotion_groups
           (upload_id, mix_group_code, display_name, category_name, sku_codes,
            product_count, best_label, best_total_price, best_saving_percent)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)
         ON CONFLICT (upload_id, mix_group_code) DO NOTHING`,
        [
          uploadId,
          g.mix_group_code,
          g.category_name ? `${g.category_name} 系列` : null,
          g.category_name,
          g.sku_codes,
          g.product_count,
          g.best_label,
          g.best_total_price,
          g.best_saving_percent,
        ],
      );
    }
    const groupCount = groupRes.rows.length;

    // 4) 回写 uploads 的计数 + warnings
    await client.query(
      `UPDATE promotion_uploads
          SET product_count = $1, group_count = $2, parse_warnings = $3::jsonb, updated_at = now()
        WHERE id = $4`,
      [productCount, groupCount, JSON.stringify(warnings), uploadId],
    );

    // 5) 激活：先把所有 active 设 false，再把本批次设 active
    if (input.activate) {
      await client.query(
        `UPDATE promotion_uploads
            SET is_active = FALSE, deactivated_at = now()
          WHERE is_active = TRUE`,
      );
      await client.query(
        `UPDATE promotion_uploads
            SET is_active = TRUE, activated_at = now()
          WHERE id = $1`,
        [uploadId],
      );
    }

    const upload: PromotionUpload = {
      id: uploadId,
      fileName: input.fileName,
      sourceFileUrl: input.sourceFileUrl ?? null,
      rowTotal: input.rows.length,
      productCount,
      groupCount,
      isActive: !!input.activate,
      activatedAt: input.activate ? new Date().toISOString() : null,
      parseWarnings: warnings,
      notes: input.notes ?? null,
      uploadedBy: userId,
      createdAt,
    };

    return { upload, productCount, groupCount, warnings };
  });
}

// ---- 列出批次（PO-E2） --------------------------------------------------

export async function listBatches(limit = 50): Promise<PromotionUpload[]> {
  const res = await query<{
    id: string;
    file_name: string;
    source_file_url: string | null;
    row_total: number;
    product_count: number;
    group_count: number;
    is_active: boolean;
    activated_at: string | null;
    parse_warnings: unknown[];
    notes: string | null;
    uploaded_by: string | null;
    created_at: string;
  }>(
    `SELECT id, file_name, source_file_url, row_total, product_count, group_count,
            is_active, activated_at, parse_warnings, notes, uploaded_by, created_at
       FROM promotion_uploads
   ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(limit, 200)],
  );
  return res.rows.map(mapUpload);
}

function mapUpload(r: {
  id: string;
  file_name: string;
  source_file_url: string | null;
  row_total: number;
  product_count: number;
  group_count: number;
  is_active: boolean;
  activated_at: string | null;
  parse_warnings: unknown[];
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
}): PromotionUpload {
  return {
    id: r.id,
    fileName: r.file_name,
    sourceFileUrl: r.source_file_url,
    rowTotal: r.row_total,
    productCount: r.product_count,
    groupCount: r.group_count,
    isActive: r.is_active,
    activatedAt: r.activated_at,
    parseWarnings: r.parse_warnings,
    notes: r.notes,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

// ---- 查询当前生效（PO-E3） ----------------------------------------------

export async function listActivePromotions(): Promise<{
  upload: PromotionUpload | null;
  products: ProductPromotion[];
  groups: PromotionGroupRow[];
}> {
  const upRes = await query<Parameters<typeof mapUpload>[0]>(
    `SELECT id, file_name, source_file_url, row_total, product_count, group_count,
            is_active, activated_at, parse_warnings, notes, uploaded_by, created_at
       FROM promotion_uploads
      WHERE is_active = TRUE
      LIMIT 1`,
  );
  const upload = upRes.rows[0] ? mapUpload(upRes.rows[0]) : null;
  if (!upload) return { upload: null, products: [], groups: [] };

  const productsRes = await query<ProductPromotionDb>(
    `SELECT id, upload_id, row_index, sku_code, product_name, unit, category_name,
            original_price, best_label, best_required_qty, best_total_price,
            best_effective_unit_price, best_saving_percent, all_options,
            valid_from, valid_to, valid_dates, mix_group_code, display_text
       FROM product_promotions
      WHERE upload_id = $1
   ORDER BY best_saving_percent DESC NULLS LAST, row_index`,
    [upload.id],
  );

  const groupsRes = await query<PromotionGroupDb>(
    `SELECT id, upload_id, mix_group_code, display_name, category_name, sku_codes,
            product_count, best_label, best_total_price, best_saving_percent,
            representative_image_url
       FROM promotion_groups
      WHERE upload_id = $1
   ORDER BY product_count DESC, mix_group_code`,
    [upload.id],
  );

  return {
    upload,
    products: productsRes.rows.map(mapProductPromotion),
    groups: groupsRes.rows.map(mapGroup),
  };
}

interface ProductPromotionDb {
  id: string;
  upload_id: string;
  row_index: number;
  sku_code: string;
  product_name: string;
  unit: string | null;
  category_name: string | null;
  original_price: number | null;
  best_label: string | null;
  best_required_qty: number | null;
  best_total_price: number | null;
  best_effective_unit_price: number | null;
  best_saving_percent: number | null;
  all_options: unknown[];
  valid_from: string | null;
  valid_to: string | null;
  valid_dates: string[] | null;
  mix_group_code: string | null;
  display_text: string | null;
}

function mapProductPromotion(r: ProductPromotionDb): ProductPromotion {
  return {
    id: r.id,
    uploadId: r.upload_id,
    rowIndex: r.row_index,
    skuCode: r.sku_code,
    productName: r.product_name,
    unit: r.unit,
    categoryName: r.category_name,
    originalPrice: r.original_price,
    bestLabel: r.best_label,
    bestRequiredQty: r.best_required_qty,
    bestTotalPrice: r.best_total_price,
    bestEffectiveUnitPrice: r.best_effective_unit_price,
    bestSavingPercent: r.best_saving_percent,
    allOptions: r.all_options,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    validDates: r.valid_dates,
    mixGroupCode: r.mix_group_code,
    displayText: r.display_text,
  };
}

interface PromotionGroupDb {
  id: string;
  upload_id: string;
  mix_group_code: string;
  display_name: string | null;
  category_name: string | null;
  sku_codes: string[];
  product_count: number;
  best_label: string | null;
  best_total_price: number | null;
  best_saving_percent: number | null;
  representative_image_url: string | null;
}

function mapGroup(r: PromotionGroupDb): PromotionGroupRow {
  return {
    id: r.id,
    uploadId: r.upload_id,
    mixGroupCode: r.mix_group_code,
    displayName: r.display_name,
    categoryName: r.category_name,
    skuCodes: r.sku_codes,
    productCount: r.product_count,
    bestLabel: r.best_label,
    bestTotalPrice: r.best_total_price,
    bestSavingPercent: r.best_saving_percent,
    representativeImageUrl: r.representative_image_url,
  };
}

// ---- 个性化推荐（PO-E4） ------------------------------------------------

/**
 * 按用户最近 30 天生成过哪些品类的海报，把当前生效促销重新排序
 * （用过的品类优先）
 */
export async function recommendForUser(userId: string): Promise<{
  upload: PromotionUpload | null;
  products: ProductPromotion[];
}> {
  const active = await listActivePromotions();
  if (!active.upload) return { upload: null, products: [] };

  const usedRes = await query<{ category_name: string; cnt: number }>(
    `SELECT category_name, COUNT(*)::int AS cnt
       FROM posters
      WHERE user_id = $1
        AND category_name IS NOT NULL
        AND created_at >= now() - INTERVAL '30 days'
   GROUP BY category_name`,
    [userId],
  );
  const usedRank = new Map<string, number>();
  for (const u of usedRes.rows) usedRank.set(u.category_name, u.cnt);

  const sorted = [...active.products].sort((a, b) => {
    const ra = usedRank.get(a.categoryName ?? '') ?? 0;
    const rb = usedRank.get(b.categoryName ?? '') ?? 0;
    if (ra !== rb) return rb - ra;
    return (b.bestSavingPercent ?? 0) - (a.bestSavingPercent ?? 0);
  });

  return { upload: active.upload, products: sorted };
}

// ---- 删除 / 切换激活（PO-E5 / PO-E6） ----------------------------------

export async function deleteBatch(batchId: string): Promise<{ deleted: boolean }> {
  const res = await query(`DELETE FROM promotion_uploads WHERE id = $1`, [batchId]);
  return { deleted: (res.rowCount ?? 0) > 0 };
}

export async function activateBatch(batchId: string): Promise<PromotionUpload> {
  return withTransaction(async (client) => {
    const exists = await client.query<{ id: string }>(
      `SELECT id FROM promotion_uploads WHERE id = $1 LIMIT 1`,
      [batchId],
    );
    if (exists.rows.length === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '批次不存在');
    }
    await client.query(
      `UPDATE promotion_uploads
          SET is_active = FALSE, deactivated_at = now()
        WHERE is_active = TRUE AND id != $1`,
      [batchId],
    );
    const res = await client.query<Parameters<typeof mapUpload>[0]>(
      `UPDATE promotion_uploads
          SET is_active = TRUE, activated_at = now(), updated_at = now()
        WHERE id = $1
    RETURNING id, file_name, source_file_url, row_total, product_count, group_count,
              is_active, activated_at, parse_warnings, notes, uploaded_by, created_at`,
      [batchId],
    );
    return mapUpload(res.rows[0]!);
  });
}
