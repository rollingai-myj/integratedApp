/**
 * 模块 3 + 模块 4 业务层：门店 / 商品 / 销售 / 竞品 / 促销文案 / 基准 SKU
 *
 * 所有查询都按"超管看全部、店长仅本人 user_stores"的可见性收口。
 * 写入操作（PUT/POST）目前仅做基础上下文校验，列权限（如店长不能改门店主数据）
 * 留到 M5 后台再细化。
 */
import { query, withTransaction } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ---- 类型 -----------------------------------------------------------------

export interface StoreDetail {
  id: string;
  code: string;
  name: string;
  ownership: 'direct' | 'franchise';
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openedAt: string | null;
  status: 'active' | 'disabled';
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  level: number;
  displayOrder: number;
}

export interface ProductRow {
  id: string;
  skuCode: string;
  productName: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  shelfLifeDays: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  categoryId: string | null;
  categoryPath: string | null;
  isNewProduct: boolean;
  isPrivateLabel: boolean;
  wholesalePrice: number | null;
  suggestedRetailPrice: number | null;
  introducedAt: string | null;
  officialImageUrl: string | null;
  status: 'active' | 'delisted';
}

export interface StoreSkuRow extends ProductRow {
  /** 门店当前售价（取最新一条快照 retail_price） */
  retailPrice: number | null;
  originalPrice: number | null;
  /** 是否被调过价（lifetime 内有 ops_store_price_change 记录） */
  hasPriceChange: boolean;
  salesQty30d: number | null;
  salesAmount30d: number | null;
  salesQty90d: number | null;
  salesAmount90d: number | null;
  grossMargin30d: number | null;
  stockQty: number | null;
  lastDeliveryAt: string | null;
  snapshotDate: string | null;
}

export interface CompetitorRow {
  id: string;
  channelCode: string;
  channelName: string;
  channelKind: 'online' | 'offline';
  productName: string;
  brand: string | null;
  spec: string | null;
  mappedSkuCode: string | null;
  latestPrice: number | null;
  latestPromoPrice: number | null;
  latestPromoText: string | null;
  latestSnapshotDate: string | null;
}

export interface BenchmarkSkuRow {
  skuCode: string;
  productName: string | null;
  segment: 'core' | 'innovation';
  categoryPath: string | null;
  reason: string | null;
}

