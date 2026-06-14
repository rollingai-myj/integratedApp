/**
 * 竞品采集业务层（Phase 6）
 *
 * 表：
 *   store_competitors                竞对店（按本店 store_id 隔离）
 *   store_competitor_products        竞品（绑定竞对店；可映射 mapped_product_id 到自家同款）
 *   store_competitor_price_snapshots 竞品价格快照（同 product + date 视为一期）
 *   v_active_competitor_price        最新一期价格视图
 *
 * 所有写操作的 storeId 都从 session.currentStoreId 取，不接受客户端传 storeId。
 */
import { query } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export type CompetitorKind = 'online' | 'offline';

export interface Competitor {
  id: string;
  storeId: string;
  name: string;
  kind: CompetitorKind;
  province: string | null;
  city: string | null;
  address: string | null;
  distanceM: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorProduct {
  id: string;
  competitorId: string;
  externalSku: string | null;
  productName: string;
  brand: string | null;
  spec: string | null;
  mappedProductId: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorPrice {
  id: string;
  competitorProductId: string;
  snapshotDate: string;
  retailPrice: number;
  promoPrice: number | null;
  promoText: string | null;
  source: string;
  photoUrl: string | null;
  collectedAt: string;
  collectedBy: string | null;
}

interface CompetitorRow {
  id: string;
  store_id: string;
  competitor_name: string;
  kind: CompetitorKind;
  province: string | null;
  city: string | null;
  address: string | null;
  distance_m: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToCompetitor(r: CompetitorRow): Competitor {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.competitor_name,
    kind: r.kind,
    province: r.province,
    city: r.city,
    address: r.address,
    distanceM: r.distance_m,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface CompetitorProductRow {
  id: string;
  competitor_id: string;
  external_sku: string | null;
  product_name: string;
  brand: string | null;
  spec: string | null;
  mapped_product_id: string | null;
  product_url: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToProduct(r: CompetitorProductRow): CompetitorProduct {
  return {
    id: r.id,
    competitorId: r.competitor_id,
    externalSku: r.external_sku,
    productName: r.product_name,
    brand: r.brand,
    spec: r.spec,
    mappedProductId: r.mapped_product_id,
    productUrl: r.product_url,
    imageUrl: r.image_url,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---- 竞对店 CRUD --------------------------------------------------------

export async function listCompetitors(storeId: string): Promise<Competitor[]> {
  const res = await query<CompetitorRow>(
    `SELECT * FROM store_competitors
      WHERE store_id = $1 AND is_active
      ORDER BY created_at DESC`,
    [storeId],
  );
  return res.rows.map(rowToCompetitor);
}

export interface CompetitorCreate {
  name: string;
  kind: CompetitorKind;
  province?: string;
  city?: string;
  address?: string;
  distanceM?: number;
}

export async function createCompetitor(
  storeId: string,
  input: CompetitorCreate,
): Promise<Competitor> {
  const res = await query<CompetitorRow>(
    `INSERT INTO store_competitors
       (store_id, competitor_name, kind, province, city, address, distance_m)
     VALUES ($1, $2, $3::competitor_kind, $4, $5, $6, $7)
     RETURNING *`,
    [
      storeId,
      input.name,
      input.kind,
      input.province ?? null,
      input.city ?? null,
      input.address ?? null,
      input.distanceM ?? null,
    ],
  );
  return rowToCompetitor(res.rows[0]!);
}

export interface CompetitorUpdate {
  name?: string;
  kind?: CompetitorKind;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  distanceM?: number | null;
  isActive?: boolean;
}

export async function updateCompetitor(
  storeId: string,
  competitorId: string,
  input: CompetitorUpdate,
): Promise<Competitor> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function push(col: string, val: unknown) {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  if (input.name !== undefined) push('competitor_name', input.name);
  if (input.kind !== undefined) sets.push(`kind = '${input.kind}'::competitor_kind`);
  if (input.province !== undefined) push('province', input.province);
  if (input.city !== undefined) push('city', input.city);
  if (input.address !== undefined) push('address', input.address);
  if (input.distanceM !== undefined) push('distance_m', input.distanceM);
  if (input.isActive !== undefined) push('is_active', input.isActive);

  if (sets.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '至少一个字段需要更新');
  }
  sets.push(`updated_at = now()`);

  params.push(competitorId, storeId);
  const res = await query<CompetitorRow>(
    `UPDATE store_competitors SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND store_id = $${params.length}
      RETURNING *`,
    params,
  );
  if (!res.rows.length) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '竞对店不存在或无权访问');
  }
  return rowToCompetitor(res.rows[0]!);
}

// ---- 竞品 CRUD ----------------------------------------------------------

export async function listCompetitorProducts(
  storeId: string,
  competitorId: string,
): Promise<CompetitorProduct[]> {
  // 校验竞对店属于本店
  const cw = await query<{ id: string }>(
    `SELECT id FROM store_competitors WHERE id = $1 AND store_id = $2`,
    [competitorId, storeId],
  );
  if (!cw.rows.length) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '竞对店不存在或无权访问');
  }
  const res = await query<CompetitorProductRow>(
    `SELECT * FROM store_competitor_products
      WHERE competitor_id = $1 AND is_active
      ORDER BY created_at DESC`,
    [competitorId],
  );
  return res.rows.map(rowToProduct);
}

export interface CompetitorProductCreate {
  externalSku?: string;
  productName: string;
  brand?: string;
  spec?: string;
  mappedProductId?: string;
  productUrl?: string;
  imageUrl?: string;
}

export async function createCompetitorProduct(
  storeId: string,
  competitorId: string,
  input: CompetitorProductCreate,
): Promise<CompetitorProduct> {
  // 校验竞对店属于本店
  const cw = await query<{ id: string }>(
    `SELECT id FROM store_competitors WHERE id = $1 AND store_id = $2`,
    [competitorId, storeId],
  );
  if (!cw.rows.length) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '竞对店不存在或无权访问');
  }
  const res = await query<CompetitorProductRow>(
    `INSERT INTO store_competitor_products
       (competitor_id, external_sku, product_name, brand, spec,
        mapped_product_id, product_url, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      competitorId,
      input.externalSku ?? null,
      input.productName,
      input.brand ?? null,
      input.spec ?? null,
      input.mappedProductId ?? null,
      input.productUrl ?? null,
      input.imageUrl ?? null,
    ],
  );
  return rowToProduct(res.rows[0]!);
}

// ---- 价格采集 -----------------------------------------------------------

export interface CompetitorPriceCreate {
  retailPrice: number;
  promoPrice?: number;
  promoText?: string;
  photoUrl?: string;
  source?: string;
  /** 默认今天 */
  snapshotDate?: string;
}

export async function createCompetitorPrice(
  storeId: string,
  competitorProductId: string,
  input: CompetitorPriceCreate,
  collectedBy: string,
): Promise<CompetitorPrice> {
  // 校验：product → competitor → store_id 必须等于 storeId
  const owner = await query<{ id: string }>(
    `SELECT cp.id
       FROM store_competitor_products cp
       JOIN store_competitors c ON c.id = cp.competitor_id
      WHERE cp.id = $1 AND c.store_id = $2`,
    [competitorProductId, storeId],
  );
  if (!owner.rows.length) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '竞品不存在或无权访问');
  }

  const res = await query<{
    id: string;
    competitor_product_id: string;
    snapshot_date: string;
    retail_price: string;
    promo_price: string | null;
    promo_text: string | null;
    source: string;
    photo_url: string | null;
    collected_at: string;
    collected_by: string | null;
  }>(
    `INSERT INTO store_competitor_price_snapshots
       (competitor_product_id, snapshot_date, retail_price, promo_price,
        promo_text, source, photo_url, collected_by)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
     RETURNING id, competitor_product_id, snapshot_date, retail_price,
               promo_price, promo_text, source, photo_url,
               collected_at, collected_by`,
    [
      competitorProductId,
      input.snapshotDate ?? null,
      input.retailPrice,
      input.promoPrice ?? null,
      input.promoText ?? null,
      input.source ?? 'manual',
      input.photoUrl ?? null,
      collectedBy,
    ],
  );
  const r = res.rows[0]!;
  return {
    id: r.id,
    competitorProductId: r.competitor_product_id,
    snapshotDate: r.snapshot_date,
    retailPrice: Number(r.retail_price),
    promoPrice: r.promo_price !== null ? Number(r.promo_price) : null,
    promoText: r.promo_text,
    source: r.source,
    photoUrl: r.photo_url,
    collectedAt: r.collected_at,
    collectedBy: r.collected_by,
  };
}

// ---- 比价（本店 vs 竞对最新价） ----------------------------------------

export interface PriceCompareRow {
  skuCode: string;
  productName: string;
  myRetailPrice: number | null;
  myOriginalPrice: number | null;
  competitorPrices: Array<{
    competitorId: string;
    competitorName: string;
    competitorProductId: string;
    snapshotDate: string;
    retailPrice: number;
    promoPrice: number | null;
    promoText: string | null;
  }>;
}

export async function priceCompare(args: {
  storeId: string;
  skuCode?: string;
}): Promise<PriceCompareRow[]> {
  // 取本店"已映射到自家 SKU"的竞品 + 自家最新价
  const params: unknown[] = [args.storeId];
  let skuFilter = '';
  if (args.skuCode) {
    params.push(args.skuCode);
    skuFilter = `AND p.sku_code = $${params.length}`;
  }

  // 关联：自家 SKU snapshot（同店最新一期） vs 竞品最新一期价
  const res = await query<{
    sku_code: string;
    product_name: string;
    my_retail_price: string | null;
    my_original_price: string | null;
    competitors: Array<{
      competitorId: string;
      competitorName: string;
      competitorProductId: string;
      snapshotDate: string;
      retailPrice: string;
      promoPrice: string | null;
      promoText: string | null;
    }> | null;
  }>(
    `WITH my_latest AS (
       SELECT DISTINCT ON (snap.product_id) snap.product_id,
              snap.retail_price, snap.original_price
         FROM store_sku_snapshots snap
        WHERE snap.store_id = $1
        ORDER BY snap.product_id, snap.snapshot_date DESC
     )
     SELECT p.sku_code, p.product_name,
            ml.retail_price AS my_retail_price,
            ml.original_price AS my_original_price,
            COALESCE(
              json_agg(
                json_build_object(
                  'competitorId', vc.competitor_id,
                  'competitorName', vc.competitor_name,
                  'competitorProductId', vc.competitor_product_id,
                  'snapshotDate', vc.snapshot_date,
                  'retailPrice', vc.retail_price,
                  'promoPrice', vc.promo_price,
                  'promoText', vc.promo_text
                )
              ) FILTER (WHERE vc.competitor_product_id IS NOT NULL),
              NULL
            ) AS competitors
       FROM hq_products p
       LEFT JOIN my_latest ml ON ml.product_id = p.id
       LEFT JOIN v_active_competitor_price vc
              ON vc.store_id = $1 AND vc.mapped_product_id = p.id
      WHERE p.status = 'active' ${skuFilter}
      GROUP BY p.sku_code, p.product_name, ml.retail_price, ml.original_price
     HAVING bool_or(vc.competitor_product_id IS NOT NULL)
      ORDER BY p.sku_code`,
    params,
  );
  return res.rows.map((r) => ({
    skuCode: r.sku_code,
    productName: r.product_name,
    myRetailPrice: r.my_retail_price !== null ? Number(r.my_retail_price) : null,
    myOriginalPrice: r.my_original_price !== null ? Number(r.my_original_price) : null,
    competitorPrices: (r.competitors ?? []).map((c) => ({
      competitorId: c.competitorId,
      competitorName: c.competitorName,
      competitorProductId: c.competitorProductId,
      snapshotDate: c.snapshotDate,
      retailPrice: Number(c.retailPrice),
      promoPrice: c.promoPrice !== null ? Number(c.promoPrice) : null,
      promoText: c.promoText,
    })),
  }));
}
