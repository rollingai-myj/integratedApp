/**
 * 门店档案管理 — 列表 / 详情 / 单店编辑(给 admin-web /stores 页用)
 *
 * 跟 admin-uploads/apply.applyStores 互补:那边是批量 CSV 一键导入,
 * 这边是逐家在 UI 上微调。两路最终都写入同一张 `stores` 表。
 *
 * 设计:
 *   - listStores 支持 search(store_code / store_name 模糊)、status 过滤、分页
 *   - updateStore 用 PATCH 语义:只传需要改的字段,其它列保留;字段格式校验
 *     在 service 层(避免 admin.routes.ts 写太重的 zod schema)
 */
import { query } from '../db/index.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export type StoreStatus = 'active' | 'disabled';

export interface StoreDetail {
  id: string;
  storeCode: string;
  storeName: string;
  province: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openedAt: string | null;
  status: StoreStatus;
  isProjectStore: boolean;
  storeAreaSqm: number | null;
  poiCategory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListStoresParams {
  search?: string;
  status?: StoreStatus;
  limit?: number;
  offset?: number;
}

export interface ListStoresResult {
  rows: StoreDetail[];
  total: number;
}

interface StoreDbRow {
  id: string;
  store_code: string;
  store_name: string;
  province: string | null;
  city: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  opened_at: string | null;
  status: StoreStatus;
  is_project_store: boolean;
  store_area_sqm: string | null;
  poi_category: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDetail(r: StoreDbRow): StoreDetail {
  return {
    id: r.id,
    storeCode: r.store_code,
    storeName: r.store_name,
    province: r.province,
    city: r.city,
    address: r.address,
    latitude: r.latitude !== null ? Number(r.latitude) : null,
    longitude: r.longitude !== null ? Number(r.longitude) : null,
    openedAt: r.opened_at,
    status: r.status,
    isProjectStore: r.is_project_store,
    storeAreaSqm: r.store_area_sqm !== null ? Number(r.store_area_sqm) : null,
    poiCategory: r.poi_category,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT_COLS = `id, store_code, store_name, province, city, address,
                     latitude, longitude,
                     opened_at::text AS opened_at,
                     status, is_project_store, store_area_sqm, poi_category,
                     created_at::text AS created_at,
                     updated_at::text AS updated_at`;

export async function listStores(params: ListStoresParams): Promise<ListStoresResult> {
  const where: string[] = ['deleted_at IS NULL'];
  const args: unknown[] = [];

  if (params.search && params.search.trim()) {
    args.push(`%${params.search.trim()}%`);
    where.push(`(store_code ILIKE $${args.length} OR store_name ILIKE $${args.length})`);
  }
  if (params.status) {
    args.push(params.status);
    where.push(`status = $${args.length}::user_status`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM stores ${whereSql}`,
    args,
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  args.push(limit, offset);
  const listRes = await query<StoreDbRow>(
    `SELECT ${SELECT_COLS} FROM stores ${whereSql}
      ORDER BY store_code ASC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );

  return { rows: listRes.rows.map(rowToDetail), total };
}

export async function getStore(id: string): Promise<StoreDetail | null> {
  const res = await query<StoreDbRow>(
    `SELECT ${SELECT_COLS} FROM stores WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return res.rows[0] ? rowToDetail(res.rows[0]) : null;
}

// ============================================================================
// PATCH 校验 + 写库
// ============================================================================

export interface StorePatch {
  storeCode?: string;
  storeName?: string;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openedAt?: string | null;
  status?: StoreStatus;
  isProjectStore?: boolean;
  storeAreaSqm?: number | null;
  poiCategory?: string | null;
}

/**
 * 单店编辑:只更新 patch 中显式给出的字段(undefined = 不动)。
 * 与 CSV 上传不同:这里 null 是"清空",undefined 才是"不改"。
 */
/**
 * 新增门店。store_code / store_name 必填,其它字段可空。
 * NOT NULL 列(status / is_project_store)留空走 PG DEFAULT。
 */
export interface CreateStoreInput {
  storeCode: string;
  storeName: string;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openedAt?: string | null;
  status?: StoreStatus;
  isProjectStore?: boolean;
  storeAreaSqm?: number | null;
  poiCategory?: string | null;
}

export async function createStore(input: CreateStoreInput): Promise<StoreDetail> {
  if (!input.storeCode?.trim()) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '门店编号不能为空');
  }
  if (!input.storeName?.trim()) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '门店名称不能为空');
  }
  if (input.latitude != null && (input.latitude < -90 || input.latitude > 90)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '纬度必须在 -90 到 90 之间');
  }
  if (input.longitude != null && (input.longitude < -180 || input.longitude > 180)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '经度必须在 -180 到 180 之间');
  }
  if (input.openedAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.openedAt)) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '开店日期格式必须是「年-月-日」');
  }
  if (input.storeAreaSqm != null && input.storeAreaSqm < 0) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '门店面积不能为负数');
  }

  try {
    const res = await query<StoreDbRow>(
      `INSERT INTO stores
         (store_code, store_name, province, city, address,
          latitude, longitude, opened_at,
          status, is_project_store, store_area_sqm, poi_category)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8::date,
               COALESCE($9::user_status, 'active'::user_status),
               COALESCE($10, false),
               $11, $12)
       RETURNING ${SELECT_COLS}`,
      [
        input.storeCode.trim(),
        input.storeName.trim(),
        input.province ?? null,
        input.city ?? null,
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.openedAt ?? null,
        input.status ?? null,
        input.isProjectStore ?? null,
        input.storeAreaSqm ?? null,
        input.poiCategory ?? null,
      ],
    );
    return rowToDetail(res.rows[0]!);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new AppError(409, ErrorCodes.CONFLICT, `门店编号「${input.storeCode}」已存在`);
    }
    throw err;
  }
}

/**
 * 软删:把 deleted_at 设为 now()。系统列表 / 查询都过滤 deleted_at IS NULL,
 * 历史关联表(snapshots / changes 等)的外键不会受影响。
 */
export async function deleteStore(id: string): Promise<void> {
  const res = await query(
    `UPDATE stores SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (res.rowCount === 0) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, '该门店不存在或已删除');
  }
}

export async function updateStore(id: string, patch: StorePatch): Promise<StoreDetail> {
  const setParts: string[] = [];
  const args: unknown[] = [id];

  function setField(col: string, value: unknown, cast?: string) {
    args.push(value);
    setParts.push(cast ? `${col} = $${args.length}${cast}` : `${col} = $${args.length}`);
  }

  if (patch.storeCode !== undefined) {
    if (!patch.storeCode.trim()) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '门店编号不能为空');
    }
    setField('store_code', patch.storeCode.trim());
  }
  if (patch.storeName !== undefined) {
    if (!patch.storeName.trim()) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '门店名称不能为空');
    }
    setField('store_name', patch.storeName.trim());
  }
  if (patch.province !== undefined) setField('province', patch.province);
  if (patch.city !== undefined) setField('city', patch.city);
  if (patch.address !== undefined) setField('address', patch.address);

  if (patch.latitude !== undefined) {
    if (patch.latitude !== null && (patch.latitude < -90 || patch.latitude > 90)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '纬度必须在 -90 到 90 之间');
    }
    setField('latitude', patch.latitude);
  }
  if (patch.longitude !== undefined) {
    if (patch.longitude !== null && (patch.longitude < -180 || patch.longitude > 180)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '经度必须在 -180 到 180 之间');
    }
    setField('longitude', patch.longitude);
  }
  if (patch.openedAt !== undefined) {
    if (patch.openedAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.openedAt)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '开店日期格式必须是「年-月-日」');
    }
    setField('opened_at', patch.openedAt, '::date');
  }
  if (patch.status !== undefined) setField('status', patch.status, '::user_status');
  if (patch.isProjectStore !== undefined) setField('is_project_store', patch.isProjectStore);
  if (patch.storeAreaSqm !== undefined) {
    if (patch.storeAreaSqm !== null && patch.storeAreaSqm < 0) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, '门店面积不能为负数');
    }
    setField('store_area_sqm', patch.storeAreaSqm);
  }
  if (patch.poiCategory !== undefined) setField('poi_category', patch.poiCategory);

  if (setParts.length === 0) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, '没有可更新的字段');
  }

  setParts.push('updated_at = now()');

  try {
    const res = await query<StoreDbRow>(
      `UPDATE stores SET ${setParts.join(', ')}
        WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${SELECT_COLS}`,
      args,
    );
    if (res.rows.length === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, '该门店不存在');
    }
    return rowToDetail(res.rows[0]!);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new AppError(409, ErrorCodes.CONFLICT, '门店编号已被其他门店使用');
    }
    throw err;
  }
}