export interface PromoTextRow {
  groupCode: string;
  groupName: string | null;
  skuCode: string;
  promoText: string;
  categoryPath: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

// ---- 门店主数据 -----------------------------------------------------------

export async function listStores(args: {
  userId: string;
  isSuperAdmin: boolean;
  id?: string;
}): Promise<StoreDetail[]> {
  const params: unknown[] = [];
  const filters: string[] = ['s.deleted_at IS NULL'];

  if (!args.isSuperAdmin) {
    params.push(args.userId);
    filters.push(
      `EXISTS (SELECT 1 FROM user_stores us WHERE us.user_id = $${params.length} AND us.store_id = s.id)`,
    );
  }
  if (args.id) {
    params.push(args.id);
    filters.push(`s.id = $${params.length}`);
  }

  const sql = `
    SELECT s.id, s.store_code, s.store_name, s.ownership, s.province, s.city,
           s.district, s.address, s.latitude, s.longitude, s.opened_at, s.status
      FROM stores s
     WHERE ${filters.join(' AND ')}
  ORDER BY s.store_code
  `;
  const res = await query<{
    id: string;
    store_code: string;
    store_name: string;
    ownership: 'direct' | 'franchise';
    province: string | null;
    city: string | null;
    district: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    opened_at: string | null;
    status: 'active' | 'disabled';
  }>(sql, params);
  return res.rows.map((r) => ({
    id: r.id,
    code: r.store_code,
    name: r.store_name,
    ownership: r.ownership,
    province: r.province,
    city: r.city,
    district: r.district,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
    openedAt: r.opened_at,
    status: r.status,
  }));
}

export interface UpsertStoreInput {
  storeCode: string;
  storeName: string;
  ownership?: 'direct' | 'franchise';
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openedAt?: string | null;
  status?: 'active' | 'disabled';
}

export async function upsertStore(
  id: string,
  input: UpsertStoreInput,
): Promise<StoreDetail> {
  // 先尝试更新；不存在则按 id 插入
  const existing = await query<{ id: string }>(
    `SELECT id FROM stores WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO stores (id, store_code, store_name, ownership, province, city, district, address, latitude, longitude, opened_at, status)
       VALUES ($1, $2, $3, COALESCE($4, 'franchise'), $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'active'))`,
      [
        id,
        input.storeCode,
        input.storeName,
        input.ownership ?? null,
        input.province ?? null,
        input.city ?? null,
        input.district ?? null,
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.openedAt ?? null,
        input.status ?? null,
      ],
    );
  } else {
    await query(
      `UPDATE stores
          SET store_code = $2, store_name = $3,
              ownership = COALESCE($4, ownership),
              province = $5, city = $6, district = $7, address = $8,
              latitude = $9, longitude = $10, opened_at = $11,
              status = COALESCE($12, status),
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        input.storeCode,
        input.storeName,
        input.ownership ?? null,
        input.province ?? null,
        input.city ?? null,
        input.district ?? null,
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.openedAt ?? null,
        input.status ?? null,
      ],
    );
  }
  const after = await listStores({ userId: '', isSuperAdmin: true, id });
  const out = after[0];
  if (!out) throw new AppError(404, ErrorCodes.STORE_NOT_FOUND, '门店保存失败');
  return out;
}

// ---- 周边洞察 -------------------------------------------------------------

export interface InsightQuestion {
  id: number;
  direction: string;
  context: string;
  question: string;
  options: string[];
}

export interface EnvironmentInsight {
  storeId: string;
  // 基础结构化字段（M0 已有）
  city: string | null;
  mainDemographic: string | null;
  consumptionLevel: string | null;
  competitorCount: number | null;
  populationDensity: string | null;
  // V025 加：原 skuSelection repo 的扩展字段
  category: string | null;
  crowdSourceAnalysis: string | null;
  competitorAnalysis: string | null;
  topCompetitors: string[];
  questions: InsightQuestion[];
  reportMarkdown: string | null;
  // 兜底 + 元数据
  insightData: Record<string, unknown>;
  generatedAt: string;
  source: string | null;
}

export async function getEnvironmentInsight(
  storeId: string,
): Promise<EnvironmentInsight | null> {
  const res = await query<{
    store_id: string;
    city: string | null;
    main_demographic: string | null;
    consumption_level: string | null;
    competitor_count: number | null;
    population_density: string | null;
    category: string | null;
    crowd_source_analysis: string | null;
    competitor_analysis: string | null;
    top_competitors: unknown;
    questions: unknown;
    report_markdown: string | null;
    insight_data: Record<string, unknown>;
    generated_at: string;
    source: string | null;
  }>(
    `SELECT store_id, city, main_demographic, consumption_level, competitor_count,
            population_density, category, crowd_source_analysis, competitor_analysis,
            top_competitors, questions, report_markdown,
            insight_data, generated_at, source
       FROM store_environment_insights
      WHERE store_id = $1
      LIMIT 1`,
    [storeId],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    storeId: r.store_id,
    city: r.city,
    mainDemographic: r.main_demographic,
    consumptionLevel: r.consumption_level,
    competitorCount: r.competitor_count,
    populationDensity: r.population_density,
    category: r.category,
    crowdSourceAnalysis: r.crowd_source_analysis,
    competitorAnalysis: r.competitor_analysis,
    topCompetitors: Array.isArray(r.top_competitors)
      ? (r.top_competitors as string[])
      : [],
    questions: Array.isArray(r.questions)
      ? (r.questions as InsightQuestion[])
      : [],
    reportMarkdown: r.report_markdown,
    insightData: r.insight_data,
    generatedAt: r.generated_at,
    source: r.source,
  };
}

export interface UpsertInsightInput {
  city?: string | null;
  mainDemographic?: string | null;
  consumptionLevel?: string | null;
  competitorCount?: number | null;
  populationDensity?: string | null;
  category?: string | null;
  crowdSourceAnalysis?: string | null;
  competitorAnalysis?: string | null;
  topCompetitors?: string[];
  questions?: InsightQuestion[];
  reportMarkdown?: string | null;
  insightData?: Record<string, unknown>;
  source?: string | null;
}

export async function upsertEnvironmentInsight(
  storeId: string,
  input: UpsertInsightInput,
  generatedBy: string,
): Promise<EnvironmentInsight> {
  // 仅更新调用方传了的字段（partial upsert）—— 让 InfoPage 分段保存（环境段 / 问答段
  // / 货架段）不会互相覆盖。
  const existing = await getEnvironmentInsight(storeId);
  await query(
    `INSERT INTO store_environment_insights
       (store_id, city, main_demographic, consumption_level, competitor_count,
        population_density, category, crowd_source_analysis, competitor_analysis,
        top_competitors, questions, report_markdown,
        insight_data, source, generated_by, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12,
             $13::jsonb, $14, $15, now())
     ON CONFLICT (store_id) DO UPDATE
       SET city = EXCLUDED.city,
           main_demographic = EXCLUDED.main_demographic,
           consumption_level = EXCLUDED.consumption_level,
           competitor_count = EXCLUDED.competitor_count,
           population_density = EXCLUDED.population_density,
           category = EXCLUDED.category,
           crowd_source_analysis = EXCLUDED.crowd_source_analysis,
           competitor_analysis = EXCLUDED.competitor_analysis,
           top_competitors = EXCLUDED.top_competitors,
           questions = EXCLUDED.questions,
           report_markdown = EXCLUDED.report_markdown,
           insight_data = EXCLUDED.insight_data,
           source = EXCLUDED.source,
           generated_by = EXCLUDED.generated_by,
           generated_at = now(),
           updated_at = now()`,
    [
      storeId,
      input.city !== undefined ? input.city : (existing?.city ?? null),
      input.mainDemographic !== undefined ? input.mainDemographic : (existing?.mainDemographic ?? null),
      input.consumptionLevel !== undefined ? input.consumptionLevel : (existing?.consumptionLevel ?? null),
      input.competitorCount !== undefined ? input.competitorCount : (existing?.competitorCount ?? null),
      input.populationDensity !== undefined ? input.populationDensity : (existing?.populationDensity ?? null),
      input.category !== undefined ? input.category : (existing?.category ?? null),
      input.crowdSourceAnalysis !== undefined ? input.crowdSourceAnalysis : (existing?.crowdSourceAnalysis ?? null),
      input.competitorAnalysis !== undefined ? input.competitorAnalysis : (existing?.competitorAnalysis ?? null),
      JSON.stringify(input.topCompetitors ?? existing?.topCompetitors ?? []),
      JSON.stringify(input.questions ?? existing?.questions ?? []),
      input.reportMarkdown !== undefined ? input.reportMarkdown : (existing?.reportMarkdown ?? null),
      JSON.stringify(input.insightData ?? existing?.insightData ?? {}),
      input.source ?? existing?.source ?? 'manual',
      generatedBy,
    ],
  );
  const out = await getEnvironmentInsight(storeId);
  if (!out) throw new AppError(500, ErrorCodes.INTERNAL_ERROR, '周边洞察保存失败');
  return out;
}

// ---- 商品分类 / 商品库 ---------------------------------------------------

export async function listCategories(): Promise<CategoryNode[]> {
  const res = await query<{
    id: string;
    parent_id: string | null;
    category_code: string;
    category_name: string;
    level: number;
    display_order: number;
  }>(
    `SELECT id, parent_id, category_code, category_name, level, display_order
       FROM dim_category
      WHERE is_active = TRUE
   ORDER BY level, display_order, category_code`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    code: r.category_code,
    name: r.category_name,
    level: r.level,
    displayOrder: r.display_order,
  }));
}

export async function listProducts(args: {
  search?: string;
  categoryId?: string;
  limit?: number;
}): Promise<ProductRow[]> {
  const params: unknown[] = [];
  const filters: string[] = ['deleted_at IS NULL'];
  if (args.search) {
    params.push(`%${args.search}%`);
    filters.push(`(product_name ILIKE $${params.length} OR sku_code ILIKE $${params.length})`);
  }
  if (args.categoryId) {
    params.push(args.categoryId);
    filters.push(`category_id = $${params.length}`);
  }
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
  params.push(limit);

  const res = await query<ProductDbRow>(
    `SELECT id, sku_code, product_name, brand, spec, unit, shelf_life_days,
            length_mm, width_mm, height_mm, category_id, category_path,
            is_new_product, is_private_label, wholesale_price, suggested_retail_price,
            introduced_at, official_image_url, status
       FROM dim_product
      WHERE ${filters.join(' AND ')}
   ORDER BY sku_code
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(mapProduct);
}

interface ProductDbRow {
  id: string;
  sku_code: string;
  product_name: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  shelf_life_days: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  category_id: string | null;
  category_path: string | null;
  is_new_product: boolean;
  is_private_label: boolean;
  wholesale_price: number | null;
  suggested_retail_price: number | null;
  introduced_at: string | null;
  official_image_url: string | null;
  status: 'active' | 'delisted';
}

function mapProduct(r: ProductDbRow): ProductRow {
  return {
    id: r.id,
    skuCode: r.sku_code,
    productName: r.product_name,
    brand: r.brand,
    spec: r.spec,
    unit: r.unit,
    shelfLifeDays: r.shelf_life_days,
    lengthMm: r.length_mm,
    widthMm: r.width_mm,
    heightMm: r.height_mm,
    categoryId: r.category_id,
    categoryPath: r.category_path,
    isNewProduct: r.is_new_product,
    isPrivateLabel: r.is_private_label,
    wholesalePrice: r.wholesale_price,
    suggestedRetailPrice: r.suggested_retail_price,
    introducedAt: r.introduced_at,
    officialImageUrl: r.official_image_url,
    status: r.status,
  };
}

// ---- 门店在售 SKU --------------------------------------------------------

/**
 * 合并 SK-C1 + PR-A1：返回门店所有在售 SKU 的最新销售快照 + 当前价。
 *
 * "当前价"取每个 SKU 最新 snapshot_date 的 retail_price（D3 决策：调价时插新快照）。
 * "是否已调过价"用 lifetime 内是否存在 ops_store_price_change 记录判定。
 */
export async function listStoreSkus(args: {
  storeId: string;
  search?: string;
  categoryPath?: string;
}): Promise<StoreSkuRow[]> {
  const params: unknown[] = [args.storeId];
  const extra: string[] = [];
  if (args.search) {
    params.push(`%${args.search}%`);
    extra.push(`(p.product_name ILIKE $${params.length} OR p.sku_code ILIKE $${params.length})`);
  }
  if (args.categoryPath) {
    params.push(args.categoryPath);
    extra.push(`p.category_path = $${params.length}`);
  }
  const sql = `
    WITH latest_snap AS (
      SELECT DISTINCT ON (store_id, product_id)
             store_id, product_id, retail_price, original_price,
             sales_qty_30d, sales_amount_30d, sales_qty_90d, sales_amount_90d,
             gross_margin_30d, stock_qty, last_delivery_at, snapshot_date
        FROM fact_store_sku_weekly
       WHERE store_id = $1
    ORDER BY store_id, product_id, snapshot_date DESC, created_at DESC
    ),
    price_changed AS (
      SELECT DISTINCT product_id FROM ops_store_price_change WHERE store_id = $1
    )
    SELECT p.id, p.sku_code, p.product_name, p.brand, p.spec, p.unit, p.shelf_life_days,
           p.length_mm, p.width_mm, p.height_mm, p.category_id, p.category_path,
           p.is_new_product, p.is_private_label, p.wholesale_price, p.suggested_retail_price,
           p.introduced_at, p.official_image_url, p.status,
           ls.retail_price, ls.original_price,
           ls.sales_qty_30d, ls.sales_amount_30d, ls.sales_qty_90d, ls.sales_amount_90d,
           ls.gross_margin_30d, ls.stock_qty, ls.last_delivery_at, ls.snapshot_date,
           (pc.product_id IS NOT NULL) AS has_price_change
      FROM latest_snap ls
      JOIN dim_product p ON p.id = ls.product_id AND p.deleted_at IS NULL
 LEFT JOIN price_changed pc ON pc.product_id = ls.product_id
     ${extra.length > 0 ? 'WHERE ' + extra.join(' AND ') : ''}
  ORDER BY p.sku_code
  `;
  const res = await query<
    ProductDbRow & {
      retail_price: number | null;
      original_price: number | null;
      sales_qty_30d: number | null;
      sales_amount_30d: number | null;
      sales_qty_90d: number | null;
      sales_amount_90d: number | null;
      gross_margin_30d: number | null;
      stock_qty: number | null;
      last_delivery_at: string | null;
      snapshot_date: string | null;
      has_price_change: boolean;
    }
  >(sql, params);

  return res.rows.map((r) => ({
    ...mapProduct(r),
    retailPrice: r.retail_price,
    originalPrice: r.original_price,
    salesQty30d: r.sales_qty_30d,
    salesAmount30d: r.sales_amount_30d,
    salesQty90d: r.sales_qty_90d,
    salesAmount90d: r.sales_amount_90d,
    grossMargin30d: r.gross_margin_30d,
    stockQty: r.stock_qty,
    lastDeliveryAt: r.last_delivery_at,
    snapshotDate: r.snapshot_date,
    hasPriceChange: r.has_price_change,
  }));
}

// ---- 批量导入 SKU 销售快照（ERP 同步用） --------------------------------

export interface SkuImportRow {
  skuCode: string;
  productName?: string;
  brand?: string;
  spec?: string;
  unit?: string;
  categoryPath?: string;
  wholesalePrice?: number;
  retailPrice?: number;
  originalPrice?: number;
  salesQty30d?: number;
  salesAmount30d?: number;
  salesQty90d?: number;
  salesAmount90d?: number;
  grossMargin30d?: number;
  stockQty?: number;
  lastDeliveryAt?: string;
  snapshotDate?: string;
}

export interface SkuImportResult {
  read: number;
  productsUpserted: number;
  factRowsInserted: number;
  errors: number;
}

export async function importStoreSkus(
  storeId: string,
  rows: SkuImportRow[],
): Promise<SkuImportResult> {
  let productsUpserted = 0;
  let factRowsInserted = 0;
  let errors = 0;

  await withTransaction(async (client) => {
    for (const r of rows) {
      try {
        // upsert dim_product
        const prod = await client.query<{ id: string }>(
          `INSERT INTO dim_product (sku_code, product_name, brand, spec, unit, category_path, wholesale_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (sku_code) WHERE deleted_at IS NULL DO UPDATE
             SET product_name = COALESCE(EXCLUDED.product_name, dim_product.product_name),
                 brand = COALESCE(EXCLUDED.brand, dim_product.brand),
                 spec = COALESCE(EXCLUDED.spec, dim_product.spec),
                 unit = COALESCE(EXCLUDED.unit, dim_product.unit),
                 category_path = COALESCE(EXCLUDED.category_path, dim_product.category_path),
                 wholesale_price = COALESCE(EXCLUDED.wholesale_price, dim_product.wholesale_price),
                 updated_at = now()
           RETURNING id`,
          [
            r.skuCode,
            r.productName ?? r.skuCode,
            r.brand ?? null,
            r.spec ?? null,
            r.unit ?? null,
            r.categoryPath ?? null,
            r.wholesalePrice ?? null,
          ],
        );
        if (prod.rowCount && prod.rowCount > 0) productsUpserted++;
        const productId = prod.rows[0]!.id;

        // upsert fact_store_sku_weekly（按 (store_id, product_id, snapshot_date, source) 唯一）
        const factInserted = await client.query(
          `INSERT INTO fact_store_sku_weekly
             (store_id, product_id, sku_code, snapshot_date, retail_price, original_price,
              sales_qty_30d, sales_amount_30d, sales_qty_90d, sales_amount_90d,
              gross_margin_30d, stock_qty, last_delivery_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'erp_sync')
           ON CONFLICT (store_id, product_id, snapshot_date, source) DO UPDATE
             SET retail_price = EXCLUDED.retail_price,
                 original_price = EXCLUDED.original_price,
                 sales_qty_30d = EXCLUDED.sales_qty_30d,
                 sales_amount_30d = EXCLUDED.sales_amount_30d,
                 sales_qty_90d = EXCLUDED.sales_qty_90d,
                 sales_amount_90d = EXCLUDED.sales_amount_90d,
                 gross_margin_30d = EXCLUDED.gross_margin_30d,
                 stock_qty = EXCLUDED.stock_qty,
                 last_delivery_at = EXCLUDED.last_delivery_at`,
          [
            storeId,
            productId,
            r.skuCode,
            r.snapshotDate ?? new Date().toISOString().slice(0, 10),
            r.retailPrice ?? null,
            r.originalPrice ?? null,
            r.salesQty30d ?? null,
            r.salesAmount30d ?? null,
            r.salesQty90d ?? null,
            r.salesAmount90d ?? null,
            r.grossMargin30d ?? null,
            r.stockQty ?? null,
            r.lastDeliveryAt ?? null,
          ],
        );
        if (factInserted.rowCount && factInserted.rowCount > 0) factRowsInserted++;
      } catch {
        errors++;
      }
    }
  });

  return { read: rows.length, productsUpserted, factRowsInserted, errors };
}

// ---- 竞品价格 -------------------------------------------------------------

/**
 * 合并 SK-C3 + PR-A3：支持两种查询模式
 *   - byCategoryPath：返回该品类下的所有竞品 + 最新价
 *   - bySkuCodes：返回这些 SKU 在各渠道的最新价
 */
export async function queryCompetitors(args: {
  byCategoryPath?: string;
  bySkuCodes?: string[];
}): Promise<CompetitorRow[]> {
  const params: unknown[] = [];
  const filters: string[] = ['cp.is_active = TRUE'];

  if (args.byCategoryPath) {
    params.push(args.byCategoryPath);
    filters.push(
      `EXISTS (SELECT 1 FROM dim_product p WHERE p.sku_code = cp.mapped_sku_code AND p.category_path = $${params.length})`,
    );
  }
  if (args.bySkuCodes && args.bySkuCodes.length > 0) {
    params.push(args.bySkuCodes);
    filters.push(`cp.mapped_sku_code = ANY($${params.length}::text[])`);
  }

  const sql = `
    WITH latest_price AS (
      SELECT DISTINCT ON (competitor_product_id)
             competitor_product_id, retail_price, promo_price, promo_text, snapshot_date
        FROM fact_competitor_price_weekly
    ORDER BY competitor_product_id, snapshot_date DESC
    )
    SELECT cp.id, ch.channel_code, ch.channel_name, ch.kind AS channel_kind,
           cp.product_name, cp.brand, cp.spec, cp.mapped_sku_code,
           lp.retail_price, lp.promo_price, lp.promo_text, lp.snapshot_date
      FROM dim_competitor_product cp
      JOIN dim_competitor_channel ch ON ch.id = cp.channel_id
 LEFT JOIN latest_price lp ON lp.competitor_product_id = cp.id
     WHERE ${filters.join(' AND ')}
  ORDER BY ch.channel_code, cp.product_name
  `;
  const res = await query<{
    id: string;
    channel_code: string;
    channel_name: string;
    channel_kind: 'online' | 'offline';
    product_name: string;
    brand: string | null;
    spec: string | null;
    mapped_sku_code: string | null;
    retail_price: number | null;
    promo_price: number | null;
    promo_text: string | null;
    snapshot_date: string | null;
  }>(sql, params);
  return res.rows.map((r) => ({
    id: r.id,
    channelCode: r.channel_code,
    channelName: r.channel_name,
    channelKind: r.channel_kind,
    productName: r.product_name,
    brand: r.brand,
    spec: r.spec,
    mappedSkuCode: r.mapped_sku_code,
    latestPrice: r.retail_price,
    latestPromoPrice: r.promo_price,
    latestPromoText: r.promo_text,
    latestSnapshotDate: r.snapshot_date,
  }));
}

// ---- 基准 SKU -------------------------------------------------------------

export async function listBenchmarkSkus(args: {
  segment?: 'core' | 'innovation';
}): Promise<BenchmarkSkuRow[]> {
  const params: unknown[] = [];
  const filters: string[] = ['b.is_active = TRUE'];
  if (args.segment) {
    params.push(args.segment);
    filters.push(`b.segment = $${params.length}::benchmark_segment`);
  }
  const res = await query<{
    sku_code: string;
    product_name: string | null;
    segment: 'core' | 'innovation';
    category_path: string | null;
    reason: string | null;
  }>(
    `SELECT b.sku_code, p.product_name, b.segment, b.category_path, b.reason
       FROM benchmark_sku_allowlist b
  LEFT JOIN dim_product p ON p.sku_code = b.sku_code AND p.deleted_at IS NULL
      WHERE ${filters.join(' AND ')}
   ORDER BY b.sku_code`,
    params,
  );
  return res.rows.map((r) => ({
    skuCode: r.sku_code,
    productName: r.product_name,
    segment: r.segment,
    categoryPath: r.category_path,
    reason: r.reason,
  }));
}

// ---- 选品 SKU 级促销文案 -----------------------------------------------

export async function listPromoSkus(): Promise<string[]> {
  const res = await query<{ sku_code: string }>(
    `SELECT DISTINCT sku_code FROM promo_groups WHERE is_active = TRUE`,
  );
  return res.rows.map((r) => r.sku_code);
}

export async function listPromoText(args: {
  categoryPath?: string;
  skuCodes?: string[];
}): Promise<PromoTextRow[]> {
  const params: unknown[] = [];
  const filters: string[] = ['pg.is_active = TRUE'];
  if (args.categoryPath) {
    params.push(args.categoryPath);
    filters.push(`pg.category_path = $${params.length}`);
  }
  if (args.skuCodes && args.skuCodes.length > 0) {
    params.push(args.skuCodes);
    filters.push(`pg.sku_code = ANY($${params.length}::text[])`);
  }
  const res = await query<{
    group_code: string;
    group_name: string | null;
    sku_code: string;
    promo_text: string;
    category_path: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }>(
    `SELECT pg.group_code, pg.group_name, pg.sku_code, pg.promo_text,
            pg.category_path, pg.effective_from, pg.effective_to
       FROM promo_groups pg
      WHERE ${filters.join(' AND ')}
   ORDER BY pg.group_code, pg.display_order, pg.sku_code`,
    params,
  );
  return res.rows.map((r) => ({
    groupCode: r.group_code,
    groupName: r.group_name,
    skuCode: r.sku_code,
    promoText: r.promo_text,
    categoryPath: r.category_path,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }));
}
