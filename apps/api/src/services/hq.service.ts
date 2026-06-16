/**
 * HQ 总部主数据：四层品类树、商品档案、门店档案
 *
 * 表：hq_categories / hq_products / stores
 * 派生函数：fn_category_path / fn_category_scene（V012）/ fn_category_ancestor_name（V023）
 * 注：白名单 V025 起合并为 hq_products.is_whitelisted 列（前身 V024 hq_whitelist、V004 hq_benchmark_skus）；
 *     V026 起以 Dify inputs.sku_attributes 每 SKU 自带标记的形式表达，本文件不再暴露 list 接口。
 */
import { query } from '../db/index.js';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

// ---- 品类树 ---------------------------------------------------------------

export interface CategoryNode {
  id: string;
  parentId: string | null;
  level: 0 | 1 | 2 | 3;
  scene: number | null;
  code: string;
  name: string;
  children?: CategoryNode[];
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
  const res = await query<{
    id: string;
    parent_id: string | null;
    level: number;
    scene: number | null;
    category_code: string;
    category_name: string;
  }>(
    `SELECT id, parent_id, level, scene, category_code, category_name
       FROM hq_categories WHERE is_active
   ORDER BY level, display_order, category_code`,
  );

  const nodes = new Map<string, CategoryNode>();
  for (const r of res.rows) {
    nodes.set(r.id, {
      id: r.id,
      parentId: r.parent_id,
      level: r.level as 0 | 1 | 2 | 3,
      scene: r.scene,
      code: r.category_code,
      name: r.category_name,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId == null) {
      roots.push(node);
    } else {
      nodes.get(node.parentId)?.children?.push(node);
    }
  }
  return roots;
}

// ---- 场景定义（field selection 用，level0 + 关联的 level1 名字） ----------

export interface SceneDef {
  scene: number;
  name: string;
  categories: Array<{ code: string; name: string }>;
}

export async function listScenes(): Promise<SceneDef[]> {
  const res = await query<{
    scene: number;
    scene_name: string;
    cat_code: string | null;
    cat_name: string | null;
    cat_order: number | null;
  }>(
    `SELECT s.scene,
            s.category_name AS scene_name,
            c.category_code AS cat_code,
            c.category_name AS cat_name,
            c.display_order AS cat_order
       FROM hq_categories s
       LEFT JOIN hq_categories c ON c.parent_id = s.id AND c.level = 1 AND c.is_active
      WHERE s.level = 0 AND s.is_active
   ORDER BY s.scene, c.display_order, c.category_code`,
  );

  const map = new Map<number, SceneDef>();
  for (const r of res.rows) {
    let def = map.get(r.scene);
    if (!def) {
      def = { scene: r.scene, name: r.scene_name, categories: [] };
      map.set(r.scene, def);
    }
    if (r.cat_code) {
      def.categories.push({ code: r.cat_code, name: r.cat_name ?? r.cat_code });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.scene - b.scene);
}

// ---- 商品 ------------------------------------------------------------------

export interface ProductRow {
  id: string;
  skuCode: string;
  productName: string;
  brand: string | null;
  spec: string | null;
  unit: string | null;
  series: string | null;
  shelfLifeDays: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  categoryId: string | null;
  categoryPath: string | null;
  scene: number | null;
  isNewProduct: boolean;
  isPrivateLabel: boolean;
  wholesalePrice: number | null;
  suggestedRetailPrice: number | null;
  introducedAt: string | null;
  status: 'active' | 'delisted';
}

export async function listProducts(args: {
  q?: string;
  categoryId?: string;
  scene?: number;
  skuCodes?: string[];
  limit?: number;
}): Promise<ProductRow[]> {
  const where: string[] = ['p.deleted_at IS NULL', "p.status = 'active'"];
  const params: unknown[] = [];
  if (args.q) {
    params.push(`%${args.q}%`);
    where.push(`(p.product_name ILIKE $${params.length} OR p.sku_code ILIKE $${params.length})`);
  }
  if (args.categoryId) {
    params.push(args.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }
  if (args.scene != null) {
    params.push(args.scene);
    where.push(`fn_category_scene(p.category_id) = $${params.length}`);
  }
  if (args.skuCodes && args.skuCodes.length > 0) {
    params.push(args.skuCodes);
    where.push(`p.sku_code = ANY($${params.length}::text[])`);
  }
  params.push(args.limit ?? 50);
  const limitParam = params.length;

  const res = await query<{
    id: string;
    sku_code: string;
    product_name: string;
    brand: string | null;
    spec: string | null;
    unit: string | null;
    series: string | null;
    shelf_life_days: number | null;
    category_id: string | null;
    cat_path: string | null;
    scene: number | null;
    is_new_product: boolean;
    is_private_label: boolean;
    wholesale_price: string | null;
    suggested_retail_price: string | null;
    introduced_at: string | Date | null;
    status: 'active' | 'delisted';
    length_cm: string | null;
    width_cm: string | null;
    height_cm: string | null;
  }>(
    `SELECT p.id, p.sku_code, p.product_name, p.brand, p.spec, p.unit, p.series,
            p.shelf_life_days, p.category_id,
            fn_category_path(p.category_id) AS cat_path,
            fn_category_scene(p.category_id) AS scene,
            p.is_new_product, p.is_private_label,
            p.wholesale_price, p.suggested_retail_price, p.introduced_at, p.status,
            p.length_cm, p.width_cm, p.height_cm
       FROM hq_products p
      WHERE ${where.join(' AND ')}
   ORDER BY p.sku_code
      LIMIT $${limitParam}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id,
    skuCode: r.sku_code,
    productName: r.product_name,
    brand: r.brand,
    spec: r.spec,
    unit: r.unit,
    series: r.series,
    shelfLifeDays: r.shelf_life_days,
    lengthCm: r.length_cm != null ? Number(r.length_cm) : null,
    widthCm: r.width_cm != null ? Number(r.width_cm) : null,
    heightCm: r.height_cm != null ? Number(r.height_cm) : null,
    categoryId: r.category_id,
    categoryPath: r.cat_path,
    scene: r.scene,
    isNewProduct: r.is_new_product,
    isPrivateLabel: r.is_private_label,
    wholesalePrice: r.wholesale_price != null ? Number(r.wholesale_price) : null,
    suggestedRetailPrice: r.suggested_retail_price != null ? Number(r.suggested_retail_price) : null,
    introducedAt:
      r.introduced_at instanceof Date
        ? `${r.introduced_at.getFullYear()}-${String(r.introduced_at.getMonth() + 1).padStart(2, '0')}-${String(r.introduced_at.getDate()).padStart(2, '0')}`
        : r.introduced_at,
    status: r.status,
  }));
}

// ---- 商品图 / 条码 重定向 -------------------------------------------------

function padCode(skuCode: string): string {
  return /^\d+$/.test(skuCode) && skuCode.length < 8 ? skuCode.padStart(8, '0') : skuCode;
}

export function resolveProductImageUrl(skuCode: string): string {
  // 商品图按 OSS 命名约定拼：SKU_IMAGE_BASE / {paddedSkuCode}.png
  return `${config.SKU_IMAGE_BASE.replace(/\/$/, '')}/${padCode(skuCode)}.png`;
}

export function resolveBarcodeUrl(skuCode: string): string {
  return `${config.SKU_BARCODE_BASE.replace(/\/$/, '')}/${padCode(skuCode)}.png`;
}

// ---- 门店档案维护（超管） -------------------------------------------------

export interface StoreUpsertInput {
  code: string;
  name: string;
  province?: string;
  city?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  openedAt?: string;
  isProjectStore?: boolean;
  storeAreaSqm?: number;
  poiCategory?: string;
}

export async function upsertStore(id: string, input: StoreUpsertInput): Promise<{ id: string }> {
  const exists = await query<{ id: string }>(`SELECT id FROM stores WHERE id = $1`, [id]);
  if (exists.rows.length === 0) {
    // 创建
    await query(
      `INSERT INTO stores
        (id, store_code, store_name, province, city, address,
         latitude, longitude, opened_at, is_project_store,
         store_area_sqm, poi_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, input.code, input.name,
        input.province ?? null, input.city ?? null, input.address ?? null,
        input.latitude ?? null, input.longitude ?? null, input.openedAt ?? null,
        input.isProjectStore ?? false,
        input.storeAreaSqm ?? null, input.poiCategory ?? null,
      ],
    );
  } else {
    await query(
      `UPDATE stores
          SET store_code = $2, store_name = $3,
              province = $4, city = $5, address = $6,
              latitude = $7, longitude = $8, opened_at = $9,
              is_project_store = $10,
              store_area_sqm = $11, poi_category = $12,
              updated_at = now()
        WHERE id = $1`,
      [
        id, input.code, input.name,
        input.province ?? null, input.city ?? null, input.address ?? null,
        input.latitude ?? null, input.longitude ?? null, input.openedAt ?? null,
        input.isProjectStore ?? false,
        input.storeAreaSqm ?? null, input.poiCategory ?? null,
      ],
    );
  }
  return { id };
}

/** 校验 scene 业务码合法（业务表外几乎都要先过这关） */
export async function assertSceneExists(scene: number): Promise<void> {
  const res = await query<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM hq_categories WHERE level = 0 AND scene = $1) AS ok`,
    [scene],
  );
  if (!res.rows[0]?.ok) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, `场景码 ${scene} 不存在`);
  }
}
